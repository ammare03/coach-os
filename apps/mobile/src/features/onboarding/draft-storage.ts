import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { StateStorage } from 'zustand/middleware';

// Backend choice, recorded because `01-step-persistence` asks for it:
// **expo-sqlite, not MMKV.** `expo-sqlite` is already a pinned dependency
// (`CLAUDE.md` §3.1) and `src/lib/query/persister.ts` already opens a
// database on exactly this pattern; `react-native-mmkv` is in neither the
// §3 stack table nor the tree, so adopting it would add a native module and
// a §3 entry for what an installed one already does — §3.4.1 step 2 ("is it
// in already-installed packages?") settles it.
//
// The *sync* API, unlike the query persister's async one: zustand's
// `persist` hydrates synchronously from a synchronous storage, so a resumed
// flow renders on the correct step in its first frame instead of flashing
// step one and jumping. A draft is one small row; this is not a workload
// that needs to leave the JS thread.
//
// ⚠️ Its own file, not the query cache's. That file is disposable by
// design — `phase-08-offline-core/local-database` may drop and re-fetch it
// on a schema mismatch (`offline-sync` §8) — and an in-progress draft is
// the user's own unsent work, not a cache. P08 may consolidate the
// *connection* later; it must not put a draft behind that drop rule.

const DRAFT_DATABASE_NAME = 'coachos-onboarding-drafts.db';

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS onboarding_drafts (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)';

let database: SQLiteDatabase | null = null;
let lastStorageFailure: unknown = null;

/**
 * Stand-in when SQLite is unavailable (Jest without a mock, an unsupported
 * platform). Onboarding still works for the session; it just does not
 * survive a kill. Losing a draft is bad, refusing to render the flow at all
 * is worse.
 */
const memory = new Map<string, string>();

/**
 * Not a swallow (`code-conventions` §8): the failure must not reach the
 * user mid-flow, but it must not vanish either. Read it when wiring the
 * sync-status surface, or when a draft mysteriously fails to resume.
 */
function recordStorageFailure(reason: unknown): void {
  lastStorageFailure = reason;
}

export function getDraftStorageFailure(): unknown {
  return lastStorageFailure;
}

/**
 * Memoised: one connection per process. A failure is deliberately not
 * memoised, so the next call gets a fresh attempt rather than a
 * permanently poisoned handle (`lib/query/persister.ts` does the same).
 */
function openDraftDatabase(): SQLiteDatabase | null {
  if (database) return database;
  try {
    const opened = SQLite.openDatabaseSync(DRAFT_DATABASE_NAME);
    opened.execSync(CREATE_TABLE_SQL);
    database = opened;
    return database;
  } catch (reason) {
    recordStorageFailure(reason);
    return null;
  }
}

export const draftStateStorage: StateStorage = {
  getItem(key) {
    const opened = openDraftDatabase();
    if (!opened) return memory.get(key) ?? null;
    try {
      const row = opened.getFirstSync<{ value: string }>(
        'SELECT value FROM onboarding_drafts WHERE key = ?',
        [key],
      );
      return row ? row.value : null;
    } catch (reason) {
      recordStorageFailure(reason);
      return null;
    }
  },

  setItem(key, value) {
    const opened = openDraftDatabase();
    if (!opened) {
      memory.set(key, value);
      return;
    }
    try {
      opened.runSync('INSERT OR REPLACE INTO onboarding_drafts (key, value) VALUES (?, ?)', [
        key,
        value,
      ]);
    } catch (reason) {
      recordStorageFailure(reason);
    }
  },

  removeItem(key) {
    memory.delete(key);
    const opened = openDraftDatabase();
    if (!opened) return;
    try {
      opened.runSync('DELETE FROM onboarding_drafts WHERE key = ?', [key]);
    } catch (reason) {
      recordStorageFailure(reason);
    }
  },
};

/** Test seam — the connection is memoised for the process lifetime, which is wrong between cases. */
export function resetDraftStorageForTests(): void {
  database = null;
  lastStorageFailure = null;
  memory.clear();
}
