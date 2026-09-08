import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

// schema/index.ts is an intentionally empty barrel until
// phase-08-offline-core/local-database/02 adds tables to it.
// eslint-disable-next-line import/namespace -- remove in task 02, once the barrel exports tables
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

let databasePromise: Promise<SQLiteDatabase> | null = null;
let localDb: LocalDb | null = null;

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
  return localDb;
}

/** Test seam — mirrors `resetQueryCacheForTests` in `lib/query/persister.ts`. */
export function resetLocalDbForTests(): void {
  databasePromise = null;
  localDb = null;
}
