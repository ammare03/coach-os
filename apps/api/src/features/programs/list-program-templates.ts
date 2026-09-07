import { schema, type DbClient, type Program } from '@coachos/db';
import type { programs as programsSchemas } from '@coachos/schemas';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';

// `programs.listTemplates` (`program-templates/01`) — the Programs tab's
// default view.
//
// **Live-reference, not snapshot** (`program-templates/04`'s resolution): a
// template listed here is the same row an assignment will point at, and a
// later edit to it reaches every client already assigned. Nothing in this
// query changes because of that — it only means the list a coach sees here
// is the actual, currently-live set of programs assignable to a client, not
// a point-in-time copy.
//
// Two filters, both mandatory and neither a parameter: `is_template = true`
// and `archived_at IS NULL` are what this procedure IS
// (`packages/schemas/src/programs.ts`'s `listTemplatesInput` doc comment).

export type ProgramTemplateSummary = Pick<
  Program,
  'id' | 'name' | 'durationWeeks' | 'updatedAt'
> & {
  /** Distinct non-rest `day_number`s across the program — see the note below. */
  daysPerWeek: number;
  exerciseCount: number;
};

export interface ListProgramTemplatesResult {
  items: ProgramTemplateSummary[];
  nextCursor: string | null;
}

export async function listProgramTemplates(
  db: DbClient,
  coachProfileId: string,
  input: programsSchemas.ListTemplatesInput,
): Promise<ListProgramTemplatesResult> {
  const filters = [
    eq(schema.programs.coachId, coachProfileId),
    eq(schema.programs.isTemplate, true),
    isNull(schema.programs.archivedAt),
  ];
  if (input.cursor !== undefined) {
    filters.push(lt(schema.programs.updatedAt, new Date(input.cursor)));
  }

  // Keyset page, most-recently-edited first — the coach's own list rule
  // (`program-templates/01`'s Approach step 3): `limit + 1` tells the last
  // row from a genuine next page apart from the last row there is.
  const page = await db
    .select({
      id: schema.programs.id,
      name: schema.programs.name,
      durationWeeks: schema.programs.durationWeeks,
      updatedAt: schema.programs.updatedAt,
    })
    .from(schema.programs)
    .where(and(...filters))
    .orderBy(desc(schema.programs.updatedAt))
    .limit(input.limit + 1);

  const hasMore = page.length > input.limit;
  const pageItems = hasMore ? page.slice(0, input.limit) : page;
  const nextCursor = hasMore
    ? (pageItems[pageItems.length - 1]?.updatedAt.toISOString() ?? null)
    : null;

  if (pageItems.length === 0) return { items: [], nextCursor: null };

  const ids = pageItems.map((p) => p.id);

  // One grouped statement across every template on the page
  // (`code-conventions` §7 — no query inside a loop), mirroring `getProgram`'s
  // own day query. A program's days repeat the same weekday slots week to
  // week in ordinary use, so the DISTINCT non-rest `day_number` count across
  // every week it has is that program's "days per week" — not a guess at
  // week 1 alone, and not thrown off by a week that happens to differ.
  const dayRows = await db
    .select({
      programId: schema.programWeeks.programId,
      dayNumber: schema.programDays.dayNumber,
      isRestDay: schema.programDays.isRestDay,
      exerciseCount: count(schema.programExercises.id),
    })
    .from(schema.programDays)
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .leftJoin(
      schema.programExercises,
      eq(schema.programExercises.programDayId, schema.programDays.id),
    )
    .where(inArray(schema.programWeeks.programId, ids))
    .groupBy(schema.programDays.id, schema.programWeeks.programId);

  const daysPerProgram = new Map<string, Set<number>>();
  const exerciseCountPerProgram = new Map<string, number>();
  for (const row of dayRows) {
    if (!row.isRestDay) {
      const days = daysPerProgram.get(row.programId) ?? new Set<number>();
      days.add(row.dayNumber);
      daysPerProgram.set(row.programId, days);
    }
    exerciseCountPerProgram.set(
      row.programId,
      (exerciseCountPerProgram.get(row.programId) ?? 0) + row.exerciseCount,
    );
  }

  const items: ProgramTemplateSummary[] = pageItems.map((program) => ({
    ...program,
    daysPerWeek: daysPerProgram.get(program.id)?.size ?? 0,
    exerciseCount: exerciseCountPerProgram.get(program.id) ?? 0,
  }));

  return { items, nextCursor };
}
