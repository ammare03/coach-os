import { useAuthStore } from './store.ts';
import { setDeviceId, setTokens } from './token-store.ts';

export interface OpenedSessionLike {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  deviceId: string;
  user: { id: string; role: 'coach' | 'client' | 'assistant' };
}

/**
 * The shared tail of `auth.signUp` and `auth.signIn`'s success path:
 * persist the device id and token set, then flip the store to
 * `'authenticated'`. `useAuthStore.getState()`, not the hook — this runs
 * from an async submit handler, not a render, matching `bootstrap.ts`'s
 * own use of the same accessor.
 */
export async function commitOpenedSession(session: OpenedSessionLike): Promise<void> {
  await setDeviceId(session.deviceId);
  await setTokens({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt: session.expiresAt.toISOString(),
  });
  useAuthStore.getState().setAuthenticated({ userId: session.user.id, role: session.user.role });
}
