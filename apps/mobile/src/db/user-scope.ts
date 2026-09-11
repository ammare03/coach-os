import { sql } from 'drizzle-orm';

import { useRestTimerStore } from '../features/workouts/store/rest-timer-store.ts';
import { clearPersistedQueryCache } from '../lib/query/persister.ts';
import { resetClientTimeZone } from '../lib/time-zone/store.ts';

import type { LocalDb } from './client.ts';
import { getLocalDb } from './client.ts';
import { wipeLocalDatabase } from './wipe.ts';

// DB§13's `meta.user_id`: the local mirror + outbox belong to exactly one
// user at a time. Closes the involuntary-sign-out gap `bootstrap.ts`'s own
// comment names — a dead refresh token leaves a previous user's unsynced
// rows on disk, and nothing stops a *different* user from signing in on the
// same device afterwards. `wipeLocalDatabase`'s own force-guard exists for a
// user confirming discard of their own pending work; this is a different
// decision, made for a different reason (see below), so it is its own
// module rather than a new branch inside `wipe.ts`.

const USER_ID_META_KEY = 'user_id';

export type EnsureLocalDatabaseBelongsToResult =
  { outcome: 'same-user' } | { outcome: 'claimed' } | { outcome: 'wiped' };

/**
 * Called at the very end of both sign-in completion paths (`bootstrap.ts`,
 * `session-result.ts`'s `commitOpenedSession`) and awaited **before** the
 * caller flips the auth store to `authenticated` — never after, or there is
 * a window where the app is authenticated as the new user while their
 * screens can still read the previous one's rows.
 *
 * - No stored owner (first run, or a database already wiped clean) — claims
 *   the database for `userId`. One extra `INSERT`, still on the cold-start
 *   path but only ever once per install.
 * - Stored owner matches `userId` — the same person signing back in. One
 *   indexed `SELECT` against a one-row table, then nothing — this is the
 *   common case on every cold start and costs the §19 budget exactly that.
 * - Stored owner differs — `userId` is a *different* person from whoever
 *   this database belongs to. That other person's unsynced outbox rows are
 *   unrecoverable regardless of what happens here: nobody can authenticate
 *   as them anymore to flush the outbox. Wiping now therefore destroys
 *   nothing that was still savable and closes the leak completely, so this
 *   wipes with `force: true` — there is no user present to confirm
 *   discarding pending rows, the same reasoning `bootstrap.ts`'s involuntary
 *   sign-out listener already accepts — clears the persisted query cache
 *   (`lib/query/persister.ts`) alongside it, since that cache holds the same
 *   previous user's *read* results in a separate file and `offline-sync`
 *   skill §8's "no user's data may survive an account switch" applies to it
 *   too, and then claims the fresh database for `userId`.
 *
 * Throws if the wipe itself fails, rather than letting `userId` through
 * onto a database that may still hold someone else's rows. This fails
 * closed: a blocked sign-in over a rare local-disk error is recoverable
 * (retry, reinstall); a coach or client silently reading another user's
 * cached workouts, comments, or media is not. Every caller already wraps
 * its `setAuthenticated` sequence in error handling that maps an unexpected
 * throw to a generic "something went wrong, try again" — this needs no new
 * UI, it reuses that path.
 */
export async function ensureLocalDatabaseBelongsTo(
  userId: string,
): Promise<EnsureLocalDatabaseBelongsToResult> {
  const db = await getLocalDb();
  const stored = db.get<{ value: string | null }>(
    sql`SELECT value FROM meta WHERE key = ${USER_ID_META_KEY}`,
  );

  if (stored === undefined) {
    claimDatabaseFor(db, userId);
    return { outcome: 'claimed' };
  }

  if (stored.value === userId) {
    return { outcome: 'same-user' };
  }

  const wiped = await wipeLocalDatabase({ force: true });
  if (wiped.outcome !== 'wiped') {
    throw new Error(`could not wipe the local database for a different user: ${wiped.outcome}`);
  }
  await clearPersistedQueryCache();
  // Same reason, for the in-memory copy the wipe cannot reach
  // (`lib/time-zone/store.ts`).
  resetClientTimeZone();
  // And for the other one (`rest-timer/05`). `useRestTimerStore` is module
  // state: the persisted rest anchor goes with the database file, the
  // in-memory rest does not, so a rest the previous user was taking is
  // still running here. Invisible until something renders a countdown, and
  // from that point it is the next user on a shared device being shown
  // someone else's rest — and, once tasks 03 and 04 land, alerted for it.
  // `stopRest()` is the store's own cancellation rather than a second path:
  // it disarms the interval and lands in full idle, which is exactly what
  // those two read as "cancelled, do not alert".
  useRestTimerStore.getState().stopRest();

  // `wipeLocalDatabase` deleted the file; `getLocalDb()` re-bootstraps a
  // fresh, empty one on the next open (`client.ts`'s own contract).
  const freshDb = await getLocalDb();
  claimDatabaseFor(freshDb, userId);
  return { outcome: 'wiped' };
}

function claimDatabaseFor(db: LocalDb, userId: string): void {
  db.run(
    sql`INSERT INTO meta (key, value) VALUES (${USER_ID_META_KEY}, ${userId})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
}
