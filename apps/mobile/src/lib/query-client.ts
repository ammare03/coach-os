import { QueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';

// The single instance — P08 attaches its persister to *this* one.
// Constructing a second `QueryClient` anywhere is the most common cache bug
// in this stack: "the mutation succeeded but the list didn't update", and it
// survives review because both caches are individually correct.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // CLAUDE.md §8.2 — dashboard renders from cache instantly, revalidates behind it
      gcTime: 24 * 60 * 60 * 1000, // matches §11.2's persistence window (P08)
      retry: (failureCount, error) => failureCount < 2 && shouldRetry(error),
      refetchOnWindowFocus: false, // RN's focus semantics differ from the web's; §11.2 prefetches on foreground explicitly
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
