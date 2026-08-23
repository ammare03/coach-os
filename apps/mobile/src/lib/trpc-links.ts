import { httpBatchLink, loggerLink, type TRPCLink } from '@trpc/client';
import type { AppRouter } from 'api/src/routers/index.ts';
import superjson from 'superjson';

import { getApiUrl } from './api-url.ts';

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
    }),
  );

  return links;
}
