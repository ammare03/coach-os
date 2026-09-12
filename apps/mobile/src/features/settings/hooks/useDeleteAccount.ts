import { useRouter } from 'expo-router';

import { trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { api } from '../../../lib/trpc.ts';
import { useAuthStore } from '../../auth/store.ts';

/**
 * The blocking state's route (`features/auth/screens/PendingDeletionScreen`).
 * Flat, like `/your-data` and `/medical-disclaimer`: one screen, identical
 * for every role, and no group it could belong to — a coach and a client
 * both land here and neither one's group gate may govern it.
 */
export const PENDING_DELETION_ROUTE = '/pending-deletion';

/**
 * `me.requestDeletion`, and the three things that have to happen around it.
 *
 * **It is not an outbox mutation, and that is the point** (`account-actions/02`
 * Approach step 7). A queued deletion that fires when a phone finds signal
 * in a week is not a thing a person should be able to leave behind on a
 * device, so `canDelete` is false with no connection and the screen refuses
 * before the tap rather than failing after it.
 *
 * The server writes the `audit_log` row and sends the recovery email
 * (`account-lifecycle/03`); neither is waited on here. The app owes exactly
 * one thing back — the analytics event, fired once, on success only.
 */
export interface DeleteAccount {
  /** The typed confirmation's action. Does nothing offline. */
  deleteAccount: () => void;
  isDeleting: boolean;
  /** `false` with no connection — the destructive control is disabled, not armed. */
  canDelete: boolean;
  /** The request was refused or never arrived, and the person is still here. */
  hasFailed: boolean;
}

/**
 * Whole days since the account was created. `Math.floor`, so an account
 * opened this morning is 0 and never -0 or 1 — and never a fraction, which
 * would make the property a fingerprint rather than a cohort.
 */
export function accountAgeDays(createdAt: Date, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - createdAt.getTime()) / 86_400_000));
}

export function useDeleteAccount(): DeleteAccount {
  const router = useRouter();
  const utils = api.useUtils();
  const { isConnected } = useConnectivity();
  // The auth store, not `me.get` — the same rule `SettingsScreen` states.
  // `AccessTokenRole` and `AnalyticsRole` are the same three values, so
  // this needs no mapping and cannot acquire one silently.
  const role = useAuthStore((state) => state.role);
  const createdAt = api.me.get.useQuery().data?.createdAt;

  const mutation = api.me.requestDeletion.useMutation({
    onSuccess: () => {
      // AN§3.8: `role` and `account_age_days`, nothing else — never the
      // email, never a reason. Skipped outright rather than sent with a
      // guessed age if the profile has not loaded: a wrong number in a
      // cohort property is worse than a missing event, and analytics may
      // never hold up the routing below (AN§0.6).
      if (role !== null && createdAt !== undefined) {
        trackEvent('account_deletion_requested', {
          role,
          account_age_days: accountAgeDays(createdAt),
        });
      }
      // `me.get` now carries `deletionScheduledFor`, which is what
      // `PendingDeletionRedirect` and the screen below both read. Invalidate
      // AND route: the redirect would get there on its own once the refetch
      // lands, but making the person wait on a round trip to find out their
      // account is going is the wrong way round.
      void utils.me.get.invalidate();
      router.replace(PENDING_DELETION_ROUTE);
    },
  });

  return {
    deleteAccount: () => {
      if (!isConnected) {
        return;
      }
      mutation.mutate();
    },
    isDeleting: mutation.isPending,
    canDelete: isConnected,
    hasFailed: mutation.isError,
  };
}
