import { schema, type DbClient, type ProgramDay, type ProgramExercise } from '@coachos/db';
import { asc, inArray } from 'drizzle-orm';

// The copy primitive both duplication procedures are built from
// (`program-builder/06`). It takes a transaction handle rather than a
// `DbClient` and never opens one of its own — that is the whole reason it
// exists as a separate function: `duplicateProgramDay` runs it inside one
// transaction and `duplicateProgramWeek` runs it inside another, and
// neither may leave a half-copied day behind if the other half fails.
//
// **Set-based, not a loop.** A week duplication copies up to seven days,
// and `code-conventions` §7 bans a query inside a loop; this issues three
// statements for one day and the same three for seven.

/** The handle `db.transaction` hands its callback — a `DbClient` minus nesting. */
export type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface DayCopyTarget {
  sourceDayId: string;
  targetWeekId: string;
  /** 1 (Monday) through 7 (Sunday) — a slot in the target week. */
  targetDayNumber: number;
}

/**
 * What a caller needs to address the copy afterwards, paired with what it
 * came from. `copiedDayId` rather than `id`: an object type with an `id`
 * field is what `local/no-hand-written-row-type` flags as a database row,
 * and this is a result, not a row.
 */
export interface DayCopyResult {
  copiedDayId: string;
  sourceDayId: string;
}

/**
 * The columns a copied day carries. Everything on the row except its
 * identity (`id`), its parent (`programWeekId`), its slot (`dayNumber`)
 * and the audit stamps — those four are what a copy replaces, and
 * everything else is what "duplicate" means.
 */
type CarriedDayColumns = Omit<
  ProgramDay,
  'id' | 'programWeekId' | 'dayNumber' | 'createdAt' | 'updatedAt'
>;

/**
 * The same bargain for an exercise block. `alternatives` is included by
 * construction rather than by being listed: a column added to
 * `program_exercises` later is carried by a copy without anyone
 * remembering to add it here, which is the failure this shape prevents.
 */
type CarriedExerciseColumns = Omit<
  ProgramExercise,
  'id' | 'programDayId' | 'createdAt' | 'updatedAt'
>;

/**
 * Drops the named keys and keeps everything else. Written as an omission
 * rather than as a list of the columns to carry, deliberately: a column
 * added to `program_days` or `program_exercises` later is copied without
 * anyone remembering to add it here, and forgetting to copy one is exactly
 * the "looks complete, is not" failure this task exists to prevent.
 */
function omit<T extends Record<string, unknown>, K extends readonly (keyof T)[]>(
  value: T,
  keys: K,
): Omit<T, K[number]> {
  const result: Record<string, unknown> = { ...value };
  for (const key of keys) delete result[key as string];
  return result as Omit<T, K[number]>;
}

const DAY_IDENTITY_COLUMNS = [
  'id',
  'programWeekId',
  'dayNumber',
  'createdAt',
  'updatedAt',
] as const;
const EXERCISE_IDENTITY_COLUMNS = ['id', 'programDayId', 'createdAt', 'updatedAt'] as const;

function carriedDayColumns(day: ProgramDay): CarriedDayColumns {
  return omit(day, DAY_IDENTITY_COLUMNS);
}

export function carriedExerciseColumns(block: ProgramExercise): CarriedExerciseColumns {
  return omit(block, EXERCISE_IDENTITY_COLUMNS);
}

/**
 * Copies every named day — and every `program_exercises` row beneath it —
 * into its target slot, inside the caller's transaction.
 *
 * **Fresh ids throughout.** Nothing here writes an `id`; the column's
 * uuidv7 default supplies one per row (DB§21), so a copy can never collide
 * with its source. `order_index`, `superset_group`, every `target_*` value,
 * `tempo`, `rest`, the coach's notes and the whole `alternatives` array
 * cross unchanged — a copy that silently dropped the approved swaps would
 * look complete in the UI and be wrong in the client's swap sheet
 * (`phase-09-workout-logger/session-modifications/02`).
 *
 * The caller is responsible for having checked that every target slot is
 * free; this function performs the copy and nothing else.
 */
export async function copyDaysInto(
  tx: DbTransaction,
  targets: readonly DayCopyTarget[],
): Promise<DayCopyResult[]> {
  if (targets.length === 0) return [];

  const sourceDayIds = targets.map((target) => target.sourceDayId);
  const sourceDays = await tx
    .select()
    .from(schema.programDays)
    .where(inArray(schema.programDays.id, sourceDayIds));
  const sourceById = new Map(sourceDays.map((day) => [day.id, day]));

  const dayValues = targets.map((target) => {
    const source = sourceById.get(target.sourceDayId);
    if (!source) throw new Error(`program day ${target.sourceDayId} disappeared mid-copy`);
    return {
      ...carriedDayColumns(source),
      programWeekId: target.targetWeekId,
      dayNumber: target.targetDayNumber,
    };
  });

  // `(program_week_id, day_number)` is unique (DB§5.2), so the returned
  // rows are matched back by that pair rather than by position — a
  // multi-row `INSERT … RETURNING` returns in VALUES order in practice, and
  // "in practice" is not a thing to hang a copy's correctness on.
  const insertedDays = await tx.insert(schema.programDays).values(dayValues).returning({
    id: schema.programDays.id,
    programWeekId: schema.programDays.programWeekId,
    dayNumber: schema.programDays.dayNumber,
  });
  const slotKey = (weekId: string, dayNumber: number): string => `${weekId}:${String(dayNumber)}`;
  const insertedBySlot = new Map(
    insertedDays.map((day) => [slotKey(day.programWeekId, day.dayNumber), day.id]),
  );

  const results: DayCopyResult[] = targets.map((target) => {
    const copiedDayId = insertedBySlot.get(slotKey(target.targetWeekId, target.targetDayNumber));
    if (!copiedDayId) {
      throw new Error('insert into training.program_days did not return every copied row');
    }
    return { copiedDayId, sourceDayId: target.sourceDayId };
  });
  const copyIdBySourceId = new Map(
    results.map((result) => [result.sourceDayId, result.copiedDayId]),
  );

  // Ordered by `order_index` so the copies are written in the source's own
  // order. The value is carried explicitly either way — this is about the
  // rows being readable in order, not about the column being derived.
  const blocks = await tx
    .select()
    .from(schema.programExercises)
    .where(inArray(schema.programExercises.programDayId, sourceDayIds))
    .orderBy(asc(schema.programExercises.orderIndex));

  if (blocks.length > 0) {
    await tx.insert(schema.programExercises).values(
      blocks.map((block) => {
        const programDayId = copyIdBySourceId.get(block.programDayId);
        if (!programDayId) {
          throw new Error(`no copied day for program exercise on day ${block.programDayId}`);
        }
        return { ...carriedExerciseColumns(block), programDayId };
      }),
    );
  }

  return results;
}
