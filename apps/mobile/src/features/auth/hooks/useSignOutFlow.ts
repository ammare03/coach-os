import { useRef, useState } from 'react';

import { captureLocalWipeFailure } from '../../../lib/sentry.ts';

import { useSignOut } from './useSignOut.ts';

/**
 * The one entry every sign-out affordance in the app calls
 * (`account-actions/01`, Approach step 4). Settings' footer row, the
 * wrong-session invite branch, and the guardian-consent waiting room all go
 * through here; P28's org-admin row will too.
 *
 * `useSignOut` owns the mechanics and is not changed by this — wipe, revoke,
 * clear tokens, flip the store, in that order. What it cannot own is the
 * question its `blocked` result asks, because a hook cannot render a dialog
 * and the two screens that called it before this existed each dropped that
 * result on the floor with a comment saying so. This hook is the branch:
 *
 * | `WipeResult` | What happens |
 * |---|---|
 * | `wiped`   | Nothing more. The route gate is already unmounting this screen. |
 * | `blocked` | `pendingCount` opens `UnsyncedWorkPrompt`. Session untouched. |
 * | `failed`  | Sign-out already proceeded; the failure is reported and the user is not told. |
 *
 * **`failed` is silent to the user on purpose.** `useSignOut`'s header
 * comment makes the call — a local disk error must not trap someone in the
 * wrong account — and by the time this sees the result the sign-out has
 * happened. A toast on the sign-in screen would describe a problem the
 * person cannot act on, which `ui-conventions` §4 and `ERRORS.md` both
 * refuse. It goes to Sentry instead, as a class name and nothing else.
 *
 * **Nothing here flushes the outbox.** Keeping the session is the whole
 * "wait" branch: P08's connectivity listener does the work when signal
 * returns. A blocking flush on the sign-out path is a spinner a gym basement
 * can hold up for an hour (this task's Risks).
 */
export interface SignOutFlow {
  /** The sign-out affordance's `onPress`. Safe to call from a row or a button. */
  requestSignOut: () => void;
  isSigningOut: boolean;
  /** `UnsyncedWorkPrompt`'s `pendingCount` — `null` whenever there is nothing to ask. */
  pendingCount: number | null;
  /** The prompt's primary action. Closes it, and does nothing else. */
  keepSignedIn: () => void;
  /** The prompt's destructive action — the same sign-out, forced. */
  discardAndSignOut: () => void;
}

export function useSignOutFlow(): SignOutFlow {
  const { signOut, isSigningOut } = useSignOut();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  // A ref, not `isSigningOut`: that flag is state and lands a render later,
  // so two presses in the same frame would both pass the check and run two
  // wipes against one database.
  const isInFlight = useRef(false);

  async function attempt(options?: { force?: boolean }): Promise<void> {
    if (isInFlight.current) {
      return;
    }
    isInFlight.current = true;
    try {
      const result = options === undefined ? await signOut() : await signOut(options);

      if (result.outcome === 'blocked') {
        setPendingCount(result.pendingCount);
        return;
      }
      setPendingCount(null);
      if (result.outcome === 'failed') {
        // Never the error itself — `lib/sentry.ts` takes a class name
        // precisely so a raw SQLite message cannot be passed by accident
        // (`security-and-privacy` §5).
        captureLocalWipeFailure(
          result.error instanceof Error ? result.error.name : typeof result.error,
        );
      }
    } finally {
      isInFlight.current = false;
    }
  }

  return {
    requestSignOut: () => {
      void attempt();
    },
    isSigningOut,
    pendingCount,
    keepSignedIn: () => setPendingCount(null),
    discardAndSignOut: () => {
      void attempt({ force: true });
    },
  };
}
