import { decodeAccessTokenClaims } from './jwt.ts';
import { refreshTokenPair } from './refresh-client.ts';
import { onSignOutRequired } from './sign-out-signal.ts';
import { useAuthStore } from './store.ts';
import { clearTokens, getTokens, setTokens } from './token-store.ts';

// Runs once, at module load: whenever `refresh-interceptor.ts` decides a
// session is genuinely over (`signalSignOutRequired`), the store follows.
// This is the store's only tie to the network layer — the interceptor
// never imports the store directly (`sign-out-signal.ts`'s own comment on
// why), so this is the one place that wires them together.
onSignOutRequired(() => {
  useAuthStore.getState().setSignedOut();
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
    useAuthStore.getState().setAuthenticated({ userId: claims.userId, role: claims.role });
  } catch {
    // Expired, revoked, or reused refresh token — the session is over.
    // Clearing now means the next launch doesn't repeat this same failed
    // attempt (`auth-client/04` approach step 4).
    await clearTokens();
    useAuthStore.getState().setSignedOut();
  }
}
