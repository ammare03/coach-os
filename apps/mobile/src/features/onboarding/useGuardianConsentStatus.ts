// `guardian-consent/06` Approach steps 1 and 4 — where the pending screen
// reads its state from, and how it notices that a parent has confirmed.
//
// **`me.get`, not a procedure of its own.** `guardian-consent/03` gates
// every `clientProcedure` for an unconsented minor and deliberately leaves
// `protectedProcedure` alone, so `me.get` is one of the few calls this
// account can still make — and it already carries the row. A bespoke
// `invites.getGuardianConsentStatus` would be a second round trip for two
// fields we are fetching anyway.
//
// **Foreground, never a timer** (`CLAUDE.md` §19). The real sequence is a
// parent standing next to the client saying "done" — which is an app
// foreground, not a 30-second poll. A poll would spend battery on a screen
// whose entire job is to wait, and would still be slower than the tap that
// brings the app back.
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { api } from '../../lib/trpc.ts';

export type GuardianConsentState =
  /** First paint, no cached `me.get`. */
  | 'loading'
  /** `me.get` could not be reached. The session is fine; the network is not. */
  | 'error'
  /** 13–17, and no guardian confirmation yet. The screen's reason for existing. */
  | 'pending'
  /** An adult, a consented minor, or one `age-sweep.ts` has since aged out. */
  | 'resolved';

export interface GuardianConsentStatus {
  state: GuardianConsentState;
  /** `j•••@gmail.com` — masked server-side (`packages/utils`), never the whole address. */
  guardianEmailMasked: string | null;
  /** Pull-to-refresh. The same refetch the foreground listener performs. */
  refresh: () => void;
  isRefreshing: boolean;
}

/**
 * Resolves the four `me.get` shapes the screen must handle: adult,
 * consented minor, pending minor, and aged-out minor.
 *
 * The aged-out case is why the predicate reads `isMinor` first rather than
 * `guardianConsentAt` alone. `age-sweep.ts` clears `is_minor` on the 18th
 * birthday and leaves `guardian_consent_at` null forever — an account that
 * is no longer a minor and never will be consented. It resolves, exactly as
 * the server-side gate resolves it.
 */
export function useGuardianConsentStatus(): GuardianConsentStatus {
  const query = api.me.get.useQuery();
  const { refetch } = query;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void refetch();
      }
    });
    return () => subscription.remove();
  }, [refetch]);

  const me = query.data;
  const state: GuardianConsentState =
    me === undefined
      ? query.isError
        ? 'error'
        : 'loading'
      : me.isMinor && me.guardianConsentAt === null
        ? 'pending'
        : 'resolved';

  return {
    state,
    guardianEmailMasked: me?.guardianEmailMasked ?? null,
    refresh: () => void refetch(),
    // `isFetching` and not `isRefetching`: a retry from the error state has
    // no previous data, so `isRefetching` stays false and the control would
    // give no feedback at all.
    isRefreshing: query.isFetching,
  };
}
