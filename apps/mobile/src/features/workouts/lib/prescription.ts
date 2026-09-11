import type { UpcomingSessionExercise } from 'api/src/features/workouts/upcoming.ts';

import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';

// `session-runtime/09` — the one place the logger decides WHICH
// prescription a session is being rendered from.
//
// ==================== THE RULE THIS FILE EXISTS FOR ====================
//
// **A session in progress is frozen. Coach edits apply from the next one.**
//
// `offline-sync` §5 makes coach-authored data server-wins, and taken
// literally that lets a coach editing Tuesday at 18:04 rewrite what a
// client is lifting at 18:03 — the prescribed sets changing between set 2
// and set 3, mid-lift. `workouts.start` freezes the day into
// `workout_sessions.program_snapshot` (DB§14.6) precisely so this module
// can refuse to show the edit until the session ends.
//
// **This is a sequencing rule, not a locking one.** Nothing is blocked:
// the coach's save lands normally and the client's session continues
// normally. Neither waits for the other.
//
// ========================= WHY IT IS ONE FILE =========================
//
// `hooks/useExerciseTarget.ts` (the target line) and `./exercise-pages.ts`
// (the pager and the rail) both read the prescription, and they must never
// disagree: a target line resolved from the frozen copy under a page built
// from the live one would show a client the right numbers on the wrong
// exercise. So the switch is here, both call it, and neither knows which
// side it got — `resolvePrescription` returns the same shape either way.
//
// It is also NOT done by writing the snapshot into `payload_json`'s
// `session.exercises` on the way in. That column would then mean two
// different things depending on `session.status`, and every future reader
// would have to know which — the trap `useExerciseTarget.ts`'s header
// names explicitly.
//
// ============================== OFFLINE ==============================
//
// A device with no signal receives no edit, so its live copy IS the frozen
// one and this function returns the same blocks either way. The snapshot
// makes the ONLINE case match the offline one, rather than the reverse —
// which is why the rendered session is identical in both.

/** `true` once the client has begun and before they have finished. */
function isFrozen(payload: LocalSessionPayload): boolean {
  return payload.session.status === 'in_progress';
}

/**
 * What this client is being asked to do, right now.
 *
 * The frozen copy for a session in progress that has one; the coach's live
 * program day otherwise. An empty list for a session with no prescription
 * at all — an ad-hoc one, or a payload that would not read.
 *
 * `programSnapshot: []` is a real answer and is NOT treated as absent: a
 * coach may freeze a day with no blocks on it, and falling back to live
 * there would unfreeze the session the moment they added one. Only `null`
 * — never written, or written by a build whose envelope the server could
 * not read — falls back.
 */
export function resolvePrescription(
  payload: LocalSessionPayload | null,
): UpcomingSessionExercise[] {
  if (payload === null) return [];
  const frozen = payload.session.programSnapshot;
  if (isFrozen(payload) && frozen !== null) return frozen;
  return payload.session.exercises;
}

function sameAlternatives(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameBlock(a: UpcomingSessionExercise, b: UpcomingSessionExercise): boolean {
  return (
    a.programExerciseId === b.programExerciseId &&
    a.exerciseId === b.exerciseId &&
    a.orderIndex === b.orderIndex &&
    a.targetSets === b.targetSets &&
    a.targetRepsMin === b.targetRepsMin &&
    a.targetRepsMax === b.targetRepsMax &&
    a.targetRpe === b.targetRpe &&
    a.targetRir === b.targetRir &&
    a.targetWeightKg === b.targetWeightKg &&
    a.targetPercent1rm === b.targetPercent1rm &&
    a.targetRestSeconds === b.targetRestSeconds &&
    a.tempo === b.tempo &&
    a.supersetGroup === b.supersetGroup &&
    a.coachNotes === b.coachNotes &&
    sameAlternatives(a.alternatives, b.alternatives)
  );
}

/**
 * Whether the coach has changed this day since the client started it —
 * the condition `ProgramChangedNotice` renders on (`ERRORS.md` ER§1.5's
 * `PROGRAM_CHANGED_MID_SESSION`, filed there as *not an error*).
 *
 * Derived by comparing the two copies the device already holds rather than
 * asked of the server: it costs no request, it is right the moment the
 * prefetch that carried the edit lands, and it is correctly **false**
 * offline, where no edit can have arrived.
 *
 * Compared field by field, in order, rather than by serialising both: the
 * two sides travel through JSONB and through superjson respectively, and
 * `JSON.stringify` equality would be an assertion about key order in two
 * different pipelines. Order itself is part of the comparison — a coach who
 * only reorders the day has still changed what the client is being shown
 * next.
 */
export function hasProgramChanged(payload: LocalSessionPayload | null): boolean {
  if (payload === null || !isFrozen(payload)) return false;
  const frozen = payload.session.programSnapshot;
  if (frozen === null) return false;

  const live = payload.session.exercises;
  if (live.length !== frozen.length) return true;
  return !frozen.every((block, index) => {
    const counterpart = live[index];
    return counterpart !== undefined && sameBlock(block, counterpart);
  });
}
