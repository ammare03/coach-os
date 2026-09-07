import {
  schema,
  type DbClient,
  type Exercise,
  type Program,
  type ProgramDay,
  type ProgramExercise,
  type ProgramWeek,
} from '@coachos/db';
import { parseNumeric } from '@coachos/utils';
import { asc, eq, inArray } from 'drizzle-orm';

import { INTENSITY_SCALE, WEIGHT_SCALE } from './program-exercise-targets.ts';
import type { AlternativeExercise } from './set-alternatives.ts';

// `programs.days.get` — everything the program day screen renders
// (`program-builder/02`, frame 1b), in one round trip: the day itself, the
// week and program it sits in, the seven-slot strip across the top, and
// every exercise block with its full target set.
//
// One procedure, not four, for the same reason `getProgram` is one:
// `UI-UX.md` §UX3 forbids a query waterfall, and §19 budgets this screen at
// 800ms p75. Ownership is `ownsResource('programDay', …)` in the router.

/**
 * Projections of the Drizzle row types, never a hand-written mirror
 * (`code-conventions` §3). The two `numeric` columns are the exception:
 * they leave Drizzle as strings and are parsed once, here, at the boundary
 * (`packages/utils`' `parseNumeric`).
 */
export type ProgramExerciseDetail = Pick<
  ProgramExercise,
  | 'id'
  | 'exerciseId'
  | 'orderIndex'
  | 'targetSets'
  | 'targetRepsMin'
  | 'targetRepsMax'
  | 'targetRir'
  | 'targetRestSeconds'
  | 'tempo'
  | 'supersetGroup'
  | 'coachNotes'
> & {
  targetRpe: number | null;
  targetPercent1rm: number | null;
  /** Kilograms, as stored — the screen converts for display and never the other way (DB§5.1.1). */
  targetWeightKg: number | null;
  /** Denormalised for display only — the block is named after the exercise it points at. */
  exerciseName: Exercise['name'];
  exercisePrimaryMuscle: Exercise['primaryMuscle'];
  exerciseEquipment: Exercise['equipment'];
  /**
   * What the approved-swaps sheet opens its pattern filter on — a swap
   * already knows what it is replacing (`program-builder/05`, frame 1f).
   */
  exerciseMovementPattern: Exercise['movementPattern'];
  /**
   * The coach-approved swap list (`program-builder/05`), resolved to names
   * in this same round trip rather than left as the bare `uuid[]` the
   * column holds — the sheet shows the current answer as named chips, and
   * a second query to learn those names is the waterfall `UI-UX.md` §UX3
   * forbids.
   *
   * **Resolved by id alone, with no visibility predicate**, exactly as
   * `exerciseName` above is joined for the block's own `exercise_id`. The
   * gate is the write path (`setAlternatives`), which is where "may this
   * coach reference this exercise" is a live question; re-asking it here
   * would be a second definition of the same rule and would answer
   * differently the day P25's assistant coaches read a root's program.
   * The `filter` in the mapping below is what drops an id naming nothing —
   * the column has no foreign key, so a row deleted out from under it is
   * the one case reading cannot assume away.
   */
  alternatives: AlternativeExercise[];
};

/** One slot in the day strip. The sibling days of this day's own week. */
export type ProgramDaySlot = Pick<ProgramDay, 'id' | 'dayNumber' | 'name' | 'isRestDay'>;

export type ProgramDayDetail = Pick<
  ProgramDay,
  'id' | 'dayNumber' | 'name' | 'notes' | 'isRestDay'
> & {
  programId: Program['id'];
  programName: Program['name'];
  programWeekId: ProgramWeek['id'];
  weekNumber: ProgramWeek['weekNumber'];
  siblingDays: ProgramDaySlot[];
  exercises: ProgramExerciseDetail[];
};

