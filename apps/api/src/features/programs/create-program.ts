import { schema, type DbClient } from '@coachos/db';

// `programs.create` (`phase-06-onboarding/coach-onboarding/03`) — the
// minimal creation path onboarding step 3 uses.
//
// The UI it serves is simplified; **the rows are not**. One program, one
// week, its days, and each day's exercises, all written to the same tables
// `phase-07-exercise-and-program-authoring/program-builder/` will write to,
// so a coach who onboards with a 1-week, 3-day program opens it in the real
// builder later and extends it with no migration and no special-casing.
// That equivalence is this task's stated safeguard.

export interface CreateProgramExercise {
  exerciseId: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
}

export interface CreateProgramDay {
  name: string;
  exercises: readonly CreateProgramExercise[];
}

export interface CreateProgramInput {
  name: string;
  description?: string | undefined;
  /**
   * The program's declared length. Onboarding omits it and gets one week;
   * the builder's details sheet (frame 1h) sets it with a stepper. Weeks 2..n
   * are authored afterwards through `programs.weeks.create` — declaring
   * twelve weeks does not write twelve empty rows, it states the plan
   * (`program-builder/01`).
   */
  durationWeeks?: number | undefined;
  days?: readonly CreateProgramDay[] | undefined;
}

/**
 * One week. Onboarding asks for a set of days, not a mesocycle — P07 adds
 * weeks 2..n to this same program, which is why `duration_weeks` is a real
 * 1 rather than a placeholder.
 */
const DEFAULT_DURATION_WEEKS = 1;

export async function createProgram(
  db: DbClient,
  coachProfileId: string,
  input: CreateProgramInput,
): Promise<{ id: string }> {
  // One transaction, four tables (`code-conventions` §7). A program with a
  // week but no days, or days but no exercises, is not a partial success —
  // it is a row a coach would have to find and delete.
  return db.transaction(async (tx) => {
    const [program] = await tx
      .insert(schema.programs)
      .values({
        coachId: coachProfileId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        durationWeeks: input.durationWeeks ?? DEFAULT_DURATION_WEEKS,
        // `is_template` keeps its DB§5.2 default of true: this is a program
        // in the coach's library, not one assigned to a client. Assignment
        // is P07's, and it is what produces a non-template program.
      })
      .returning({ id: schema.programs.id });
    if (!program) throw new Error('insert into training.programs did not return a row');

    const [week] = await tx
      .insert(schema.programWeeks)
      .values({ programId: program.id, weekNumber: 1 })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('insert into training.program_weeks did not return a row');

    // `dayNumber` and `orderIndex` are both 1-based, matching the seed
    // (`packages/db/src/seed/programs.ts`) and DB§5.2's
    // `program_days_day_number_check (BETWEEN 1 AND 7)`.
    // A program with no days at all is valid: the builder creates the shell
    // from the details sheet and fills week 1 through "Add day". Drizzle
    // rejects an insert with no values, so the empty case skips the
    // statement rather than sending one.
    const inputDays = input.days ?? [];
    const days =
      inputDays.length > 0
        ? await tx
            .insert(schema.programDays)
            .values(
              inputDays.map((day, index) => ({
                programWeekId: week.id,
                dayNumber: index + 1,
                name: day.name,
              })),
            )
            .returning({ id: schema.programDays.id })
        : [];

    const exerciseRows = inputDays.flatMap((day, dayIndex) => {
      const programDay = days[dayIndex];
      if (!programDay) {
        throw new Error(`programs.create: no program_days row returned for day ${dayIndex + 1}`);
      }
      return day.exercises.map((exercise, index) => ({
        programDayId: programDay.id,
        exerciseId: exercise.exerciseId,
        orderIndex: index + 1,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
      }));
    });

    // A program of three named but empty days is valid (`coach-onboarding/
    // 03`); Drizzle rejects an insert with no values, so this is a guard on
    // the query, not on the product rule.
    if (exerciseRows.length > 0) {
      await tx.insert(schema.programExercises).values(exerciseRows);
    }

    return { id: program.id };
  });
}
