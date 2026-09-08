import { sql } from 'drizzle-orm';
import * as SQLite from 'expo-sqlite';

import { DATABASE_NAME, closeLocalDb, getLocalDb } from './client.ts';

// DB§13's "wipe on logout" rule (`offline-sync` skill §8): the entire SQLite
// file is deleted so no user's data survives an account switch on a shared
// device — but never by silently discarding a client's unsynced workout.
//
// Raw `sql` (via `db.get`, the same primitive `client.ts`'s bootstrap and
// its own tests already use) rather than the `.select()` query builder: the
// expo-sqlite Drizzle driver runs in `'sync'` mode, and a partial-column
// builder query goes through a different, array-mode execution path
// (`executeForRawResultSync`) than `db.get`/`db.run` do. One raw statement
// against a table this file doesn't otherwise need typed access to is
// simpler than faking that second path.

export type WipeResult =
  | { outcome: 'wiped' }
  | { outcome: 'blocked'; pendingCount: number }
  | { outcome: 'failed'; error: unknown };

export interface WipeOptions {
  /** Discard pending outbox rows and wipe anyway. An explicit user choice, never a default. */
  force?: boolean;
}

/**
 * Checks the outbox for rows that haven't reached the server (`status !=
 * 'done'`) and, if the outbox is empty or `force` is set, deletes the whole
 * `coachos.db` file — `deleteDatabaseAsync`, not a `DELETE FROM` per table,
 * so a fresh, empty database is created by `client.ts`'s bootstrap on the
 * next `getLocalDb()` call.
 *
 * Returns a discriminated union rather than a boolean: the caller (the
 * sign-out flow) needs to tell "wiped", "blocked, N pending", and "failed"
 * apart, not just succeed-or-not.
 */
export async function wipeLocalDatabase({ force = false }: WipeOptions = {}): Promise<WipeResult> {
  try {
    const db = await getLocalDb();
    const row = db.get<{ pending: number }>(
      sql`SELECT COUNT(*) AS pending FROM outbox WHERE status != 'done'`,
    );
    const pendingCount = row?.pending ?? 0;

    if (pendingCount > 0 && !force) {
      return { outcome: 'blocked', pendingCount };
    }

    // Close the memoised connection before deleting the file underneath it —
    // see `closeLocalDb`'s own comment on why this can't be skipped.
    await closeLocalDb();
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    return { outcome: 'wiped' };
  } catch (error) {
    return { outcome: 'failed', error };
  }
}
