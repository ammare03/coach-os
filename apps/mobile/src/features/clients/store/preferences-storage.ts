import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { StateStorage } from 'zustand/middleware';

// The synchronous key/value backing for `client-list-preferences.ts`.
//
// **expo-sqlite, not MMKV or AsyncStorage** — neither is in `CLAUDE.md` §3.1
// and `expo-sqlite` already is, which is §3.4.1 step 2. Synchronous, because
// `persist` hydrates synchronously from a synchronous storage: the coach's
// saved sort is applied in the first frame rather than after one where the
// list is ordered by the default and then jumps.
//
// Its own database, not the query cache's: `phase-08-offline-core` may drop
// that one wholesale on a schema mismatch (`offline-sync` §8), and a
// preference is not a cache entry. Not the onboarding drafts' either — that
// file is bound to a signed-in user and wiped when it changes, which is
// exactly wrong for a device-level display preference.
//
// ⚠️ This is the second copy of this ~50-line pattern in the app
// (`features/onboarding/draft-storage.ts` is the first). A third consumer
// should promote it to `src/lib/` per `code-conventions` §1 rather than
// write a fourth.

const DATABASE_NAME = 'coachos-client-list-preferences.db';

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS client_list_preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)';

let database: SQLiteDatabase | null = null;
let lastStorageFailure: unknown = null;

/**
 * Stand-in when SQLite is unavailable (Jest without a mock, an unsupported
 * platform). The controls still work for the session; the choice just does
 * not survive a kill. Losing a sort preference is a nuisance; refusing to
 * render the dashboard over one is an outage.
 */
const memory = new Map<string, string>();

/** Not a swallow (`code-conventions` §8) — recorded, and readable from a test or a debug surface. */
function recordStorageFailure(reason: unknown): void {
  lastStorageFailure = reason;
}

export function getPreferenceStorageFailure(): unknown {
  return lastStorageFailure;
}

/** Memoised; a failure deliberately is not, so the next call retries rather than staying poisoned. */
function openDatabase(): SQLiteDatabase | null {
  if (database) return database;
  try {
    const opened = SQLite.openDatabaseSync(DATABASE_NAME);
    opened.execSync(CREATE_TABLE_SQL);
    database = opened;
    return database;
  } catch (reason) {
    recordStorageFailure(reason);
    return null;
  }
}

export const clientListPreferenceStorage: StateStorage = {
  getItem(key) {
    const opened = openDatabase();
    if (!opened) return memory.get(key) ?? null;
    try {
      const row = opened.getFirstSync<{ value: string }>(
        'SELECT value FROM client_list_preferences WHERE key = ?',
        [key],
      );
      return row ? row.value : null;
    } catch (reason) {
      recordStorageFailure(reason);
      return null;
    }
  },

  setItem(key, value) {
    const opened = openDatabase();
    if (!opened) {
      memory.set(key, value);
      return;
    }
    try {
      opened.runSync('INSERT OR REPLACE INTO client_list_preferences (key, value) VALUES (?, ?)', [
        key,
        value,
      ]);
    } catch (reason) {
      recordStorageFailure(reason);
    }
  },

  removeItem(key) {
    memory.delete(key);
    const opened = openDatabase();
    if (!opened) return;
    try {
      opened.runSync('DELETE FROM client_list_preferences WHERE key = ?', [key]);
    } catch (reason) {
      recordStorageFailure(reason);
    }
  },
};

/** Test seam — the connection is memoised for the process lifetime, which is wrong between cases. */
export function resetPreferenceStorageForTests(): void {
  database = null;
  lastStorageFailure = null;
  memory.clear();
}
