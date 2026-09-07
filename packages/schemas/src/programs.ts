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
const MIN_TARGET_SETS = 1;
const MAX_TARGET_SETS = 20;

/** `program_exercises_target_rpe_check` — `BETWEEN 1 AND 10`. */
const MIN_TARGET_RPE = 1;
const MAX_TARGET_RPE = 10;

/** `program_exercises_target_rir_check` — `BETWEEN 0 AND 10`. */
const MIN_TARGET_RIR = 0;
const MAX_TARGET_RIR = 10;

/** `program_exercises_target_percent_1rm_check` — `BETWEEN 1 AND 150`. */
const MIN_TARGET_PERCENT_1RM = 1;
const MAX_TARGET_PERCENT_1RM = 150;

/**
 * `target_weight_kg` is `numeric(6, 2)` (DB§5.2) and carries no `CHECK` of
 * its own, so both ends below are the column's, not invented ones: four
 * digits before the point puts the ceiling at 9999.99, and the scale puts
 * the floor at the smallest positive value it can hold. **Zero is not a
 * light prescription, it is no prescription** — a bodyweight block clears
 * the field rather than storing 0.00, which is also what keeps
 * `formatTargetScheme` from printing `0kg`.
 *
 * Kilograms, always: `users.weight_unit` decides what the coach types and
 * reads, never what crosses this wire (`CLAUDE.md` §0 / DB§5.1.1).
 */
const MIN_TARGET_WEIGHT_KG = 0.01;
const MAX_TARGET_WEIGHT_KG = 9999.99;

/** The `s` in `numeric(6, 2)` — the same argument `NUMERIC_SCALE_1_STEP` makes, one decimal further. */
const NUMERIC_SCALE_2_STEP = 0.01;

/**
 * `target_rpe` is `numeric(3,1)` and `target_percent_1rm` is `numeric(4,1)`
 * (DB§5.2), so one decimal place is the whole of what either column can
 * hold. Sent 7.25, Postgres would store 7.3 and hand the coach back a
 * number they never typed — a silent rewrite, which is worse than a
 * refusal. This is the column's own scale, not an invented bound
 * (`primitives.ts`'s opening note allows exactly that derivation).
 */
const NUMERIC_SCALE_1_STEP = 0.1;

/**
 * `program_exercises_tempo_check` — `~ '^[0-9X]{4}$'`. Four positions,
 * each a digit or a literal `X` (the "explosive / as fast as possible"
 * convention coaches already write). The builder renders four separate
 * single-character fields against this rather than one free-text box,
 * so the format is shown rather than guessed (`program-builder/02`).
 */
const TEMPO_PATTERN = /^[0-9X]{4}$/;
const TEMPO_DIGITS = 4;

/**
 * `target_rest_seconds` is a bare `smallint` with no `CHECK` (DB§5.2).
 * Bounded here at the column's own ceiling for the same reason `MAX_REPS`
 * is: a made-up "sensible" rest would reject a value the database would
 * have accepted.
 */
const MAX_REST_SECONDS = 32767;

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
 * `program_exercises.alternatives` is a bare `uuid[]` — no `CHECK`, and
 * (uniquely in DB§5.2) no foreign key either, which `training-schema/02`
 * flagged as this feature's responsibility to make good. So every bound on
 * it is chosen here and has to be defended here.
 *
 * **Eight**, because the list's consumer is a client mid-session
 * (`phase-09-workout-logger/session-modifications/02`): the swap sheet is
 * a scannable list of what their coach sanctioned, and somewhere past
 * eight rows it stops being a curated approval and becomes the exercise
 * library again — which is the one thing "coach-approved" exists to
 * prevent. Generous enough that a coach can approve every machine variant
 * of a squat without meeting it, and low enough to be a real ceiling on an
 * otherwise unbounded array write.
 */
const MAX_ALTERNATIVES = 8;

/**
 * `program_exercises_superset_group_check` — `~ '^[A-Z]$'`. One uppercase
 * letter is the whole column, so **the alphabet is the ceiling**: a day
 * holds at most 26 supersets. Written out as a tuple rather than derived
 * from a string at module load, because `z.enum` needs the literal union
 * to type `group` as `'A' | … | 'Z'` and not `string`.
 */
export const SUPERSET_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
] as const;

