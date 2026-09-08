import { create } from 'zustand';

import { wipeLocalDatabase, type WipeResult } from '../../db/wipe.ts';
import { clearPersistedQueryCache } from '../../lib/query/persister.ts';

import type { AccessTokenRole } from './jwt.ts';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

// Deliberately minimal (`auth-client/04`'s scope) — status, who, and their
// role. No profile, no preferences: those are server state, fetched via
// TanStack Query once authenticated, never duplicated in here (CLAUDE.md
// §10 bans server data in Zustand). `phase-05-app-shell/providers-and-
// gates/03`'s route gate reads `status` to pick a route group.
//
// `phase-06-onboarding/onboarding-infrastructure/02` added `isOnboarded`
// as a fourth field. It is the same category as `role`, not an exception
// to the rule above — see its own comment.
interface AuthState {
  status: AuthStatus;
  userId: string | null;
  role: AccessTokenRole | null;
  /**
   * The route gate's third dimension (`phase-06-onboarding/onboarding-
   * infrastructure/02`). A boolean, not `users.onboarding_completed_at`
   * itself: the timestamp is profile data and belongs to `me.get`, while
   * "which of this role's two homes does this session belong in" is the
   * same kind of routing fact `role` already is — derived once, at the
   * edge, from whichever auth response opened the session.
   *
   * Only meaningful while `status === 'authenticated'`; every path to that
   * status goes through `setAuthenticated`, which requires it.
   */
  isOnboarded: boolean;
  setAuthenticated: (session: {
    userId: string;
    role: AccessTokenRole;
    isOnboarded: boolean;
  }) => void;
  /**
   * `me.completeOnboarding` succeeded. Called by the completion action
   * itself, in the same turn — the gate reads this store synchronously, so
   * the redirect out of onboarding lands on the next render rather than
   * waiting on a refetch, a foreground, or a relaunch (that task's Risks).
   */
  setOnboarded: () => void;
  setSignedOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  userId: null,
  role: null,
  // Fail closed: an unknown session is treated as not-yet-onboarded, so the
  // failure mode is "asked to finish setup again", never "walked past it".
  isOnboarded: false,
  setAuthenticated: ({ userId, role, isOnboarded }) =>
    set({ status: 'authenticated', userId, role, isOnboarded }),
  setOnboarded: () => set({ isOnboarded: true }),
  setSignedOut: () =>
    set({ status: 'unauthenticated', userId: null, role: null, isOnboarded: false }),
}));

/**
 * `local-database/03-wipe-on-logout.md`: attempts the device-mirror wipe
 * (`db/wipe.ts`) and, unless it was blocked by unsynced outbox rows, also
 * clears the persisted query cache (`lib/query/persister.ts`) — the two
 * on-device stores DB§13 and the `offline-sync` skill §8 require gone
 * before a different user can trust this device.
 *
 * Deliberately does not touch this store. `useSignOut` (voluntary) and
 * `bootstrap`'s involuntary `onSignOutRequired` listener disagree on what to
 * do once this resolves — the former refuses to sign out at all when
 * `blocked`, the latter always flips because a dead refresh token leaves no
 * session to remain "authenticated" against — so the store flip stays at
 * each call site rather than being decided here.
 */
export async function wipeLocalDataOnSignOut(
  options: { force?: boolean } = {},
): Promise<WipeResult> {
  const result = await wipeLocalDatabase({ force: options.force ?? false });
  if (result.outcome !== 'blocked') {
    await clearPersistedQueryCache();
  }
  return result;
}
