import { eq } from 'drizzle-orm';

import type { LocalDb } from '../../../db/client.ts';
import { meta } from '../../../db/schema/sync.ts';

// Where the logger's current exercise index lives between one page turn and
// the next launch of the app — `session-runtime/03`'s second acceptance
// criterion, and the row `session-runtime/06`'s kill-recovery reads to put a
// client back exactly where they were.
//
// **Why `meta` and not a column on `local_workout_sessions`.** DB§13's
// device cache has no migration path by design: a column added there means
// bumping `EXPECTED_SCHEMA_VERSION`, which drops and re-fetches the whole
// file (`db/schema-version.ts`). Paying that for one integer of transient
// runtime state is the wrong trade — and `meta` is DB§13's existing home for
// exactly this shape of scalar, already carrying `schema_version`,
// `user_id`, `last_sync_at`, and `lib/prefetch/sessions.ts`'s cached
// `UpcomingContext`. It inherits the two behaviours that matter: it lives
// inside `coachos.db`, so the logout wipe and the schema-version drop both
// take it with them.
//
// One row per session, keyed by `local_workout_sessions.client_local_id` —
// never the server id, which an offline-started session does not have
// (`useLoggerSession` rule (b)).
//
// **No debounce, no batch, no coalescing window.** `writeLoggerPosition` is
// called in the same tick as the change that caused it. Task 06's audit is
// specifically looking for the opposite, and the opposite is easy to
// introduce here by accident.

/** `meta.key` prefix. Namespaced so two concurrent sessions never share a position. */
export const LOGGER_POSITION_META_PREFIX = 'logger_position:';

export function loggerPositionKey(sessionLocalId: string): string {
  return `${LOGGER_POSITION_META_PREFIX}${sessionLocalId}`;
}

/**
 * Persists the current exercise index. Overwrites; there is one position
 * per session and no history of where the client has been.
 */
export async function writeLoggerPosition(
  db: LocalDb,
  sessionLocalId: string,
  index: number,
): Promise<void> {
  const value = String(Math.max(Math.trunc(index), 0));
  const key = loggerPositionKey(sessionLocalId);

  await db
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

/**
 * The persisted index, or `null` when this device has never paged this
 * session — which the caller must read as "start at the first exercise",
 * not as an error.
 *
 * A malformed or negative value degrades to `null` rather than throwing,
 * matching `db/schema-version.ts`'s treatment of a corrupted `meta` value:
 * a bad cache entry must not be able to take the logger down mid-workout.
 * The value is NOT clamped against the session's page count here — this
 * module does not know it. `clampPageIndex` is where that happens, because
 * a coach may have removed an exercise since the position was written.
 */
export async function readLoggerPosition(
  db: LocalDb,
  sessionLocalId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, loggerPositionKey(sessionLocalId)))
    .limit(1);

  if (row?.value === undefined || row.value === null) return null;

  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
