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
import { asc, eq } from 'drizzle-orm';

import { INTENSITY_SCALE } from './program-exercise-targets.ts';

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
  /** Denormalised for display only — the block is named after the exercise it points at. */
  exerciseName: Exercise['name'];
  exercisePrimaryMuscle: Exercise['primaryMuscle'];
  exerciseEquipment: Exercise['equipment'];
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
      targetRestSeconds: schema.programExercises.targetRestSeconds,
      tempo: schema.programExercises.tempo,
      supersetGroup: schema.programExercises.supersetGroup,
      coachNotes: schema.programExercises.coachNotes,
      exerciseName: schema.exercises.name,
      exercisePrimaryMuscle: schema.exercises.primaryMuscle,
      exerciseEquipment: schema.exercises.equipment,
    })
    .from(schema.programExercises)
    .innerJoin(schema.exercises, eq(schema.exercises.id, schema.programExercises.exerciseId))
    .where(eq(schema.programExercises.programDayId, programDayId))
    // `order_index`, never insertion order: the list the coach arranged is
    // the list the client is shown, and `program-builder/03` moves rows by
    // rewriting exactly this column.
    .orderBy(asc(schema.programExercises.orderIndex));

  return {
    ...day,
    siblingDays,
    exercises: exerciseRows.map((row) => ({
      ...row,
      targetRpe: row.targetRpe === null ? null : parseNumeric(row.targetRpe, INTENSITY_SCALE),
      targetPercent1rm:
        row.targetPercent1rm === null ? null : parseNumeric(row.targetPercent1rm, INTENSITY_SCALE),
    })),
  };
}