export type SupersetGroup = (typeof SUPERSET_LETTERS)[number];

/**
 * `CLAUDE.md` §26: a superset is *two or more* exercises performed back to
 * back. A group of one is not a smaller superset, it is a plain exercise
 * wearing a letter — so two is a product floor, not a UI nicety.
 */
const MIN_SUPERSET_MEMBERS = 2;

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
  // The target block's own bounds, printed the same way: "1–20" under the
  // sets stepper, "1–10, half steps" under the RPE one
  // (`program-builder/02`, frame 1c).
  minTargetSets: MIN_TARGET_SETS,
  maxTargetSets: MAX_TARGET_SETS,
  minReps: 1,
  maxReps: MAX_REPS,
  minRpe: MIN_TARGET_RPE,
  maxRpe: MAX_TARGET_RPE,
  minRir: MIN_TARGET_RIR,
  maxRir: MAX_TARGET_RIR,
  minPercent1rm: MIN_TARGET_PERCENT_1RM,
  maxPercent1rm: MAX_TARGET_PERCENT_1RM,
  // Kilograms — the sheet converts to and from the coach's own unit at its
  // own edge and never restates either number (`program-builder/02`).
  minWeightKg: MIN_TARGET_WEIGHT_KG,
  maxWeightKg: MAX_TARGET_WEIGHT_KG,
  maxRestSeconds: MAX_REST_SECONDS,
  tempoDigits: TEMPO_DIGITS,
  maxExercisesPerDay: MAX_EXERCISES_PER_DAY,
  // Printed before the coach can reach either, the same way the week and
  // set bounds are: the commit button says how many blocks it is about to
  // group, and the day says when it has no letters left
  // (`program-builder/04`, frame 1e).
  minSupersetMembers: MIN_SUPERSET_MEMBERS,
  maxSupersetGroupsPerDay: SUPERSET_LETTERS.length,
  // Printed as the swap sheet's own sub-label, and again as the reason the
  // commit goes inert at the ceiling — the same "guidance, not a wall"
  // bargain every bound above makes (`program-builder/05`, frame 1f).
  maxAlternatives: MAX_ALTERNATIVES,
  /**
   * Step sizes, not database bounds — the columns permit one decimal
   * (`NUMERIC_SCALE_1_STEP`) and these are what a coach actually writes.
   * They live here rather than in the form so the sub-label and the
   * stepper cannot disagree about what "half steps" means.
   */
  rpeStep: 0.5,
  rirStep: 1,
  percent1rmStep: 5,
} as const;

const programName = z.string().trim().min(1).max(MAX_SHORT_TEXT);
const programNotes = z.string().trim().max(MAX_NOTE_TEXT);
const durationWeeks = z.number().int().min(MIN_DURATION_WEEKS).max(MAX_DURATION_WEEKS);
const weekNumber = z.number().int().min(1).max(MAX_WEEK_NUMBER);
const dayNumber = z.number().int().min(1).max(MAX_DAYS_PER_WEEK);

/**
 * The one sentence the product says about an inverted rep range, shared by
 * every schema that checks it and by the builder's own live cross-field
 * validation — the message a coach reads while typing and the message the
 * server returns must be the same words, or the inline error and the
 * rejection look like two different problems (`program-builder/02`).
 */
export const REP_RANGE_ORDER_MESSAGE = 'The top of a rep range cannot be below the bottom of it.';

