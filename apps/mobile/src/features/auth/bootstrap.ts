import { ensureLocalDatabaseBelongsTo } from '../../db/user-scope.ts';

import { decodeAccessTokenClaims } from './jwt.ts';
import { refreshTokenPair } from './refresh-client.ts';
import { onSignOutRequired } from './sign-out-signal.ts';
import { useAuthStore, wipeLocalDataOnSignOut } from './store.ts';
import { clearTokens, getTokens, setTokens } from './token-store.ts';

// Runs once, at module load: whenever `refresh-interceptor.ts` decides a
// session is genuinely over (`signalSignOutRequired`), the store follows.
// This is the store's only tie to the network layer — the interceptor
// never imports the store directly (`sign-out-signal.ts`'s own comment on
// why), so this is the one place that wires them together.
//
// This is an *involuntary* sign-out (`local-database/03-wipe-on-logout.md`):
// there is no user present to confirm discarding unsynced outbox rows, so
// unlike `useSignOut` this never refuses the flip — a dead refresh token
// means the session is over regardless of what's still on disk. It still
// attempts a non-forced wipe first, so the common case (nothing pending)
// leaves the device clean; if the outbox does have pending rows, they are
// deliberately left in place rather than force-discarded (never silently
// destroy a client's unsynced workout). That is a known, bounded gap in
// DB§13's "no window" guarantee for this one path — the previous user's
// rows can outlive this sign-out until the next chance to wipe (a
// subsequent sign-out, or a schema-version mismatch drop) — accepted
// because the alternative is worse and there is no user here to choose.
onSignOutRequired(() => {
  void wipeLocalDataOnSignOut({ force: false }).finally(() => {
    useAuthStore.getState().setSignedOut();
  });
});

/**
 * The cold-start sequence, run once from the root layout before any route
 * renders. On the §8.1 budget: one SecureStore read, then — only if a
 * session exists — exactly one refresh call. A first install with no
 * stored session resolves on the read alone, near-instantly; an existing
 * session pays one round trip to confirm it's still good and to read a
 * fresh `role` claim, never a second request before the first authenticated
 * screen can render (`auth-client/04` approach step 3).
 */
export async function bootstrap(): Promise<void> {
  const stored = await getTokens();
  if (!stored) {
    useAuthStore.getState().setSignedOut();
    return;
  }

  try {
    const refreshed = await refreshTokenPair(stored.refreshToken);
    const claims = decodeAccessTokenClaims(refreshed.accessToken);
    if (!claims) {
      // Should be unreachable — a token this API just issued always
      // carries `sub`/`role`. Treated as "not signed in" anyway, same as
      // any other decode failure, rather than trusting a token this
      // function can't make sense of.
      await clearTokens();
      useAuthStore.getState().setSignedOut();
      return;
    }

    await setTokens({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessExpiresAt: refreshed.expiresAt.toISOString(),
    });
    // DB§13: the device mirror must belong to this user before the store
    // reports `authenticated` — see `db/user-scope.ts`. On the common cold
    // start (same user reopening the app) this is one indexed `SELECT`, so
    // the §8.1 budget above still holds.
    await ensureLocalDatabaseBelongsTo(claims.userId);

    // `onboardingCompletedAt` rides on the rotation response rather than a
    // second `me.get` call, which is what keeps the budget above intact
    // while still giving the route gate its third dimension at cold start
    // (`phase-06-onboarding/onboarding-infrastructure/02`).
    useAuthStore.getState().setAuthenticated({
      userId: claims.userId,
      role: claims.role,
      isOnboarded: refreshed.onboardingCompletedAt !== null,
    });
  } catch {
    // Expired, revoked, or reused refresh token — the session is over.
    // Clearing now means the next launch doesn't repeat this same failed
    // attempt (`auth-client/04` approach step 4).
    await clearTokens();
    useAuthStore.getState().setSignedOut();
  }
}
