import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
// Type-only — see `../../lib/trpc.ts`'s own comment on why this must never
// become a value import in a bundled app.
import type { AppRouter } from 'api/src/routers/index.ts';

import { getErrorCode } from '../../lib/error-code.ts';

import { needsAuth } from './auth-link.ts';
import { refreshTokenPair } from './refresh-client.ts';
import { signalSignOutRequired } from './sign-out-signal.ts';
import { clearTokens, getTokens, setTokens } from './token-store.ts';

// The module-level single-flight lock (`auth-client/03` approach step 1).
// One promise, shared by every concurrent caller: the first `AUTH_REQUIRED`
// starts it, every other one awaits the same promise instead of starting
// its own. This is the one thing this file cannot get wrong — firing two
// concurrent `auth.refresh` calls with the same refresh token trips
// `auth-server/04`'s reuse detection against the app's own legitimate
// traffic and revokes the whole family, signing the user out of every
// device over what was normal concurrent usage.
let inFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  inFlight ??= performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performRefresh(): Promise<boolean> {
  const stored = await getTokens();
  if (!stored) {
    return false;
  }

  try {
    const result = await refreshTokenPair(stored.refreshToken);
    await setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      // `result.expiresAt` is a real `Date` (superjson) — `token-store.ts`
      // persists an ISO string, per `StoredSession`.
      accessExpiresAt: result.expiresAt.toISOString(),
    });
    return true;
  } catch {
    // Reuse detected, or the refresh token expired/was revoked — the
    // session is genuinely over. Clearing here (rather than leaving it to
    // the caller) means every queued request fails clean instead of racing
    // a second refresh attempt against stale tokens.
    await clearTokens();
    return false;
  }
}

/**
 * Catches `AUTH_REQUIRED`, refreshes at most once per burst, and replays
 * the original operation with the new token. Sits above `authLink` in the
 * chain (`../../lib/trpc-links.ts`) — a retried operation passes back
 * through `authLink`, which re-stamps `needsAuth`, then to `httpBatchLink`,
 * which reads the freshly-cached token via `buildRequestHeaders`.
 *
 * Scoped to procedures that actually require auth (`needsAuth`, the same
 * exclusion list `authLink` uses): `auth.signIn` throws `AUTH_REQUIRED` for
 * a plain wrong password (`auth-server/02`), and retrying that after a
 * "refresh" would be nonsensical — there is no session to refresh
 * (`apps/api/src/routers/auth.ts`'s own comment on this exact scoping).
 */
export const refreshLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      let unsubscribed = false;
      let current: { unsubscribe(): void } | undefined;

      function attempt(isRetry: boolean) {
        current = next(op).subscribe({
          next(value) {
            observer.next(value);
          },
          error(err) {
            const eligible =
              !isRetry && needsAuth(op.path) && getErrorCode(err) === 'AUTH_REQUIRED';

            if (!eligible) {
              observer.error(err);
              return;
            }

            refreshOnce().then((refreshed) => {
              if (unsubscribed) {
                return;
              }
              if (refreshed) {
                attempt(true);
              } else {
                signalSignOutRequired();
                observer.error(err);
              }
            });
          },
          complete() {
            observer.complete();
          },
        });
      }

      attempt(false);

      return () => {
        unsubscribed = true;
        current?.unsubscribe();
      };
    });
  };
};
