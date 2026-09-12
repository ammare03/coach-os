import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/src/routers/index.ts';
import { useState, type PropsWithChildren } from 'react';
import superjson, { serialize } from 'superjson';

import { api } from '../lib/trpc.ts';

// The provider pair `src/app/_layout.tsx` mounts, minus the network — for
// the shell tests in `src/__tests__/` that build their own bare `<Stack>`
// trees and therefore have no provider stack of their own.
//
// Those tests assert on the ROUTE TREE: which routes exist, which are focus
// modes, and how a deep link lands across app states. They used to get away
// with no providers because every route under them was a P05 placeholder
// rendering a `<Text>`. Each feature that composes a real screen over one of
// those placeholders takes that away — a screen that reads through TanStack
// Query throws "Unable to find tRPC Context" the moment its route resolves,
// and the tree test fails on a data hook rather than on the tree.
//
// The answer is this file rather than a growing substitution list, because a
// substituted route is no longer PROOF the route renders — and for a focus
// mode, that it renders is the thing under test.
//
// **Faked at the transport, never at the hook.** `api.Provider` is the real
// one, `httpLink` is the real one, superjson is the real transformer; only
// `fetch` is ours. So a screen mounted under this keeps its real hooks, its
// real query keys and its real four states — a test that stubbed
// `useWeightUnit` (or any other hook) would stop proving the route renders
// at all, which is the whole point.
//
// A path with no fixture resolves to an ERROR, deliberately: these trees
// have no server, and a screen's documented error state is an honest answer
// where a fabricated success would be a fiction every screen would then have
// to be taught. Screens under test here are expected to render in that state
// — `screen-composition` §3 requires the primary action to work anyway.

const TEST_API_URL = 'http://trpc.test/trpc';
const TRPC_PATH_PREFIX = '/trpc/';

/** Inferred from the router, never restated (`code-conventions` §3). */
type MeProfile = inferRouterOutputs<AppRouter>['me']['get'];

/**
 * The signed-in user these trees run as: a coach who reads kilograms, which
 * is what `useWeightUnit` asks `me.get` for.
 */
export const TEST_ME_COACH: MeProfile = {
  id: '01924f2c-0000-7000-8000-0000000000c0',
  email: 'priya@example.com',
  name: 'Priya Raman',
  avatarAssetId: null,
  role: 'coach',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  onboardingCompletedAt: new Date('2026-03-01T09:00:00.000Z'),
  createdAt: new Date('2026-03-01T09:00:00.000Z'),
  weightUnit: 'kg',
  isMinor: false,
  guardianConsentAt: null,
  guardianEmailMasked: null,
  deletionScheduledFor: null,
};

/** Procedure path (`me.get`) → the value the fake transport resolves it to. */
export type TRPCTestResponses = Readonly<Record<string, unknown>>;

/**
 * Answered for every tree, because every role-gated group has something
 * under it that reads the signed-in user.
 */
const DEFAULT_RESPONSES: TRPCTestResponses = { 'me.get': TEST_ME_COACH };

/** `httpLink` hands its `fetch` whatever the global one accepts. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  // `Request` carries the URL on a property; `URL` stringifies to it.
  return 'url' in input ? input.url : input.toString();
}

function procedurePathOf(url: string): string {
  const [pathname = ''] = url.split('?');
  const start = pathname.indexOf(TRPC_PATH_PREFIX);
  return start === -1 ? pathname : pathname.slice(start + TRPC_PATH_PREFIX.length);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildTestFetch(responses: TRPCTestResponses) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const path = procedurePathOf(urlOf(input));

    if (path in responses) {
      // The httpLink envelope, transformed exactly as the server transforms
      // it — so a `Date` in a fixture arrives at the hook as a `Date`.
      return Promise.resolve(jsonResponse({ result: { data: serialize(responses[path]) } }, 200));
    }

    return Promise.resolve(
      jsonResponse(
        {
          error: serialize({
            message: `No fixture for ${path} in this route-tree test.`,
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path },
          }),
        },
        500,
      ),
    );
  };
}

export interface TRPCTestProviderProps {
  /** Merged over {@link DEFAULT_RESPONSES}; anything unlisted resolves to an error. */
  responses?: TRPCTestResponses;
}

export function TRPCTestProvider({
  children,
  responses,
}: PropsWithChildren<TRPCTestProviderProps>) {
  // `retry: false` so an unfixtured path settles on the first frame instead
  // of holding the tree pending past the end of the test.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpLink({
          url: TEST_API_URL,
          transformer: superjson,
          fetch: buildTestFetch({ ...DEFAULT_RESPONSES, ...responses }),
        }),
      ],
    }),
  );

  // Query outside tRPC, the production nesting `root-layout.test.tsx`
  // asserts — tRPC's React integration is a layer over TanStack Query.
  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </api.Provider>
    </QueryClientProvider>
  );
}