export async function getProgramDay(
  db: DbClient,
  programDayId: string,
): Promise<ProgramDayDetail | null> {
  const [day] = await db
    .select({
      id: schema.programDays.id,
      dayNumber: schema.programDays.dayNumber,
      name: schema.programDays.name,
      notes: schema.programDays.notes,
      isRestDay: schema.programDays.isRestDay,
      programWeekId: schema.programDays.programWeekId,
      weekNumber: schema.programWeeks.weekNumber,
      programId: schema.programs.id,
      programName: schema.programs.name,
    })
    .from(schema.programDays)
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .innerJoin(schema.programs, eq(schema.programs.id, schema.programWeeks.programId))
    .where(eq(schema.programDays.id, programDayId))
    .limit(1);
  if (!day) return null;

  const siblingDays = await db
    .select({
      id: schema.programDays.id,
      dayNumber: schema.programDays.dayNumber,
      name: schema.programDays.name,
      isRestDay: schema.programDays.isRestDay,
    })
    .from(schema.programDays)
    .where(eq(schema.programDays.programWeekId, day.programWeekId))
    .orderBy(asc(schema.programDays.dayNumber));

  const exerciseRows = await db
    .select({
      id: schema.programExercises.id,
      exerciseId: schema.programExercises.exerciseId,
      orderIndex: schema.programExercises.orderIndex,
      targetSets: schema.programExercises.targetSets,
      targetRepsMin: schema.programExercises.targetRepsMin,
      targetRepsMax: schema.programExercises.targetRepsMax,
      targetRpe: schema.programExercises.targetRpe,
      targetRir: schema.programExercises.targetRir,
      targetPercent1rm: schema.programExercises.targetPercent1rm,
      targetWeightKg: schema.programExercises.targetWeightKg,
      targetRestSeconds: schema.programExercises.targetRestSeconds,
      tempo: schema.programExercises.tempo,
      supersetGroup: schema.programExercises.supersetGroup,
      coachNotes: schema.programExercises.coachNotes,
      alternatives: schema.programExercises.alternatives,
      exerciseName: schema.exercises.name,
      exercisePrimaryMuscle: schema.exercises.primaryMuscle,
      exerciseEquipment: schema.exercises.equipment,
      exerciseMovementPattern: schema.exercises.movementPattern,
    })
    .from(schema.programExercises)
    .innerJoin(schema.exercises, eq(schema.exercises.id, schema.programExercises.exerciseId))
    .where(eq(schema.programExercises.programDayId, programDayId))
    // `order_index`, never insertion order: the list the coach arranged is
    // the list the client is shown, and `program-builder/03` moves rows by
    // rewriting exactly this column.
    .orderBy(asc(schema.programExercises.orderIndex));

  // One query for every block's swap list, not one per block — a day of
  // 30 blocks would otherwise be 30 round trips inside the one this screen
  // is allowed (`UI-UX.md` §UX3, §19's 800ms p75).
  const alternativeIds = [...new Set(exerciseRows.flatMap((row) => row.alternatives))];
  const alternativeNames =
    alternativeIds.length === 0
      ? new Map<string, AlternativeExercise>()
      : new Map(
          (
            await db
              .select({ id: schema.exercises.id, name: schema.exercises.name })
              .from(schema.exercises)
              .where(inArray(schema.exercises.id, alternativeIds))
          ).map((row) => [row.id, row]),
        );

  return {
    ...day,
    siblingDays,
    exercises: exerciseRows.map((row) => ({
      ...row,
      targetRpe: row.targetRpe === null ? null : parseNumeric(row.targetRpe, INTENSITY_SCALE),
      targetPercent1rm:
        row.targetPercent1rm === null ? null : parseNumeric(row.targetPercent1rm, INTENSITY_SCALE),
      targetWeightKg:
        row.targetWeightKg === null ? null : parseNumeric(row.targetWeightKg, WEIGHT_SCALE),
      // The coach's own order, not the query's — `IN (…)` has none, and
      // the order the chips and the client's swap sheet show is the order
      // the coach approved them in.
      alternatives: row.alternatives
        .map((id) => alternativeNames.get(id))
        .filter((exercise): exercise is AlternativeExercise => exercise !== undefined),
    })),
  };
}
