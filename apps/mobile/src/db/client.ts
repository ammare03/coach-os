import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import * as schema from './schema/index.ts';

// This is the device-side mirror, not `packages/db`. See `./README.md` for
// why the two are deliberately separate despite sharing an ORM.

// Decision: this connection stays a separate `expo-sqlite` file from
// `lib/query/persister.ts`'s `coachos-query-cache.db`, despite `CLAUDE.md`
// §3.1 describing this task as consolidating "the two connections". Two
// independent invalidation schemes depend on the split: task 04's
// schema-version mismatch drops and re-fetches this file without touching
// the query cache, and `clearPersistedQueryCache()` wipes the read cache on
// logout without waiting on this file's outbox-empty gate (task 03).
// Merging them would couple `meta.schema_version` here to
// `QUERY_CACHE_BUSTER` there for no benefit. "Consolidation" is satisfied at
// the pattern level instead — this file reuses persister.ts's
// memoise-a-promise / don't-memoise-a-failure idiom below, so there is one
// way this app opens `expo-sqlite`, just not one file. `persister.ts` is
// intentionally untouched by this task.

/** The single named file for the device mirror, in the app's document directory. */
export const DATABASE_NAME = 'coachos.db';

export type LocalDb = ReturnType<typeof drizzle<typeof schema>>;

// Table creation: `CREATE TABLE IF NOT EXISTS` run once at connection open,
// not drizzle-kit migrations. DB§13's own rule — "on mismatch, drop and
// re-fetch rather than migrate; migrating an offline cache is not worth the
// complexity" — means this database never needs the thing migrations exist
// for: preserving data across incremental schema changes. Task 04 handles a
// version bump by dropping the file and re-running this bootstrap from
// scratch, which is strictly simpler than generating, reviewing, and
// applying an ALTER TABLE sequence for a store that's disposable by design.
// `apps/mobile` has no `db:generate` script and `packages/db`'s
// `drizzle.config.ts` is Postgres-only (`dialect: 'postgresql'`) — this task
// does not add SQLite drizzle-kit tooling or a script for it. Each schema
// module exports its own `CREATE TABLE` statements next to the Drizzle
// table it describes (`*_SCHEMA_SQL`), so a future column change to, say,
// `local-training.ts` is one file to edit, not two files kept in sync by
// convention alone.
const BOOTSTRAP_STATEMENTS: readonly string[] = [
  ...schema.LOCAL_TRAINING_SCHEMA_SQL,
  ...schema.LOCAL_NUTRITION_SCHEMA_SQL,
  ...schema.LOCAL_FEEDBACK_SCHEMA_SQL,
  ...schema.SYNC_SCHEMA_SQL,
];

let databasePromise: Promise<SQLiteDatabase> | null = null;
let localDb: LocalDb | null = null;
let schemaReady = false;

function openDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    const opening = SQLite.openDatabaseAsync(DATABASE_NAME);
    // Don't memoise a failure — the next caller gets a fresh attempt rather
    // than a permanently poisoned handle (mirrors persister.ts).
    opening.catch(() => {
      databasePromise = null;
    });
    databasePromise = opening;
  }
  return databasePromise;
}

/**
 * Resolves to the memoised Drizzle instance over the single `coachos.db`
 * connection. The connection and the Drizzle wrapper around it are each
 * created at most once per process; every later offline-core task and every
 * feature reading or writing offline data calls this rather than opening
 * its own handle.
 */
export async function getLocalDb(): Promise<LocalDb> {
  const sqliteDatabase = await openDatabase();
  if (!localDb) {
    localDb = drizzle(sqliteDatabase, { schema });
  }
  if (!schemaReady) {
    for (const statement of BOOTSTRAP_STATEMENTS) {
      localDb.run(sql.raw(statement));
    }
    schemaReady = true;
  }
  return localDb;
}

/**
 * Closes the memoised connection (if one was ever opened) and resets every
 * piece of module state, so the next `getLocalDb()` call reopens `coachos.db`
 * from scratch instead of handing back a Drizzle instance wrapped around a
 * handle that is about to be, or just was, deleted.
 *
 * The production counterpart to `resetLocalDbForTests()` below —
 * `db/wipe.ts` calls this before deleting the file (`local-database/03-wipe-
 * on-logout.md`). Deleting a file this process still has open would either
 * fail outright or silently leave every later `getLocalDb()` caller pointed
 * at a file descriptor for a file that no longer exists.
 */
export async function closeLocalDb(): Promise<void> {
  const opening = databasePromise;
  databasePromise = null;
  localDb = null;
  schemaReady = false;
  if (!opening) return;
  try {
    const database = await opening;
    await database.closeAsync();
  } catch {
    // Already unopenable, or already closed — nothing left to close.
  }
}

/** Test seam — mirrors `resetQueryCacheForTests` in `lib/query/persister.ts`. */
export function resetLocalDbForTests(): void {
  databasePromise = null;
  localDb = null;
  schemaReady = false;
}
