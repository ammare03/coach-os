import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { QueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';

import { rateLimitCaches } from '../rate-limit-handling.ts';

import {
  createSQLitePersister,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE_MS,
  shouldPersistQuery,
} from './persister.ts';

// The single instance — the persister below attaches to *this* one, and so
// will P08's outbox. Constructing a second `QueryClient` anywhere is the
// most common cache bug in this stack: "the mutation succeeded but the list
// didn't update", and it survives review because both caches are
// individually correct.
export const queryClient = new QueryClient({
  // `rate-limit-handling.ts`'s `onError` hooks — every query and mutation
  // passes through these caches, so a `RATE_LIMITED` rejection surfaces
  // centrally (`03-per-route-config-and-429-handling.md`) rather than
  // requiring each feature to check `getErrorCode` itself.
  queryCache: rateLimitCaches.queryCache,
  mutationCache: rateLimitCaches.mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // CLAUDE.md §19 — a cached dashboard paints in < 200ms and revalidates behind it
      gcTime: QUERY_CACHE_MAX_AGE_MS, // matches the persistence window; a shorter gcTime evicts rows the persister just restored
      retry: (failureCount, error) => failureCount < 2 && shouldRetry(error),
      refetchOnWindowFocus: false, // RN's focus semantics differ from the web's; the `offline-sync` skill prefetches on foreground explicitly
      refetchOnReconnect: true, // the gym has bad signal — this is the behaviour the offline story wants
    },
    mutations: {
      retry: (failureCount, error) => failureCount < 2 && shouldRetry(error),
    },
  },
});

// Retry a network-level failure or a genuine server error; never a 4xx — a
// `FORBIDDEN` or `TOO_MANY_REQUESTS` retried three times is three times the
// damage, and it's a decision the server already made and will make again.
//
// `error.data?.httpStatus` is what tRPC's *default* error formatter sets.
// `../error-and-validation/02-error-formatter-and-codes.md` adds the
// catalogued `cause.code` this predicate will eventually switch on instead;
// until then, "no HTTP status at all" (a network failure) or ">= 500" is the
// buildable version of the same rule.
function shouldRetry(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) {
    return true; // not a tRPC error at all — a genuine network failure
  }
  const httpStatus = (error.data as { httpStatus?: number } | null)?.httpStatus;
  return httpStatus === undefined || httpStatus >= 500;
}

export type QueryPersistenceStatus =
  { status: 'persisting' } | { status: 'unavailable'; reason: unknown };

async function startQueryPersistence(client: QueryClient): Promise<QueryPersistenceStatus> {
  try {
    const persister = await createSQLitePersister();
    const [, restored] = persistQueryClient({
      queryClient: client,
      persister,
      maxAge: QUERY_CACHE_MAX_AGE_MS,
      buster: QUERY_CACHE_BUSTER,
      dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    });
    await restored;
    return { status: 'persisting' };
  } catch (reason) {
    // SQLite is unavailable — an unsupported platform, or a file that will
    // not open. The app is fully functional without a warm cache, so this
    // degrades rather than throws; `providers-and-gates/05` reports it to
    // Sentry once that provider exists.
    return { status: 'unavailable', reason };
  }
}

/**
 * Resolves once the persisted cache has been restored (or once we know there
 * is none). Started here, at module scope, rather than from a provider: the
 * restore has to race the first render, not wait for it, or the screens the
 * cache exists to paint instantly have already painted empty.
 *
 * Exported as a promise so `providers-and-gates/03` can hold the splash for
 * it alongside the auth bootstrap, and so a test can await it instead of
 * polling.
 */
export const queryPersistence: Promise<QueryPersistenceStatus> = startQueryPersistence(queryClient);
