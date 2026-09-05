import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';
import type { Query } from '@tanstack/react-query';
import { defaultShouldDehydrateQuery } from '@tanstack/react-query';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import { keys } from './keys.ts';

// The read-cache's durable half: the dashboard a coach saw yesterday is on
// screen before the first request leaves the device (`CLAUDE.md` §19 —
// cached dashboard < 200ms), and a client in a gym basement still sees
// today's session. This is NOT the offline outbox: the outbox
// (`phase-08-offline-core/outbox/`) makes *writes* durable, this makes
// *reads* durable, and neither substitutes for the other (`offline-sync`
// skill §6).
//
// ⚠️ P08 dependency, recorded rather than assumed. `phase-08-offline-core/
// local-database` owns the app's real SQLite connection and its Drizzle
// schema. It does not exist yet, so this file opens its own connection to
// its own file, deliberately kept to one key/value table with no Drizzle
// dependency: P08 consolidates it by replacing `openCacheDatabase()` with
// its own handle and changing nothing else here.

/**
 * A dedicated file, not the app's future main database. Keeping the query
 * cache separate lets P08's "drop and re-fetch on schema mismatch"
 * (`offline-sync` §8) throw this away without touching the outbox, and lets
 * `clearPersistedQueryCache()` wipe it on logout without racing the mirror.
 */
const CACHE_DATABASE_NAME = 'coachos-query-cache.db';

/** One row. The cache is dehydrated whole, so there is never a second key. */
const CACHE_ROW_KEY = 'react-query';

/**
 * 24 hours (the `offline-sync` skill's persistence window, `CLAUDE.md`
 * §11.2 as was). Anything older is discarded on restore rather than shown:
 * a two-day-old adherence number presented as current is worse than a
 * spinner.
 */
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Bump to discard every persisted cache on the next launch. Required when a
 * query's *payload shape* changes — a restored payload the new code cannot
 * read is a crash on a screen the user did nothing to reach.
 */
export const QUERY_CACHE_BUSTER = 'v1';

/**
 * Writes are coalesced over this window. `persistQueryClientSubscribe`
 * fires on every cache mutation and the workout logger mutates the cache on
 * every set — dehydrating and writing the whole cache per keystroke is
 * JS-thread work the logger's < 100ms budget (§19) cannot afford.
 */
const PERSIST_THROTTLE_MS = 1_000;

const [MEDIA_ROOT] = keys.media.prefix();

/**
 * What is allowed onto the disk. Two filters, and the second is the one that
 * matters:
 *
 * 1. TanStack's own default — successful queries only, never an error or an
 *    in-flight fetch.
 * 2. **Never `media`.** A media query's payload is a signed R2 URL, and the
 *    `offline-sync` skill §8 forbids storing one beyond the render lifetime:
 *    it is a bearer credential for `CLAUDE.md` §21.1 Sensitive data —
 *    progress photos, form-check video — sitting in a plain file that
 *    outlives the session and the logout it should not have survived. The
 *    URL is cheap to re-mint and expensive to leak.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) return false;
  return query.queryKey[0] !== MEDIA_ROOT;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

/**
 * Memoised: one connection per process. Rejects — loudly, to its caller —
 * when the native module is absent (Jest, an unsupported platform) or the
 * file cannot be opened. `client.ts` treats that as "run without
 * persistence", which is a supported state, not a failure to hide.
 */
function openCacheDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    const opening = (async () => {
      const database = await SQLite.openDatabaseAsync(CACHE_DATABASE_NAME);
      await database.execAsync(
        'CREATE TABLE IF NOT EXISTS query_cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
      );
      return database;
    })();
    // Don't memoise a failure: the next caller (a logout wipe, say) gets a
    // fresh attempt rather than a permanently poisoned handle.
    opening.catch(() => {
      databasePromise = null;
    });
    databasePromise = opening;
  }
  return databasePromise;
}

/**
 * superjson, not `JSON` — the tRPC link uses it as its wire transformer
 * (`CLAUDE.md` §3.2), so the cache holds real `Date` objects. `JSON.parse`
 * would restore them as strings, and a `Date` that is a string only on the
 * second launch is exactly the kind of bug that survives review.
 */
function serialize(client: PersistedClient): string {
  return superjsonStringify(client);
}

function deserialize(value: string): PersistedClient {
  return superjsonParse<PersistedClient>(value);
}

/**
 * Trailing throttle. The last state wins and at most one write is scheduled;
 * `persistClient` is fire-and-forget by contract, so a rejected write has
 * nowhere to go — it is recorded (below) and the next cache event schedules
 * another attempt.
 */
function throttle(write: (client: PersistedClient) => Promise<void>) {
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (client: PersistedClient): void => {
    pending = client;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      if (next) void write(next).catch(recordCacheFailure);
    }, PERSIST_THROTTLE_MS);
  };
}

let lastCacheFailure: unknown = null;

/**
 * Not a swallow (`code-conventions` §8): a failed cache write must not
 * surface to the user — the data is on the server and the screen is
 * already correct — but it must not vanish either.
 * `providers-and-gates/05` reads this when it wires Sentry, and P08's
 * sync-status surface reads it to explain a stale cache.
 */
function recordCacheFailure(reason: unknown): void {
  lastCacheFailure = reason;
}

export function getQueryCacheFailure(): unknown {
  return lastCacheFailure;
}

/**
 * Opens the cache database and returns a persister bound to it. Rejects if
 * SQLite is unavailable — the caller decides what that means.
 */
export async function createSQLitePersister(): Promise<Persister> {
  const database = await openCacheDatabase();

  const persist = throttle(async (client) => {
    await database.runAsync('INSERT OR REPLACE INTO query_cache (key, value) VALUES (?, ?)', [
      CACHE_ROW_KEY,
      serialize(client),
    ]);
  });

  return {
    persistClient(client) {
      persist(client);
    },

    async restoreClient() {
      try {
        const row = await database.getFirstAsync<{ value: string }>(
          'SELECT value FROM query_cache WHERE key = ?',
          [CACHE_ROW_KEY],
        );
        return row ? deserialize(row.value) : undefined;
      } catch (reason) {
        // A row written by an incompatible build, or an unreadable file.
        // `undefined` makes persistQueryClient start clean instead of
        // throwing on the first frame — a disposable cache is allowed to be
        // thrown away, which is the whole reason it is disposable.
        recordCacheFailure(reason);
        return undefined;
      }
    },

    async removeClient() {
      try {
        await database.runAsync('DELETE FROM query_cache WHERE key = ?', [CACHE_ROW_KEY]);
      } catch (reason) {
        recordCacheFailure(reason);
      }
    },
  };
}

/**
 * Wipes the persisted read cache. Called on logout — `offline-sync` §8: no
 * user's data may survive an account switch on a shared device, and coaches
 * do hand phones to clients. `providers-and-gates/03` wires this into the
 * sign-out path; P08 extends the wipe to the mirror and the outbox.
 */
export async function clearPersistedQueryCache(): Promise<void> {
  const database = await openCacheDatabase();
  await database.runAsync('DELETE FROM query_cache');
}

/**
 * Test seam. The connection is memoised for the process lifetime, which is
 * right in the app and wrong between test cases.
 */
export function resetQueryCacheForTests(): void {
  databasePromise = null;
  lastCacheFailure = null;
}
