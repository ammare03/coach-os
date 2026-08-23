import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Context } from 'hono';

import { appRouter } from '../routers/index.ts';

// The mount path is fixed at `/trpc` — `EXPO_PUBLIC_API_URL` plus this path
// is what the mobile client concatenates (03-mobile-trpc-client.md), and
// changing it later breaks every installed build that hasn't taken an OTA
// update.
export const TRPC_ENDPOINT = '/trpc';

// Kept in its own file so `index.ts` stays a composition root and tests can
// build a handler with a fake context factory without opening a port.
// Hono's `Request` is a standard Fetch `Request`, so the Fetch adapter
// mounts directly — no separate Hono-specific tRPC adapter package needed
// (CLAUDE.md §3.4.1 step 2).
export function handleTrpcRequest(c: Context) {
  return fetchRequestHandler({
    endpoint: TRPC_ENDPOINT,
    req: c.req.raw,
    router: appRouter,
    // 02-request-context.md replaces this stub with the real factory
    // (user resolution, db/redis singletons, requestId).
    createContext: () => ({ user: null }),
  });
}
