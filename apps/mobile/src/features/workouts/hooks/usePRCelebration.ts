import type { WeightUnit } from '@coachos/utils';
import { useEffect } from 'react';

import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { subscribeOutboxResults } from '../../../lib/outbox/results.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import {
  PR_ANALYTICS_TYPE,
  buildCelebration,
  readConfirmedRecords,
} from '../lib/pr-celebration.ts';
import { usePRCelebrationStore } from '../store/pr-celebration-store.ts';

// `phase-09-workout-logger/personal-records/03` — the trigger.
//
// Six decisions, in the order they matter:
//
// (a) **It listens to the OUTBOX, not to `useLogSet`.** There is no tRPC
//     call on the set-entry path at all: `hooks/useLogSet.ts` rule (a)
//     writes two SQLite rows and returns, and the server sees the set
//     whenever the flush loop gets to it. Record detection is server-side,
//     inside the write transaction (`apps/api/src/lib/pr-detection.ts`), so
//     the confirmation cannot exist before that send succeeds. Hanging the
//     celebration off the local write would mean guessing.
//
// (b) **Offline: defer entirely, never guess.** There is no "possible PR,
//     confirming…" state and there will not be one. A guess that turns out
//     wrong takes something away from the client rather than giving it, and
//     the device cannot compute this: the record is against every set the
//     client has ever logged, not against this session. The cost is that the
//     pill can land two exercises later (design frame D), which is why the
//     sub-line always names the exercise (`../lib/pr-celebration.ts`
//     decision (b)).
//
// (c) **Suppressed once the session is no longer in progress.** `enabled`
//     is the switch and the caller owns it. A confirmation that arrives
//     after the summary screen is DROPPED, not deferred further — the
//     record is still on the client's progress screen, and a pill over a
//     finished workout is a notification about the past. `results.ts` rule
//     (c) is what makes that true rather than aspirational: nothing is
//     buffered, so there is no backlog to flush on the next mount.
//
// (d) **Mounted once per SESSION, not once per page.** The logger keeps
//     three `SetEntrySlot`s alive at a time (`ExercisePager`'s render
//     window), and three subscriptions would be three chances to
//     double-fire — the store's guard would catch it, but a page turn
//     between a send and its delivery could also drop the confirmation
//     entirely. `SessionLoggerScreen` calls this; the slot only renders
//     what the store holds.
//
// (e) **A set with no resolvable exercise name is claimed but not shown.**
//     Decision (b) makes naming the exercise the whole reason the late case
//     reads correctly, so a pill that cannot name one is worse than no
//     pill. The row still keeps its mark, and the set is still claimed so a
//     later replay does not try again.
//
// (f) **`personal_record_hit` fires per TYPE, and never twice for one set.**
//     The event's own shape is singular (`record_type`), so a set that took
//     three records is three events — and the store's claim is what keeps
//     an outbox replay from making it six. Ids and counts only: the weight
//     that achieved it is a body-adjacent value and has no field to travel
//     in (`CLAUDE.md` §20, `analytics-events` §3).

export interface UsePRCelebrationOptions {
  /** `local_workout_sessions.client_local_id` — the session being logged. */
  sessionLocalId: string;
  /** The prefetched prescription, for the exercise name. `null` before it loads. */
  payload: LocalSessionPayload | null;
  /**
   * Display only — the record is kilograms, always (`CLAUDE.md` §0).
   * Passed in rather than read from `useWeightUnit()` here so this hook owes
   * nothing to a query provider: it is the session's listener, and a
   * subscription that needed a network client to register would be one more
   * thing between a confirmed record and the client seeing it.
   */
  unit: WeightUnit;
  /**
   * False once the session is no longer `in_progress` — decision (c).
   * The caller is the one place that holds both the session row and the
   * screen, so it is the one place that can answer this.
   */
  enabled: boolean;
}

/**
 * Subscribes the session to its own record confirmations.
 *
 * Renders nothing and returns nothing: what it produces is store state, and
 * `../components/PRCelebration.tsx` is what draws it.
 */
export function usePRCelebration({
  sessionLocalId,
  payload,
  unit,
  enabled,
}: UsePRCelebrationOptions): void {
  const openSession = usePRCelebrationStore((state) => state.openSession);

  useEffect(() => {
    openSession(sessionLocalId);
  }, [openSession, sessionLocalId]);

  useEffect(() => {
    if (!enabled) return;

    return subscribeOutboxResults((sent) => {
      const confirmed = readConfirmedRecords(sent);
      if (confirmed === null) return;
      if (confirmed.sessionLocalId !== sessionLocalId) return;

      // The guard. `null` means this exact set has already been
      // celebrated — an outbox replay of one mutation, which the server
      // answers identically by design.
      const { claim, present } = usePRCelebrationStore.getState();
      const token = claim({
        setLocalId: confirmed.setLocalId,
        sessionLocalId: confirmed.sessionLocalId,
      });
      if (token === null) return;

      // Decision (f). Before the pill, so a record is counted even when
      // decision (e) leaves it unworded — and wrapped, because by this
      // point the record is real and an analytics failure must not be
      // allowed to swallow it (`ERRORS.md` ER§3).
      try {
        for (const type of confirmed.types) {
          trackEvent('personal_record_hit', {
            exercise_id: asUuid(confirmed.exerciseId),
            record_type: PR_ANALYTICS_TYPE[type],
          });
        }
      } catch {
        // An analytics failure is silent (`ERRORS.md` ER§3).
      }

      // Decision (e). The device's own copy of the prescription, never the
      // response — the server answers with an id, and the name belongs to
      // the exercise library the device already holds.
      const exerciseName = payload?.exercises.find(
        (exercise) => exercise.id === confirmed.exerciseId,
      )?.name;
      if (exerciseName === undefined) return;

      const view = buildCelebration(confirmed, { exerciseName, unit, token });
      if (view === null) return;

      present(view);
    });
  }, [enabled, payload, sessionLocalId, unit]);
}
