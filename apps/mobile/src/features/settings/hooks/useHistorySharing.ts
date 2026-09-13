import { useState } from 'react';

import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import type { HistorySharing } from '../../onboarding/components/SharingControls.tsx';
import {
  decisionOf,
  isNarrowingDecision,
  type HistorySharingDecision,
  type HistorySharingScreenProps,
  type SharingCoach,
} from '../screens/HistorySharingScreen.tsx';

// `relationship-controls/03` — every read, every write and the optimistic
// rollback behind **Settings → What {coach} can see**. The screen itself is
// presentational; this is the half that talks to the server.
//
// Three decisions this file holds:
//
// 1. **One query.** `clientApp.coach` carries the coach's name AND the
//    three stored sharing values (`get-my-coach.ts`), so the screen has no
//    waterfall and never draws a control before it knows the state
//    (`UI-UX.md` §UX8). `me.get` cannot serve this: `get-me.ts` returns
//    `identity.users` columns only and says so in its own first doc
//    comment, and all three are `client_profiles` columns.
//
// 2. **Optimistic, with rollback, and NEVER queued to the outbox.** A
//    sharing decision replayed hours later — from a device that has since
//    been given away, against a relationship that has since changed — is
//    not a decision the client is still making. It is a plain mutation
//    that either lands now or reports that it did not.
//
// 3. **`didNarrow` is the visit's, not the server's.** True from the first
//    narrowing write and it never resets, which is why the forward-only
//    note does not animate out: the coach has still seen what they have
//    seen, whatever the client chooses next.

const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

/**
 * The optimistic value of `history_shared_from`, for display only.
 *
 * *nothing* and *12 weeks* resolve on the device to the same instants
 * `computeHistorySharedFrom` resolves on the server, so the truth line
 * moves with the segment rather than a round trip behind it. *everything*
 * resolves server-side to the client's account creation date, which the
 * device does not hold — so it keeps the current value rather than
 * inventing one, and the truth line for *everything* carries no date
 * anyway. `onSettled` invalidates either way, and the server's value is
 * what the screen settles on.
 */
function optimisticSharedFrom(
  current: Date | null,
  choice: HistorySharing,
  now: Date,
): Date | null {
  switch (choice) {
    case 'nothing':
      return now;
    case 'twelve_weeks':
      return new Date(now.getTime() - TWELVE_WEEKS_MS);
    case 'everything':
      return current;
  }
}

function applyOptimistically(coach: SharingCoach, decision: HistorySharingDecision): SharingCoach {
  const sharedFrom = optimisticSharedFrom(
    coach.historySharedFrom,
    decision.historySharing,
    new Date(),
  );
  return {
    ...coach,
    historySharingChoice: decision.historySharing,
    historySharedFrom: sharedFrom,
    // The same off-by-default polarity `applySharingDecision` writes: off
    // stores null, never a stale timestamp.
    metricsSharedFrom: decision.shareMetrics ? sharedFrom : null,
    nutritionSharedFrom: decision.shareNutrition ? sharedFrom : null,
  };
}

/** Everything `HistorySharingScreen` needs, and nothing it has to compute. */
export function useHistorySharing(): HistorySharingScreenProps {
  const utils = api.useUtils();
  const coachQuery = api.clientApp.coach.useQuery();

  const [didNarrow, setDidNarrow] = useState(false);
  const [writeError, setWriteError] = useState<string | undefined>(undefined);
  /** The decision the last failed write was trying to make, so Try again repeats it exactly. */
  const [lastAttempt, setLastAttempt] = useState<HistorySharingDecision | null>(null);

  const update = api.clientApp.updateHistorySharing.useMutation({
    onMutate: async (decision) => {
      // Nothing in flight may land on top of the optimistic value
      // (`code-conventions` §5).
      await utils.clientApp.coach.cancel();
      const previous = utils.clientApp.coach.getData();
      if (previous)
        utils.clientApp.coach.setData(undefined, applyOptimistically(previous, decision));
      return { previous };
    },
    onError: (error, _decision, context) => {
      // Roll the control back to what the server still holds, then say so.
      // A client who believes they narrowed something they did not is
      // worse off than one who saw an error.
      if (context?.previous !== undefined) {
        utils.clientApp.coach.setData(undefined, context.previous);
      }
      setWriteError(getErrorCode(error) ?? 'WRITE_FAILED');
    },
    onSettled: () => {
      // The narrowest key that is now stale — never `invalidate()` with no
      // key (`code-conventions` §5).
      void utils.clientApp.coach.invalidate();
    },
  });

  function change(decision: HistorySharingDecision) {
    const coach = coachQuery.data;
    const before = coach ? decisionOf(coach) : null;
    if (isNarrowingDecision(before, decision)) setDidNarrow(true);

    setWriteError(undefined);
    setLastAttempt(decision);
    update.mutate(decision);
  }

  return {
    coach: coachQuery.data,
    isLoading: coachQuery.isPending,
    // Not rendered — the discriminator between "the read failed" and "this
    // client has no coach", which are different screens.
    ...(coachQuery.isError ? { loadError: getErrorCode(coachQuery.error) ?? 'READ_FAILED' } : {}),
    onRetryLoad: () => {
      void coachQuery.refetch();
    },
    onChange: change,
    didNarrow,
    ...(writeError === undefined ? {} : { writeError }),
    onRetryWrite: () => {
      if (lastAttempt !== null) change(lastAttempt);
    },
  };
}
