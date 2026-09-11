import type { ExerciseTarget } from '@coachos/utils';
import { useEffect, useMemo, useState } from 'react';

import { getLocalDb } from '../../../db/client.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';
import {
  readPreviousSession,
  type LastPerformance,
  type PreviousSession,
} from '../lib/last-performance.ts';
import { resolvePrescription } from '../lib/prescription.ts';

// `session-runtime/04` — what one exercise page's target line is made of.
//
// ================== THE ONE RULE THIS FILE EXISTS FOR ==================
//
// **The prescription is resolved live and is never cached here.** Not
// memoised past the payload it came from, not stored, not flattened into a
// string and kept. `resolveTarget` runs on every render against whatever
// `payload` it was handed.
//
// That is not a style preference. `CLAUDE.md` §27 (confirmed 8 Sep 2026)
// settles the model: a client's assignment points at the coach's program
// template LIVE — `programs.version` is a change counter, not a per-session
// pin — and `phase-07-.../assignment/04`'s bulk-edit capability is verified
// by editing a program and watching THIS line change. A cache here would
// break that silently: the feature would look built and would not work, and
// the failure would surface as a coach swearing they changed something.
//
// The chain is live end to end for a scheduled session: `program_exercises`
// → `workouts.upcoming` (a `Pick` of the row, no materialised copy) →
// `lib/prefetch/sessions.ts` → `local_workout_sessions.payload_json` → the
// `payload` argument below. The device row is the offline mirror, which
// `offline-sync` §5 makes SERVER-WINS for coach-authored data and which
// every foreground prefetch rewrites — so a coach's edit reaches the client
// on the next pass, which is before a not-yet-started session is opened.
//
// ===================== WHERE TASK 09 PLUGGED IN ========================
//
// **Done, and it is one line.** `09-program-snapshot.md` freezes an
// IN-PROGRESS session against `workout_sessions.program_snapshot` (DB§14.6)
// so a coach's mid-session edit lands on the NEXT session. That is not a
// contradiction of the rule above — live is the model, and the snapshot is
// the exception a *started* session buys.
//
//   `resolveTarget` was the seam and `../lib/prescription.ts` is now what
//   it asks. `TargetLine`, the copy module, and the last-performance reader
//   did not move, because none of them knows where an `ExerciseTarget` came
//   from.
//
// The snapshot is NOT written into `payload_json`'s `session.exercises` on
// the way in: that field would then mean two different things depending on
// the session's status, and `lib/exercise-pages.ts` reads it too. It rides
// beside it as `session.programSnapshot`, and `resolvePrescription` is the
// single place either is chosen between.
//
// =======================================================================
//
// The two halves resolve independently and on purpose. The prescription is
// already in memory, so it is synchronous; "last time" is a SQLite read, so
// it is not. A client whose history read fails still sees what their coach
// asked for, and vice versa — `UI-UX.md` §UX8's "the primary action works
// when every optional section fails", applied inside one small block.

/**
 * The history half's own lifecycle — it degrades without taking the target
 * with it.
 *
 * `ready` carries the same answer at two grains, read in one pass:
 *
 * - `last` is the exercise-level number `session-runtime/04`'s `TargetLine`
 *   prints. Exactly `previous?.last ?? null`; it stays a field of its own
 *   only because that component reads it.
 * - `previous` is `set-entry/03`'s per-set-number map. `null` means the
 *   client has never logged this exercise; present-but-missing-set-N means
 *   the previous session simply had no set N. The two render differently
 *   (nothing, versus the composer's "no set N last time"), so a consumer
 *   must not collapse them.
 */
export type LastPerformanceState =
  | { kind: 'loading' }
  | { kind: 'ready'; last: LastPerformance | null; previous: PreviousSession | null }
  | { kind: 'error' };

export interface ExerciseTargetState {
  /**
   * The coach's prescription, resolved live. `null` is not a failure: an
   * ad-hoc session has no `program_day_id` and therefore no block, and an
   * exercise inserted mid-session has none either.
   *
   * **This is what the coach AUTHORED.** `session-modifications/04` layers
   * a live mid-session adjustment on top of it, additively and outside this
   * file — `useLiveTarget` in `./useLiveTargetOverride.ts`. It is not
   * folded in here on purpose: this hook's one rule is that the
   * prescription is read through live on every render, and a consumer that
   * could not still see the authored value would have no way to show the
   * client what their coach changed it from.
   */
  target: ExerciseTarget | null;
  history: LastPerformanceState;
}

