import * as SecureStore from 'expo-secure-store';

import { tokenCache } from './token-cache.ts';
import type { StoredSession } from './types.ts';

// The only file in this app that imports `expo-secure-store`
// (`auth-client/01`'s acceptance criteria — verified by a repo-wide grep,
// not by convention). Nothing else reads or writes a credential.
//
// `CLAUDE.md` §3.1: "Tokens only. Never PII." The closed stored set below is
// the whole contract — adding a key here means editing this table and this
// module together, never one without the other.
const KEYS = {
  accessToken: 'coachos.auth.access_token',
  refreshToken: 'coachos.auth.refresh_token',
  accessExpiresAt: 'coachos.auth.access_expires_at',
  deviceId: 'coachos.auth.device_id',
} as const;

// WHEN_UNLOCKED: nothing here is needed while the phone is locked.
// THIS_DEVICE_ONLY: keeps tokens out of iCloud Keychain / device backups —
// a refresh token restored onto a second device is a second live session in
// the same rotation family, and the first refresh from either device then
// trips `auth-server/04`'s reuse detection and revokes both. See task 01's
// "Why this exists" for the full reasoning.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function readKey(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch (error) {
    // A keystore reset, a corrupted entry, an emulator quirk — none of it
    // is the user's problem. Treat it as "not signed in", the state the app
    // already handles, rather than an unhandled rejection during bootstrap.
    //
    // Deferred: report this as a Sentry warning once `@sentry/react-native`
    // lands (`phase-05-app-shell/providers-and-gates/05`) — with the device
    // model attached, never the key's value.
    console.warn('[token-store] SecureStore read failed', key, error);
    return null;
  }
}

/**
 * Returns the stored session, or null if any required field is missing.
 * There is no partial session: an access token without a refresh token is
 * unrecoverable in fifteen minutes, so it is not returned as though it were
 * usable.
 */
export async function getTokens(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, accessExpiresAt] = await Promise.all([
    readKey(KEYS.accessToken),
    readKey(KEYS.refreshToken),
    readKey(KEYS.accessExpiresAt),
  ]);

  if (!accessToken || !refreshToken || !accessExpiresAt) {
    return null;
  }

  return { accessToken, refreshToken, accessExpiresAt };
}

/**
 * Writes all three session fields. SecureStore has no transaction, so a
 * write that fails partway is cleaned up rather than left as a stranded
 * access token with no refresh token behind it — order matters: refresh
 * token first, then the access token and its expiry.
 *
 * Also primes `tokenCache` in this same function (`auth-client/02`) — the
 * invariant `authLink` depends on is that SecureStore and the in-memory
 * cache can never disagree, which only holds if every writer updates both
 * in one place rather than each caller remembering to.
 */
export async function setTokens(session: StoredSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.refreshToken, session.refreshToken, OPTIONS);
    await SecureStore.setItemAsync(KEYS.accessToken, session.accessToken, OPTIONS);
    await SecureStore.setItemAsync(KEYS.accessExpiresAt, session.accessExpiresAt, OPTIONS);
    tokenCache.set(session.accessToken, session.accessExpiresAt);
  } catch (error) {
    await clearTokens();
    throw error;
  }
}

/**
 * Removes the access token, refresh token, and expiry — but deliberately
 * NOT the device id, which survives sign-out because signing out ends a
 * session, not the phone's identity (task 01 approach step 3). Also clears
 * `tokenCache`, for the same same-function invariant as `setTokens`.
 */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.accessToken, OPTIONS),
    SecureStore.deleteItemAsync(KEYS.refreshToken, OPTIONS),
    SecureStore.deleteItemAsync(KEYS.accessExpiresAt, OPTIONS),
  ]);
  tokenCache.clear();
}

/** The id `auth-server/03` mints and expects back on the next sign-in. */
export async function getDeviceId(): Promise<string | null> {
  return readKey(KEYS.deviceId);
}

export async function setDeviceId(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.deviceId, id, OPTIONS);
}
