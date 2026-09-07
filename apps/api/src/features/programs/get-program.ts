import {
  schema,
  type DbClient,
  type Program,
  type ProgramDay,
  type ProgramWeek,
} from '@coachos/db';
import { asc, count, eq } from 'drizzle-orm';

// `programs.get` — the whole program → weeks → days hierarchy the builder
// screen renders (`program-builder/01`).
//
// One procedure, not three. `UI-UX.md` §UX3 forbids a query waterfall, and
// a builder that fetched the program, then its weeks, then each week's days
// would be exactly that — three sequential round trips before a coach sees
// anything, on a screen §19 budgets at 800ms p75.
//
// Ownership is `ownsResource('program', …)` in the router, never a
// `coach_id` predicate here (`api-conventions` §3).

// Projections of the Drizzle row types, never a hand-written mirror of the
// columns (`code-conventions` §3): a column renamed in `packages/db` fails
// this file rather than drifting from it. `exerciseCount` and `days`/`weeks`
// are the only fields that are genuinely this procedure's own — one is a
// computed aggregate, the others are the nesting the builder renders.
export type ProgramDaySummary = Pick<
  ProgramDay,
  'id' | 'dayNumber' | 'name' | 'notes' | 'isRestDay'
> & {
  /** Drives the row's "5 exercises" meta line; task 02 fills the exercises themselves. */
  exerciseCount: number;
};

export type ProgramWeekSummary = Pick<ProgramWeek, 'id' | 'weekNumber' | 'notes'> & {
  days: ProgramDaySummary[];
};

export type ProgramDetail = Pick<
  Program,
  'id' | 'name' | 'description' | 'durationWeeks' | 'isTemplate' | 'version'
> & { weeks: ProgramWeekSummary[] };

export async function getProgram(db: DbClient, programId: string): Promise<ProgramDetail | null> {
  const [program] = await db
    .select({
      id: schema.programs.id,
      name: schema.programs.name,
      description: schema.programs.description,
      durationWeeks: schema.programs.durationWeeks,
      isTemplate: schema.programs.isTemplate,
      version: schema.programs.version,
    })
    .from(schema.programs)
    .where(eq(schema.programs.id, programId))
    .limit(1);
  if (!program) return null;

  const weekRows = await db
    .select({
      id: schema.programWeeks.id,
      weekNumber: schema.programWeeks.weekNumber,
      notes: schema.programWeeks.notes,
    })
    .from(schema.programWeeks)
    .where(eq(schema.programWeeks.programId, programId))
    .orderBy(asc(schema.programWeeks.weekNumber));

  // Every day of every week in one grouped statement — `code-conventions`
  // §7 bans a query inside a loop, and a twelve-week program would
  // otherwise cost twelve.
  const dayRows = await db
    .select({
      id: schema.programDays.id,
      programWeekId: schema.programDays.programWeekId,
      dayNumber: schema.programDays.dayNumber,
      name: schema.programDays.name,
      notes: schema.programDays.notes,
      isRestDay: schema.programDays.isRestDay,
      exerciseCount: count(schema.programExercises.id),
    })
    .from(schema.programDays)
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .leftJoin(
      schema.programExercises,
      eq(schema.programExercises.programDayId, schema.programDays.id),
    )
    .where(eq(schema.programWeeks.programId, programId))
    .groupBy(schema.programDays.id)
    .orderBy(asc(schema.programDays.dayNumber));

  const daysByWeek = new Map<string, ProgramDaySummary[]>();
  for (const row of dayRows) {
    const bucket = daysByWeek.get(row.programWeekId);
    const day: ProgramDaySummary = {
      id: row.id,
      dayNumber: row.dayNumber,
      name: row.name,
      notes: row.notes,
      isRestDay: row.isRestDay,
      exerciseCount: row.exerciseCount,
    };
    if (bucket) bucket.push(day);
    else daysByWeek.set(row.programWeekId, [day]);
  }

  return {
    ...program,
    weeks: weekRows.map((week) => ({ ...week, days: daysByWeek.get(week.id) ?? [] })),
  };
}