export interface UseExerciseTargetOptions {
  page: ExercisePage;
  /**
   * The live prescription mirror. **The task-09 seam** — see the header.
   * `null` while the session row is still loading, or for a session that
   * carries no prescription at all.
   */
  payload: LocalSessionPayload | null;
  /** `local_workout_sessions.client_local_id` of the session being logged. */
  sessionLocalId: string;
}

/**
 * The block this page is prescribed by, or `null`.
 *
 * Matched on `programExerciseId`, which is `ExercisePage.key` — never on
 * `exerciseId`, which a day may legitimately carry twice (a coach who
 * programs bench heavy early and as a back-off later), and never on the
 * page's index, which drifts the moment a coach reorders the day.
 *
 * Returns the `ExerciseTarget` shape `packages/utils` formats, which
 * `UpcomingSessionExercise` already satisfies field-for-field — no mapping,
 * no re-declaration, so a schema change fails typecheck here
 * (`code-conventions` §3).
 */
export function resolveTarget(
  page: ExercisePage,
  payload: LocalSessionPayload | null,
): ExerciseTarget | null {
  // `resolvePrescription`, never `payload.session.exercises` directly —
  // task 09's seam, and the only line in this file it changed. It hands
  // back the LIVE program day for a session that has not started and the
  // copy FROZEN at `started_at` for one that has (DB§14.6), so a coach's
  // mid-session edit cannot move a target under a client who is lifting.
  // `lib/exercise-pages.ts` calls the same function, which is what keeps
  // the page and its target line describing the same exercise.
  const block = resolvePrescription(payload).find(
    (candidate) => candidate.programExerciseId === page.key,
  );
  return block ?? null;
}

export function useExerciseTarget(options: UseExerciseTargetOptions): ExerciseTargetState {
  const { page, payload, sessionLocalId } = options;

  // Read through on every render — the header's one rule. `useMemo` here is
  // keyed on the payload identity and the page, so a rewritten payload (a
  // coach's edit arriving through prefetch) produces a new object and a new
  // target; it is a render-cost optimisation and never a cache.
  const target = useMemo(() => resolveTarget(page, payload), [page, payload]);

  const exerciseId = page.exerciseId;
  // `\u0000` cannot occur in a uuid, so no pair of ids can collide into one key.
  const readKey = `${exerciseId}\u0000${sessionLocalId}`;

  const [entry, setEntry] = useState<{ key: string; state: LastPerformanceState }>(() => ({
    key: readKey,
    state: { kind: 'loading' },
  }));

  // Derived during render, NOT reset inside the effect. Two reasons, and
  // both matter: `react-hooks/set-state-in-effect` forbids the cascade, and
  // — the correctness half — a page turn changes the key, so the previous
  // exercise's "last time" can never be shown for even one frame under the
  // new exercise's name. Reading "60kg × 9" from the bench under a row is
  // exactly the kind of wrong number this line exists to prevent.
  const history: LastPerformanceState = entry.key === readKey ? entry.state : { kind: 'loading' };

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const db = await getLocalDb();
        // One read for both grains — see `readPreviousSession`. A per-row
        // read would be a query per set row on the screen that is least
        // able to afford one.
        const previous = await readPreviousSession(db, {
          exerciseId,
          excludeSessionLocalId: sessionLocalId,
        });
        if (alive) {
          setEntry({
            key: readKey,
            state: { kind: 'ready', last: previous?.last ?? null, previous },
          });
        }
      } catch {
        // Swallowed into a state, not reported: a missing "last time" is an
        // absent convenience, not a crash, and Sentry must not collect one
        // per page turn for a client whose cache is cold
        // (`code-conventions` §8 — expected failures are handled in the UI).
        if (alive) setEntry({ key: readKey, state: { kind: 'error' } });
      }
    })();

    return () => {
      alive = false;
    };
  }, [exerciseId, sessionLocalId, readKey]);

  return { target, history };
}
