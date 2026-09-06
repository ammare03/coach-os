// Input schemas for `programs.*` (list, get, create, duplicate, update,
// delete, assign). `create` is filled by `phase-06-onboarding/
// coach-onboarding/03`; the rest by phase-07-exercise-and-program-authoring.
import { z } from 'zod';

import { id, MAX_SHORT_TEXT, strictObject } from './primitives.ts';

// Every bound below mirrors a `CHECK` in DB§5.2, and nothing here invents
// one the database does not have.

/** `program_days_day_number_check` — `BETWEEN 1 AND 7`. */
const MAX_DAYS_PER_WEEK = 7;

/** `program_exercises_target_sets_check` — `BETWEEN 1 AND 20`. */
const MAX_TARGET_SETS = 20;

/**
 * No `CHECK` bounds reps from above — `target_reps_min > 0` and
 * `target_reps_max >= target_reps_min` are all DB§5.2 states, and the
 * column is a `smallint`. Bounded here at that column's own ceiling rather
 * than at a made-up "sensible" rep count, which would reject a legitimate
 * 100-rep set the database would have accepted.
 */
const MAX_REPS = 32767;

/**
 * Headroom, not a target: onboarding drafts three days of a handful of
 * exercises each. It is what stands between this procedure and an
 * unbounded insert loop.
 */
const MAX_EXERCISES_PER_DAY = 30;

const programExerciseInput = strictObject({
  exerciseId: id,
  targetSets: z.number().int().min(1).max(MAX_TARGET_SETS),
  targetRepsMin: z.number().int().min(1).max(MAX_REPS),
  targetRepsMax: z.number().int().min(1).max(MAX_REPS),
}).refine((value) => value.targetRepsMax >= value.targetRepsMin, {
  message: 'The top of a rep range cannot be below the bottom of it.',
  path: ['targetRepsMax'],
});

const programDayInput = strictObject({
  name: z.string().trim().min(1).max(MAX_SHORT_TEXT),
  exercises: z.array(programExerciseInput).max(MAX_EXERCISES_PER_DAY),
});

/**
 * `programs.create` (`coach-onboarding/03`) — one week's worth of days,
 * which is what onboarding's simplified builder produces.
 *
 * **This is a simplified INPUT, not a simplified data model.** The rows it
 * writes are ordinary `training.programs` / `program_weeks` /
 * `program_days` / `program_exercises` rows, so P07's full builder opens
 * this program and extends it to twelve weeks with supersets and tempo
 * without a migration. That equivalence is the task's whole safeguard, and
 * the reason this schema is a subset of P07's eventual one rather than a
 * different shape.
 *
 * A day with no exercises is valid — a coach who names three days and fills
 * one has still made a real program (`coach-onboarding/03`).
 */
export const createProgramInput = strictObject({
  name: z.string().trim().min(1).max(MAX_SHORT_TEXT),
  days: z.array(programDayInput).min(1).max(MAX_DAYS_PER_WEEK),
});
export type CreateProgramInput = z.infer<typeof createProgramInput>;
