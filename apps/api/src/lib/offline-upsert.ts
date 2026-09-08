// DB§14.1's server behaviour, once, for every offline-capable procedure:
// `INSERT ... ON CONFLICT (owner, client_local_id) DO UPDATE` returning the
// row, so replaying the same mutation ten times yields one row and ten
// identical responses. Every table listed in DB§14.3 carries a
// `UNIQUE (owner, client_local_id)` index; this is the one place that
// index is targeted, so phase-09 and phase-13 never write the upsert twice
// and never write it slightly differently.
import type { DbClient, Transaction } from '@coachos/db';
import { and, eq, getTableColumns, isNotNull, type SQL } from 'drizzle-orm';
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';

/** A pool handle or a transaction handle — every caller has one or the other. */
export type OfflineUpsertDb = DbClient | Transaction;

export type OfflineUpsertArgs<TTable extends PgTable> = {
  table: TTable;
  values: PgInsertValue<TTable>;
  /**
   * The columns of the table's `client_local_id` unique index, in index
   * order — `[table.clientId, table.clientLocalId]` for `set_logs` and
   * `meals`, `[messages.senderUserId, messages.clientLocalId]` for
   * `messages`.
   */
  target: readonly PgColumn[];
  /**
   * Overrides the inferred index predicate. Only needed for an index whose
   * `WHERE` clause is something other than "every nullable target column is
   * not null" — see `inferTargetWhere`.
   */
  targetWhere?: SQL;
  /**
   * `'update'` is DB§14.1's stated behaviour and the default choice: the
   * arriving payload overwrites, which is what device-wins tables want.
   * `'ignore'` keeps the stored row, and is the only mode with literally no
   * side effect on replay — `DO UPDATE` still fires migration 0021's
   * `touch_updated_at` trigger.
   */
  onConflict: 'update' | 'ignore';
  /** Overrides the columns `'update'` writes; defaults to the payload itself. */
  set?: PgUpdateSetSource<TTable>;
};

// A replay must not move the row's identity or its creation time — an
// `id` rewrite would orphan every child row pointing at it.
const IMMUTABLE_ON_REPLAY = new Set(['id', 'created_at']);

/**
 * Postgres requires a partial unique index's own predicate inside the
 * `ON CONFLICT` inference clause; without it the statement matches no index
 * and is rejected with 42P10. `sessions_client_local` is partial
 * (`WHERE client_local_id IS NOT NULL`) precisely because that column is
 * nullable, while `set_logs_client_local` is plain because its is not — so
 * the nullability of the target columns is what tells the two apart, and
 * the caller cannot forget the predicate.
 */
function inferTargetWhere(target: readonly PgColumn[]): SQL | undefined {
  const nullable = target.filter((column) => !column.notNull);
  return nullable.length > 0 ? and(...nullable.map(isNotNull)) : undefined;
}

function columnKeysByName(table: PgTable): Map<string, string> {
  const byName = new Map<string, string>();
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    byName.set(column.name, key);
  }
  return byName;
}

/** The payload itself, minus what a replay must not rewrite. */
function inferSet<TTable extends PgTable>(
  table: TTable,
  values: PgInsertValue<TTable>,
  target: readonly PgColumn[],
): PgUpdateSetSource<TTable> {
  const supplied: Record<string, unknown> = { ...values };
  const targetNames = new Set(target.map((column) => column.name));
  const set: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (!Object.hasOwn(supplied, key)) continue;
    if (targetNames.has(column.name) || IMMUTABLE_ON_REPLAY.has(column.name)) continue;
    set[key] = supplied[key];
  }

  // Built column by column from the table's own definition, so every key is
  // a real column of `table`; the shape is only unprovable to the compiler
  // because the table is generic.
  return set as PgUpdateSetSource<TTable>;
}

/** `WHERE owner = ... AND client_local_id = ...` — how the stored row is found again. */
function conflictPredicate<TTable extends PgTable>(
  table: TTable,
  values: PgInsertValue<TTable>,
  target: readonly PgColumn[],
): SQL {
  const supplied: Record<string, unknown> = { ...values };
  const keys = columnKeysByName(table);
  const conditions: SQL[] = [];

  for (const column of target) {
    const key = keys.get(column.name);
    if (key === undefined) {
      throw new Error(`offlineUpsert: column "${column.name}" is not part of the target table`);
    }
    const value = supplied[key];
    if (value === undefined || value === null) {
      throw new Error(`offlineUpsert: conflict target "${column.name}" has no value to match on`);
    }
    conditions.push(eq(column, value));
  }

  const predicate = and(...conditions);
  if (predicate === undefined) {
    throw new Error('offlineUpsert: at least one conflict target column is required');
  }
  return predicate;
}

/**
 * `SELECT * FROM table WHERE <predicate>`. `table` is widened to `PgTable`
 * for the call because Drizzle's `.from()` guards against selecting from a
 * `returning`-less subquery with a conditional type that cannot resolve
 * against an unresolved generic — the widening resolves it, and the row is
 * still that table's row.
 */
async function selectStoredRow<TTable extends PgTable>(
  db: OfflineUpsertDb,
  table: TTable,
  predicate: SQL,
): Promise<TTable['$inferSelect'] | undefined> {
  const rows: unknown[] = await db
    .select()
    .from(table as PgTable)
    .where(predicate)
    .limit(1);
  const [row] = rows;
  return row === undefined ? undefined : (row as TTable['$inferSelect']);
}

/**
 * Upserts `values` against `table`'s `client_local_id` unique index and
 * returns the resulting row — the same row on the first call and on the
 * tenth, never a 23505 (`../db/error-boundary.ts`'s `isReplayViolation`
 * catch path is the documented fallback for a resolver that hasn't adopted
 * this, not something this path can reach).
 */
export async function offlineUpsert<TTable extends PgTable>(
  db: OfflineUpsertDb,
  args: OfflineUpsertArgs<TTable>,
): Promise<TTable['$inferSelect']> {
  const { table, values, target, onConflict } = args;
  const targetWhere = args.targetWhere ?? inferTargetWhere(target);
  const set = args.set ?? inferSet(table, values, target);

  // An empty `set` is not valid SQL (`DO UPDATE SET` with nothing to set),
  // and is anyway what `DO NOTHING` means.
  const update = onConflict === 'update' && Object.keys(set).length > 0;

  // `exactOptionalPropertyTypes` — a plain-index table has no predicate,
  // and the key must then be absent rather than explicitly undefined.
  const predicate = targetWhere ? { targetWhere } : {};

  const inserted = update
    ? await db
        .insert(table)
        .values(values)
        .onConflictDoUpdate({ target: [...target], ...predicate, set })
        .returning()
    : await db
        .insert(table)
        .values(values)
        .onConflictDoNothing({
          target: [...target],
          ...(targetWhere ? { where: targetWhere } : {}),
        })
        .returning();

  const [row] = inserted;
  if (row !== undefined) {
    return row;
  }

  // `DO NOTHING` returns nothing when it suppressed the insert, so the
  // stored row still has to be read back. Under READ COMMITTED the insert
  // has already waited out any concurrent writer, so this sees the row that
  // won.
  const existing = await selectStoredRow(db, table, conflictPredicate(table, values, target));

  if (existing === undefined) {
    // Reachable only if the insert was suppressed by some *other* unique
    // index — a real conflict, not a replay. Loud, never a silent null.
    throw new Error('offlineUpsert: the insert was suppressed but no matching row exists');
  }
  return existing;
}
