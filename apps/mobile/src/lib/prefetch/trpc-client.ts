import type { AppRouter } from 'api/src/routers/index.ts';

// The one tRPC client every prefetch module queries through. Extracted
// from `./sessions.ts` when task 02 added its second and third read: three
// copies of a lazily-built, dynamically-imported client is three places to
// forget the "don't memoise a failure" line.
//
// Lazy and dynamic for the same two reasons `lib/outbox/flush.ts` gives:
// `../trpc-links.ts` resolves `EXPO_PUBLIC_API_URL` at module scope, and
// `TRPCProvider`'s client lives inside a component's `useState`,
// unreachable from a module a background trigger calls.

interface UntypedQueryClient {
  query: (path: string, input: unknown) => Promise<unknown>;
}

let queryClient: Promise<UntypedQueryClient> | null = null;

function getQueryClient(): Promise<UntypedQueryClient> {
  if (!queryClient) {
    const building = Promise.all([import('@trpc/client'), import('../trpc-links.ts')]).then(
      ([{ createTRPCUntypedClient }, { buildLinks }]) =>
        createTRPCUntypedClient<AppRouter>({ links: buildLinks() }),
    );
    // Don't memoise a failure (same idiom as `db/client.ts` and `flush.ts`).
    building.catch(() => {
      queryClient = null;
    });
    queryClient = building;
  }
  return queryClient;
}

/** Calls a tRPC query by path. The caller owns the cast to the procedure's return type. */
export async function prefetchQuery(path: string, input: unknown): Promise<unknown> {
  const client = await getQueryClient();
  return client.query(path, input);
}

/** Test seam — mirrors `resetOutboxFlushStateForTests` in `lib/outbox/flush.ts`. */
export function resetPrefetchStateForTests(): void {
  queryClient = null;
}