const programExerciseInput = strictObject({
  exerciseId: id,
  targetSets: z.number().int().min(MIN_TARGET_SETS).max(MAX_TARGET_SETS),
  targetRepsMin: z.number().int().min(1).max(MAX_REPS),
  targetRepsMax: z.number().int().min(1).max(MAX_REPS),
}).refine((value) => value.targetRepsMax >= value.targetRepsMin, {
  message: REP_RANGE_ORDER_MESSAGE,
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
  /**
   * `program-templates/01`. Absent means leave it alone, the same bargain
   * every field above makes — the details sheet saves a rename without
   * having to restate what kind of program this is.
   */
  isTemplate: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// The target block — `programs.exercises.*` (`program-builder/02`)
// ---------------------------------------------------------------------------

/**
 * Every field DB§5.2 lets a coach set on one `program_exercises` row, with
 * every bound traceable to that table's own `CHECK`s. Shared verbatim by
 * create and update: the builder's target sheet always sends the whole
 * block, because it always shows the whole block. A partial update would
 * mean "absent" had to mean both "leave alone" and "clear", which is the
 * ambiguity `updateProgramInput`'s `.nullable()` exists to avoid — and
 * there is nothing here worth paying that price for.
 *
 * Every field but `targetSets` is optional, matching the nullable columns:
 * "3 sets, no other instruction" is a real thing a coach programs.
 */
const targetBlockShape = {
  targetSets: z.number().int().min(MIN_TARGET_SETS).max(MAX_TARGET_SETS),
  targetRepsMin: z.number().int().min(1).max(MAX_REPS).optional(),
  targetRepsMax: z.number().int().min(1).max(MAX_REPS).optional(),
  targetRpe: z
    .number()
    .min(MIN_TARGET_RPE)
    .max(MAX_TARGET_RPE)
    .multipleOf(NUMERIC_SCALE_1_STEP)
    .optional(),
  targetRir: z.number().int().min(MIN_TARGET_RIR).max(MAX_TARGET_RIR).optional(),
  /**
   * **Kilograms, on every device, in both directions.** The builder's
   * stepper runs in whatever `users.weight_unit` says, and converts once,
   * at its own edge, through `packages/utils`' `parseWeight` — nothing
   * about the unit reaches this schema, this wire, or that column, which is
   * exactly why there is no `weightUnit` field here to get out of step
   * with the number beside it.
   */
  targetWeightKg: z
    .number()
    .min(MIN_TARGET_WEIGHT_KG)
    .max(MAX_TARGET_WEIGHT_KG)
    .multipleOf(NUMERIC_SCALE_2_STEP)
    .optional(),
  targetPercent1rm: z
    .number()
    .min(MIN_TARGET_PERCENT_1RM)
    .max(MAX_TARGET_PERCENT_1RM)
    .multipleOf(NUMERIC_SCALE_1_STEP)
    .optional(),
  tempo: z.string().trim().max(TEMPO_DIGITS).regex(TEMPO_PATTERN).optional(),
  targetRestSeconds: z.number().int().min(0).max(MAX_REST_SECONDS).optional(),
  coachNotes: programNotes.optional(),
} as const;

/** The subset of the block the three cross-field rules below actually read. */
interface TargetBlockCrossFields {
  targetRepsMin?: number | undefined;
  targetRepsMax?: number | undefined;
  targetRpe?: number | undefined;
  targetRir?: number | undefined;
  targetPercent1rm?: number | undefined;
  targetWeightKg?: number | undefined;
}

export const REP_RANGE_PAIR_MESSAGE = 'A rep range needs both a bottom and a top.';

/**
 * One intensity, not four. DB§5.2 has no `CHECK` for this — it is a
 * product rule from the target sheet's segmented control (RPE · RIR ·
 * % 1RM · Weight), and it is enforced here as well as there because a
 * client that sent two would leave a row the logger's target line cannot
 * render (`phase-09-workout-logger/session-runtime/04`).
 *
 * **An absolute weight is one of the four, not an extra.** "3 × 5 at 40kg
 * at RPE 8" prescribes the same set twice and the two halves can disagree;
 * RPE and % 1RM are relative instructions that presume the client already
 * knows their working load, and a weight is what a coach writes when they
 * do not (`program-builder/02`).
 */
export const SINGLE_INTENSITY_MESSAGE = 'Pick one way to set the intensity.';

function hasOrderedRepRange(value: TargetBlockCrossFields): boolean {
  if (value.targetRepsMin === undefined || value.targetRepsMax === undefined) return true;
  return value.targetRepsMax >= value.targetRepsMin;
}

function hasCompleteRepRange(value: TargetBlockCrossFields): boolean {
  return (value.targetRepsMin === undefined) === (value.targetRepsMax === undefined);
}

function hasAtMostOneIntensity(value: TargetBlockCrossFields): boolean {
  return (
    [value.targetRpe, value.targetRir, value.targetPercent1rm, value.targetWeightKg].filter(
      (intensity) => intensity !== undefined,
    ).length <= 1
  );
}

/**
 * `programs.exercises.create` — the picker-then-target flow's commit
 * (`program-builder/02`, frames 1b and 1c).
 *
 * No `orderIndex`: the server appends past the day's current last row.
 * Asking the UI for a position is asking two devices to race for it, and
 * moving one is `program-builder/03`'s job, not this procedure's.
 */
export const createProgramExerciseInput = strictObject({
  programDayId: id,
  exerciseId: id,
  ...targetBlockShape,
})
  .refine(hasCompleteRepRange, { message: REP_RANGE_PAIR_MESSAGE, path: ['targetRepsMax'] })
  .refine(hasOrderedRepRange, { message: REP_RANGE_ORDER_MESSAGE, path: ['targetRepsMax'] })
  .refine(hasAtMostOneIntensity, { message: SINGLE_INTENSITY_MESSAGE, path: ['targetRpe'] });
export type CreateProgramExerciseInput = z.infer<typeof createProgramExerciseInput>;

/**
 * `programs.exercises.update` — the same sheet, reopened on an existing
 * row. A whole-block replace (see `targetBlockShape`), so an omitted field
 * clears the column rather than leaving it alone. `exerciseId` is absent
 * deliberately: changing *which* exercise a block is is a delete plus an
 * add, not an edit, and `alternatives` (`program-builder/05`) is the
 * feature for offering a different movement.
 */
export const updateProgramExerciseInput = strictObject({
  programExerciseId: id,
  ...targetBlockShape,
})
  .refine(hasCompleteRepRange, { message: REP_RANGE_PAIR_MESSAGE, path: ['targetRepsMax'] })
  .refine(hasOrderedRepRange, { message: REP_RANGE_ORDER_MESSAGE, path: ['targetRepsMax'] })
  .refine(hasAtMostOneIntensity, { message: SINGLE_INTENSITY_MESSAGE, path: ['targetRpe'] });
export type UpdateProgramExerciseInput = z.infer<typeof updateProgramExerciseInput>;

export const deleteProgramExerciseInput = strictObject({ programExerciseId: id });
export type DeleteProgramExerciseInput = z.infer<typeof deleteProgramExerciseInput>;

/** The one sentence the product says about a list that names a block twice. */
export const DUPLICATE_ORDER_MESSAGE = 'An exercise can only appear once in a day.';

function hasDistinctIds(value: { orderedExerciseIds: string[] }): boolean {
  return new Set(value.orderedExerciseIds).size === value.orderedExerciseIds.length;
}

/**
 * `programs.exercises.reorder` — the drop at the end of a drag
 * (`program-builder/03`, frame 1d).
 *
 * `orderedExerciseIds` is the day's **complete** new order, not a move
 * instruction. A `{ from, to }` pair would be evaluated against whatever
 * the server happens to hold, which is not necessarily what the coach was
 * looking at when they let go; a full list lets the server refuse a stale
 * picture outright (`PROGRAM_DAY_ORDER_STALE`) instead of silently
 * reordering something else.
 *
 * The distinctness refinement sits on the OBJECT rather than on the array:
 * the authorisation enumeration test synthesises an input for every
 * procedure and refuses to guess a value for a custom check on an array
 * (`apps/api/src/__tests__/authz/synthesise-input.ts`), so an
 * `.refine()`d array would make this procedure unprobeable.
 *
 * Membership — every id actually belonging to THIS day, and no id missing —
 * is not expressible here and is checked in the resolver against the day's
 * real contents.
 */
export const reorderProgramExercisesInput = strictObject({
  programDayId: id,
  orderedExerciseIds: z.array(id).min(1).max(MAX_EXERCISES_PER_DAY),
}).refine(hasDistinctIds, { message: DUPLICATE_ORDER_MESSAGE, path: ['orderedExerciseIds'] });
export type ReorderProgramExercisesInput = z.infer<typeof reorderProgramExercisesInput>;

/**
 * `programs.days.get` — one day, its exercises with their full target
 * block, and the seven-slot strip the day screen puts above them. One
 * round trip, for the same reason `programs.get` is one (`UI-UX.md` §UX3).
 */
export const getProgramDayInput = strictObject({ programDayId: id });
export type GetProgramDayInput = z.infer<typeof getProgramDayInput>;

// ---------------------------------------------------------------------------
// Supersets — `programs.exercises.setSupersetGroup` (`program-builder/04`)
// ---------------------------------------------------------------------------

/**
 * `programs.exercises.setSupersetGroup` — one selection committed, or one
 * group taken apart (`program-builder/04`, frame 1e).
 *
 * **`group` is a letter the CLIENT picked, not a request for the server to
 * pick one.** The action bar tells the coach which letter they are about to
 * create ("They'll run back to back as superset B") before they commit, so
 * the letter has to exist on the device first; the server's job is to
 * refuse it if the day has moved on since (`PROGRAM_SUPERSET_STALE`). This
 * is exactly `reorder`'s bargain — the client sends the picture it acted
 * on, the server refuses a stale one — and it is why neither procedure can
 * silently do something other than what the coach was shown.
 *
 * `null` clears the letter: ungrouping is the same procedure, so undoing a
 * grouping costs exactly what making one did.
 *
 * **Three rules are NOT expressible here** and are checked in the resolver
 * against the day's real contents, for the same reason `reorder`'s
 * membership check is:
 *   - every id belongs to THIS day (a group may not span two days),
 *   - a grouping names at least `minSupersetMembers` blocks, and they are
 *     consecutive in the day's order (`PROGRAM_SUPERSET_NOT_ADJACENT`),
 *   - the letter is still free, and the day has one to spare
 *     (`PROGRAM_SUPERSET_STALE` / `PROGRAM_SUPERSET_LIMIT_REACHED`).
 *
 * The distinctness refinement sits on the OBJECT, and `exerciseIds` is
 * `.min(1)` rather than `.min(2)`, for one shared reason: the authorisation
 * enumeration test synthesises an input for every procedure, refuses to
 * guess a value for a custom check on an array, and fills an array to its
 * minimum length with the SAME synthesised uuid
 * (`apps/api/src/__tests__/authz/synthesise-input.ts`). A `.min(2)` here
 * would hand that test two identical ids and a refinement that rejects
 * them, which would make this procedure unprobeable.
 */
export const setSupersetGroupInput = strictObject({
  programDayId: id,
  exerciseIds: z.array(id).min(1).max(MAX_EXERCISES_PER_DAY),
  group: z.enum(SUPERSET_LETTERS).nullable(),
}).refine((value) => new Set(value.exerciseIds).size === value.exerciseIds.length, {
  message: DUPLICATE_ORDER_MESSAGE,
  path: ['exerciseIds'],
});
export type SetSupersetGroupInput = z.infer<typeof setSupersetGroupInput>;

// ---------------------------------------------------------------------------
// Coach-approved alternatives — `programs.exercises.setAlternatives`
// (`program-builder/05`)
// ---------------------------------------------------------------------------

/** The one sentence the product says about a swap list that names an exercise twice. */
export const ALTERNATIVE_DUPLICATE_MESSAGE = 'An exercise can only be an approved swap once.';

/**
 * `programs.exercises.setAlternatives` — the commit at the bottom of the
 * approved-swaps sheet (`program-builder/05`, frame 1f).
 *
 * **The COMPLETE approved list, not an add or a remove**, for the same
 * reason `reorder` takes the day's whole order: the sheet shows the current
 * answer as removable chips and the coach edits it in place, so what they
 * commit is a picture, and a picture is what the server should be able to
 * refuse outright rather than merge into something it cannot see. An empty
 * array is therefore meaningful and valid — it is "this block has no
 * approved swaps", which is also how a coach takes the last one away.
 *
 * **Two rules are NOT expressible here** and are checked in the resolver,
 * because both need rows this schema cannot see:
 *   - every id is a real `training.exercises` row the caller may actually
 *     reference — the global library or their own custom exercises. This
 *     array has **no foreign key** (DB§5.2), so nothing but that check
 *     stands between it and a dangling reference, or between a coach and
 *     another coach's custom exercise name leaking into their client's
 *     swap sheet (`EXERCISE_NOT_FOUND`).
 *   - the block's own exercise is not among its alternatives
 *     (`PROGRAM_ALTERNATIVE_IS_ORIGIN`) — the sheet renders that row
 *     dimmed, badged and inert, so this is the floor under a stale client.
 *
 * The distinctness refinement sits on the OBJECT rather than on the array,
 * for the reason `reorder` and `setSupersetGroup` state: the authorisation
 * enumeration test synthesises an input for every procedure and refuses to
 * guess a value for a custom check on an array
 * (`apps/api/src/__tests__/authz/synthesise-input.ts`), so an `.refine()`d
 * array would make this procedure unprobeable.
 */
export const setAlternativesInput = strictObject({
  programExerciseId: id,
  alternativeExerciseIds: z.array(id).max(MAX_ALTERNATIVES),
}).refine(
  (value) => new Set(value.alternativeExerciseIds).size === value.alternativeExerciseIds.length,
  { message: ALTERNATIVE_DUPLICATE_MESSAGE, path: ['alternativeExerciseIds'] },
);
export type SetAlternativesInput = z.infer<typeof setAlternativesInput>;

// ---------------------------------------------------------------------------
// Duplication — `programs.days.duplicate` / `programs.weeks.duplicate`
// (`program-builder/06`)
// ---------------------------------------------------------------------------

/**
 * `programs.days.duplicate` — the copy-to sheet's commit
 * (`program-builder/06`, frame 1g).
 *
 * **Two rows, not one.** `sourceDayId` names what is copied and
 * `targetWeekId` names where it lands, and the router guards BOTH — a
 * single guard on the source would let a coach copy their own day into
 * another coach's week, which is a write into someone else's program.
 *
 * `targetDayNumber` is a slot, 1 (Monday) through 7 (Sunday), exactly as
 * `createProgramDayInput`'s is. The sheet renders all seven and makes the
 * taken ones inert and names their occupant, so `PROGRAM_DAY_TAKEN` is
 * only ever reachable by a stale client — the collision is prevented, not
 * reported.
 *
 * There is no `targetProgramId`: copying ACROSS programs is out of this
 * task's scope (it belongs to `program-templates`), and the resolver
 * refuses a target week in a different program outright rather than
 * quietly performing a copy this procedure does not offer.
 */
export const duplicateProgramDayInput = strictObject({
  sourceDayId: id,
  targetWeekId: id,
  targetDayNumber: dayNumber,
});
export type DuplicateProgramDayInput = z.infer<typeof duplicateProgramDayInput>;

/**
 * `programs.weeks.duplicate` — "Duplicate whole week" in the week kebab
 * (`program-builder/06`, frame 1g).
 *
 * **One row, not two**, and that asymmetry with the day input above is the
 * point: the destination is a week NUMBER inside the source week's own
 * program, so there is no second row to own and nothing to guard beyond
 * `sourceWeekId`. It is also why cross-program duplication is structurally
 * impossible here rather than merely refused.
 *
 * `targetWeekNumber` is optional and defaults, server-side, to one past the
 * program's current last week — the same append that `createProgramWeekInput`
 * makes, and for the same reason: asking the UI to compute the next number
 * is asking two devices to race for it. The menu action sends no number at
 * all, so the coach cannot pick a collision; an explicit number is the
 * stale-client path, and it answers `PROGRAM_WEEK_EXISTS`.
 */
export const duplicateProgramWeekInput = strictObject({
  sourceWeekId: id,
  targetWeekNumber: weekNumber.optional(),
});
export type DuplicateProgramWeekInput = z.infer<typeof duplicateProgramWeekInput>;

// ---------------------------------------------------------------------------
// Whole-program duplication — `programs.duplicate` (`program-templates/02`)
// ---------------------------------------------------------------------------

/**
 * `programs.duplicate` — the whole-program copy (`program-templates/02`).
 *
 * **One row, and the destination is not a row at all.** Unlike
 * `duplicateProgramDayInput`, which names a source and a target week, the copy
 * this makes is a NEW program owned by the caller, so there is nothing to
 * guard but `sourceProgramId` and nothing for it to collide with.
 *
 * `newName` is required rather than defaulted to "X (copy)": a coach
 * duplicating a template is on their way to making a different program out of
 * it, and a server-invented name is one they would have to go and fix.
 *
 * There is no `isTemplate` here — the copy inherits the source's, and
 * `programs.update`'s toggle is how a coach changes it afterwards
 * (`program-templates/01`).
 */
export const duplicateProgramInput = strictObject({
  sourceProgramId: id,
  newName: programName,
});
export type DuplicateProgramInput = z.infer<typeof duplicateProgramInput>;
