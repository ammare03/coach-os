import { httpBatchLink, loggerLink, type TRPCLink } from '@trpc/client';
import type { AppRouter } from 'api/src/routers/index.ts';
import superjson from 'superjson';

import { getApiUrl } from './api-url.ts';
import { generateRequestId } from './request-id.ts';

// Links run top-down on the way out, bottom-up on the way back — a link can
// only observe/retry an operation that passes *through* it. That ordering
// is load-bearing, not cosmetic:
//
//   loggerLink        dev only, sees the PROCEDURE before batching collapses it
//   [auth position]    pass-through now; phase-03-identity-and-auth/auth-client/02
//                      puts the header link here, /03 puts refresh+replay right after —
//                      it must sit above the terminating link to retry what that link saw fail
//   httpBatchLink      terminating — superjson transformer, POST to {url}/trpc
//
// The auth link's position is this file's `links.push(passThroughAuthLink)`
// line below — P03's auth-client/02 replaces that one push with the real
// header link, and auth-client/03 adds refresh+replay immediately after it,
// without reordering anything else.
const passThroughAuthLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => next(op);
};

export function buildLinks(): TRPCLink<AppRouter>[] {
  const links: TRPCLink<AppRouter>[] = [];

  if (__DEV__) {
    links.push(loggerLink());
  }

  links.push(passThroughAuthLink);

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
      headers: () => ({ 'x-request-id': generateRequestId() }),
    }),
  );

  return links;
}
