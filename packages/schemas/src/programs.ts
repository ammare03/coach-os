// Input schemas for `programs.*` (get, create, update, and the week/day
// CRUD beneath them). `create` was filled by `phase-06-onboarding/
// coach-onboarding/03`; `program-builder/01` extends it to the full
// multi-week shape and adds the rest.
import { z } from 'zod';

import { id, MAX_NOTE_TEXT, MAX_SHORT_TEXT, strictObject } from './primitives.ts';

// Every bound below mirrors a `CHECK` in DB§5.2, and nothing here invents
// one the database does not have.

/** `program_days_day_number_check` — `BETWEEN 1 AND 7`. */
const MAX_DAYS_PER_WEEK = 7;

/** `programs_duration_weeks_check` — `BETWEEN 1 AND 104`. */
const MIN_DURATION_WEEKS = 1;
const MAX_DURATION_WEEKS = 104;

/**
 * `program_weeks_week_number_check` is only `> 0` — the ceiling is the
 * program's own `duration_weeks` bound, because a week outside the
 * program's declared length is a week no assignment can ever schedule.
 * Bounding here rather than at `smallint`'s 32767 is a product decision,
 * recorded rather than assumed (`program-builder/01`).
 */
const MAX_WEEK_NUMBER = MAX_DURATION_WEEKS;

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

/**
 * The bounds the builder UI prints as sub-labels *before* the coach can
 * reach them — "1–104 weeks" under the length stepper, seven day slots and
 * no eighth. A constraint a coach can read in advance is guidance; the same
 * constraint delivered as a rejection is a wall, so both surfaces read the
 * numbers from here rather than restating them.
 */
export const PROGRAM_BOUNDS = {
  minDurationWeeks: MIN_DURATION_WEEKS,
  maxDurationWeeks: MAX_DURATION_WEEKS,
  maxWeekNumber: MAX_WEEK_NUMBER,
  minDayNumber: 1,
  maxDayNumber: MAX_DAYS_PER_WEEK,
} as const;

const programName = z.string().trim().min(1).max(MAX_SHORT_TEXT);
const programNotes = z.string().trim().max(MAX_NOTE_TEXT);
const durationWeeks = z.number().int().min(MIN_DURATION_WEEKS).max(MAX_DURATION_WEEKS);
const weekNumber = z.number().int().min(1).max(MAX_WEEK_NUMBER);
const dayNumber = z.number().int().min(1).max(MAX_DAYS_PER_WEEK);

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
  name: programName,
  exercises: z.array(programExerciseInput).max(MAX_EXERCISES_PER_DAY),
});

/**
 * `programs.create`. Two callers, one shape: onboarding
 * (`coach-onboarding/03`) sends `name` + `days` and lets everything else
 * default; the builder's details sheet (`program-builder/01`, frame 1h)
 * sends `name`, `description` and `durationWeeks` and no days at all.
 *
 * **This is a simplified INPUT for one of them, not a simplified data
 * model.** The rows it writes are ordinary `training.programs` /
 * `program_weeks` / `program_days` / `program_exercises` rows either way,
 * so P07's full builder opens an onboarding-created program and extends it
 * to twelve weeks with supersets and tempo without a migration. That
 * equivalence is the task's whole safeguard, and the reason this stayed one
 * procedure rather than becoming two.
 *
 * A day with no exercises is valid — a coach who names three days and fills
 * one has still made a real program (`coach-onboarding/03`). So is a
 * program with no days at all: the builder creates the shell first and
 * fills it afterwards.
 */
export const createProgramInput = strictObject({
  name: programName,
  description: programNotes.optional(),
  durationWeeks: durationWeeks.optional(),
  days: z.array(programDayInput).min(1).max(MAX_DAYS_PER_WEEK).optional(),
});
export type CreateProgramInput = z.infer<typeof createProgramInput>;

/** The builder's own read — one program with every week and day beneath it. */
export const getProgramInput = strictObject({ programId: id });
export type GetProgramInput = z.infer<typeof getProgramInput>;

/**
 * The details sheet, frame 1h. Every field is optional and only the ones
 * present are written, so the sheet can save a renamed program without
 * having to resend a description it never showed. `description` is
 * nullable — clearing the notes is a real edit, and an absent key would be
 * indistinguishable from "leave it alone" without it.
 */
export const updateProgramInput = strictObject({
  programId: id,
  name: programName.optional(),
  description: programNotes.nullable().optional(),
  durationWeeks: durationWeeks.optional(),
});
export type UpdateProgramInput = z.infer<typeof updateProgramInput>;

/**
 * `weekNumber` is optional and defaults, server-side, to one past the
 * program's current last week — "Add week" appends, and asking the UI to
 * compute the next number is asking two devices to race for it.
 */
export const createProgramWeekInput = strictObject({
  programId: id,
  weekNumber: weekNumber.optional(),
  notes: programNotes.optional(),
});
export type CreateProgramWeekInput = z.infer<typeof createProgramWeekInput>;

export const deleteProgramWeekInput = strictObject({ programWeekId: id });
export type DeleteProgramWeekInput = z.infer<typeof deleteProgramWeekInput>;

/**
 * `dayNumber` is 1 (Monday) through 7 (Sunday) — a slot in the week, not a
 * position in a list. The builder's add-day sheet renders all seven and
 * makes the taken ones inert, so the collision is prevented rather than
 * reported (`program-builder/01`, frame 1g's rule applied to creation).
 */
export const createProgramDayInput = strictObject({
  programWeekId: id,
  dayNumber,
  name: programName,
  isRestDay: z.boolean().optional(),
  notes: programNotes.optional(),
});
export type CreateProgramDayInput = z.infer<typeof createProgramDayInput>;

export const updateProgramDayInput = strictObject({
  programDayId: id,
  dayNumber: dayNumber.optional(),
  name: programName.optional(),
  isRestDay: z.boolean().optional(),
  notes: programNotes.nullable().optional(),
});
export type UpdateProgramDayInput = z.infer<typeof updateProgramDayInput>;

export const deleteProgramDayInput = strictObject({ programDayId: id });
export type DeleteProgramDayInput = z.infer<typeof deleteProgramDayInput>;
