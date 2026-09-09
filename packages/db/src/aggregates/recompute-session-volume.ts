// PLACEHOLDER — DB§8.2. Real volume logic (sum of weight_kg * reps across
// non-warmup, non-deleted sets) belongs to
// phase-09-workout-logger/session-runtime/07-completion.md, not here. See
// README.md.
//
// F6 (pre-phase-09 audit): throws rather than writing '0'. `workouts.complete`
// (session-runtime/07) is about to call this on every real session
// completion — a stub that wrote '0' would look like an unusually light
// session, not missing data. Matching recompute-personal-records.ts's
// precedent: no safe placeholder value, so this writes nothing at all.
import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction that marks a
 * `training.workout_sessions` row completed.
 */
export async function recomputeSessionVolume(
  _tx: Transaction,
  workoutSessionId: string,
): Promise<void> {
  throw new Error(
    `recomputeSessionVolume(${workoutSessionId}) is unimplemented — ` +
      'phase-09-workout-logger/session-runtime/07-completion.md owns the real volume formula. ' +
      'Do not call this stub from a real write path.',
  );
}
