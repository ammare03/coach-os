import { createTRPCClient, httpLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/src/routers/index.ts';
import superjson from 'superjson';
// Type-only — see `../../lib/trpc.ts`'s own comment on why this must never
// become a value import in a bundled app.

import { getApiUrl } from '../../lib/api-url.ts';

// A second, minimal, unbatched client for exactly one call: `auth.refresh`.
// Deliberately not the app's shared client (`../../lib/trpc-links.ts`) —
// that chain includes `refresh-interceptor.ts`'s own link, and routing the
// refresh call back through the link that triggers refreshes would recurse
// the moment a refresh call ever got a 401 of its own. `auth.refresh` is
// also `publicProcedure` (`auth-server/04`), so it needs no auth header —
// `httpLink` with no auth link ahead of it is the correct, simpler chain.
const refreshClient = createTRPCClient<AppRouter>({
  links: [httpLink({ url: getApiUrl(), transformer: superjson })],
});

// Inferred from the router, not `@coachos/schemas`' `refreshOutput` — that
// Zod shape types `expiresAt` as a string for wire *validation*, but
// superjson (CLAUDE.md §3.2) round-trips it as a real `Date`, matching the
// server resolver's actual `RotateRefreshTokenResult`. Trusting the
// inferred type here is what catches it being anything else.
export type RefreshResult = inferRouterOutputs<AppRouter>['auth']['refresh'];

export function refreshTokenPair(refreshToken: string): Promise<RefreshResult> {
  return refreshClient.auth.refresh.mutate({ refreshToken });
}
