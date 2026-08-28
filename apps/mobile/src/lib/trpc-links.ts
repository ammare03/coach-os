import { httpBatchLink, loggerLink, type TRPCLink } from '@trpc/client';
import type { AppRouter } from 'api/src/routers/index.ts';
import superjson from 'superjson';

import { authLink, buildRequestHeaders } from '../features/auth/auth-link.ts';
import { refreshLink } from '../features/auth/refresh-interceptor.ts';

import { getApiUrl } from './api-url.ts';
import { generateRequestId } from './request-id.ts';

// Links run top-down on the way out, bottom-up on the way back — a link can
// only observe/retry an operation that passes *through* it. That ordering
// is load-bearing, not cosmetic:
//
//   loggerLink     dev only, sees the PROCEDURE before batching collapses it
//   refreshLink    catches AUTH_REQUIRED, refreshes once, replays (auth-client/03) —
//                  must sit above authLink so a replay passes back through it
//   authLink       stamps op.context.needsAuth (auth-client/02), read by
//                  buildRequestHeaders below — last stop before the wire
//   httpBatchLink  terminating — reads op.context via buildRequestHeaders,
//                  superjson transformer, POST to {url}/trpc

export function buildLinks(): TRPCLink<AppRouter>[] {
  const links: TRPCLink<AppRouter>[] = [];

  if (__DEV__) {
    links.push(loggerLink());
  }

  links.push(refreshLink);
  links.push(authLink);

  links.push(
    httpBatchLink({
      url: getApiUrl(),
      transformer: superjson,
      // A batch shares one HTTP status/URL — cap conservatively so a large
      // batch never risks a GET-style URL-length limit (this transport is
      // POST, but the cap stays deliberate rather than unbounded).
      maxURLLength: 2083,
      // `observability/05-request-correlation.md`: the plan's literal path
      // is `apps/mobile/src/lib/trpc.ts`, but that file only builds the
      // `createTRPCReact` instance (no request ever leaves through it) —
      // this terminating link is where a header can actually attach to the
      // outgoing HTTP call, the same "plan path vs. actual file layout"
      // deviation already made for the API-side observability tasks.
      //
      // One id per HTTP batch, generated fresh per request — that matches
      // `resolveRequestId` on the server, which also binds one id per
      // `Request`. Reusing a single id across retries of *one queued
      // mutation* (step 4) is an outbox responsibility, and there is no
      // outbox in this app yet (`offline-sync` skill territory, not built
      // at the time this file was written) — when it lands, it generates
      // the id once with `generateRequestId()` at enqueue time, persists it
      // alongside the queued mutation, and passes it through here instead
      // of letting this link generate a new one per attempt.
      headers: ({ opList }) => ({
        ...buildRequestHeaders(opList),
        'x-request-id': generateRequestId(),
      }),
    }),
  );

  return links;
}
