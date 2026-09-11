import { and, desc, eq, ne } from 'drizzle-orm';

import type { LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { parseHistorySessionPayload } from '../../../lib/prefetch/history.ts';

// "last time: 60kg × 9" — the second half of `session-runtime/04`'s target
// line, and the one half that had no query anywhere in the repo.
//
// **Where the data actually is.** DB§22 gives the server query
// (`set_logs WHERE client_id = $1 AND exercise_id = $2 AND is_warmup =
// false AND deleted_at IS NULL ORDER BY logged_at DESC`, on the
// `set_logs_client_exercise` index) and that index exists — but no
// procedure uses it, and the logger must answer this with no signal
// (`offline-sync` §1: "reading the last 30 days of history" is a
// must-work-offline row). So this is DB§22's shape run against the device,
// over the two places a past set can be sitting:
//
//   (a) `local_workout_sessions.payload_json` for a PAST-dated row, which
//       `lib/prefetch/history.ts` writes as `{ session, setLogs }` across
//       the trailing `HISTORY_DAYS` window. This is where essentially every
//       answer comes from.
//   (b) `local_set_logs`, for a session this device logged and has not yet
//       seen come back through history — the offline case, where (a) cannot
//       know about work the server has never been told about.
//
// Deliberately NOT a network read with a local fallback. A read that is
// usually local and occasionally remote has two behaviours and the rarer one
// is the one that runs in the gym basement.
//
// **The scan is bounded by a substring test, not by SQL.** See
// `readHistoryCandidates` — a `LIKE '%id%'` in the query would do the same
// work, but it is also the one operator the sqlite fake this suite runs on
// does not implement, and doing it in JS costs nothing on a payload already
// read into memory.

/** One past set, already reduced to what the target line prints. */
export interface LastPerformance {
  /** Kilograms, always — the display unit is applied at the edge (`CLAUDE.md` hard rule). */
  weightKg: number | null;
  reps: number | null;
  loggedAt: Date;
}

/** A set from either source, normalised before the pick. */
export interface LastPerformanceCandidate {
  exerciseId: string;
  weightKg: number | null;
  reps: number | null;
  isWarmup: boolean;
  loggedAt: Date;
}

/**
 * How many session rows the scan will look at. The prefetch window is 30
 * days (`HISTORY_DAYS`), so this is a ceiling that should never bind — it
 * exists so a device whose cache was never pruned cannot turn a page turn
 * into an unbounded read.
 */
export const LAST_PERFORMANCE_SCAN_LIMIT = 40;

/**
 * The most recent working set of `exerciseId`, or `null`.
 *
 * Three filters, each of which changes what a client reads:
 *
 * - **Warm-ups are excluded** (DB§22). "Last time: 20kg × 10" for someone
 *   who then worked at 100kg is worse than showing nothing.
 * - **A set with neither a weight nor a rep count is excluded.** A timed
 *   carry or a distance row is a real `set_logs` row, and "last time: ×"
 *   is not a sentence.
 * - **Newest by `logged_at`, not by set number or session date.** Two
 *   sessions can share a day, and an offline session syncs late.
 */
export function pickLastPerformance(
  candidates: readonly LastPerformanceCandidate[],
  exerciseId: string,
): LastPerformance | null {
  let best: LastPerformanceCandidate | null = null;

  for (const candidate of candidates) {
    if (candidate.exerciseId !== exerciseId) continue;
    if (candidate.isWarmup) continue;
    if (candidate.weightKg === null && candidate.reps === null) continue;
    if (best === null || candidate.loggedAt.getTime() > best.loggedAt.getTime()) {
      best = candidate;
    }
  }

  if (best === null) return null;
  return { weightKg: best.weightKg, reps: best.reps, loggedAt: best.loggedAt };
}

export interface ReadLastPerformanceOptions {
  exerciseId: string;
  /**
   * The session being logged right now. Its own sets are "this time", not
   * "last time" — a client who has just logged set 1 at 62.5kg must still
   * see what they did the *previous* session, which is the number the
   * reference for this screen (Hevy) shows and the one that decides the
   * load.
   */
  excludeSessionLocalId: string;
}

/**
 * DB§22's query, against the device. Throws only if SQLite itself fails —
 * a single unreadable payload is skipped, never propagated, because one
 * corrupt cache row must not cost a client their target line mid-set.
 */
export async function readLastPerformance(
  db: LocalDb,
  options: ReadLastPerformanceOptions,
): Promise<LastPerformance | null> {
  const candidates = [
    ...(await readUnsyncedCandidates(db, options)),
    ...(await readHistoryCandidates(db, options)),
  ];
  return pickLastPerformance(candidates, options.exerciseId);
}

/** Source (b): sets this device logged in some OTHER local session. */
async function readUnsyncedCandidates(
  db: LocalDb,
  options: ReadLastPerformanceOptions,
): Promise<LastPerformanceCandidate[]> {
  const rows = await db
    .select({
      exerciseId: localSetLogs.exerciseId,
      weightKg: localSetLogs.weightKg,
      reps: localSetLogs.reps,
      isWarmup: localSetLogs.isWarmup,
      loggedAt: localSetLogs.loggedAt,
    })
    .from(localSetLogs)
    .where(
      and(
        eq(localSetLogs.exerciseId, options.exerciseId),
        ne(localSetLogs.sessionLocalId, options.excludeSessionLocalId),
      ),
    );

  return rows.map((row) => ({
    exerciseId: row.exerciseId,
    weightKg: row.weightKg,
    reps: row.reps,
    isWarmup: row.isWarmup,
    // The column is epoch milliseconds; every other source hands out `Date`.
    loggedAt: new Date(row.loggedAt),
  }));
}

/**
 * Source (a): the prefetched history payloads.
 *
 * **Correctness here does not depend on row order.** Every matching set is
 * collected and `pickLastPerformance` resolves them by `logged_at`, which is
 * the only ordering DB§22 recognises. An earlier draft stopped at the first
 * `scheduled_date` that yielded a set, which was faster and wrong the moment
 * the rows arrived in any other order — the `ORDER BY` below is a scoping
 * hint for *which* rows get looked at, never the thing that picks the
 * answer. Two sessions on one day, and a session logged offline days after
 * the date it belongs to, are both ordinary.
 *
 * The cheap filter that keeps this bounded is the substring test: a payload
 * that does not contain the exercise's id cannot contain a set of it, and
 * `String.includes` on a few KB of text is far cheaper than parsing it. That
 * is the `LIKE '%id%'` prefilter, done where it costs nothing and where
 * `lib/outbox/__fixtures__/sqlite-fake.ts` (no `LIKE`) can still run it. A
 * false positive — the id appearing as some other column's value — costs one
 * parse and is then dropped by the per-set check below.
 */
async function readHistoryCandidates(
  db: LocalDb,
  options: ReadLastPerformanceOptions,
): Promise<LastPerformanceCandidate[]> {
  const rows = await db
    .select({
      scheduledDate: localWorkoutSessions.scheduledDate,
      payloadJson: localWorkoutSessions.payloadJson,
    })
    .from(localWorkoutSessions)
    .where(ne(localWorkoutSessions.clientLocalId, options.excludeSessionLocalId))
    .orderBy(desc(localWorkoutSessions.scheduledDate))
    .limit(LAST_PERFORMANCE_SCAN_LIMIT);

  const found: LastPerformanceCandidate[] = [];

  for (const row of rows) {
    if (!row.payloadJson.includes(options.exerciseId)) continue;

    for (const set of setLogsIn(row.payloadJson)) {
      if (set.exerciseId !== options.exerciseId) continue;
      found.push(set);
    }
  }

  return found;
}

/**
 * The set logs in one payload, or none.
 *
 * A row written by `lib/prefetch/sessions.ts` holds `{ session, exercises }`
 * and has no `setLogs` at all — that is history.ts's rule (b), and the
 * presence of the key is exactly how the two are told apart. A malformed
 * payload degrades the same way, which matches `logger-position.ts`'s
 * treatment of a corrupted `meta` value.
 */
function setLogsIn(payloadJson: string): LastPerformanceCandidate[] {
  let parsed: unknown;
  try {
    parsed = parseHistorySessionPayload(payloadJson);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const setLogs = (parsed as { setLogs?: unknown }).setLogs;
  if (!Array.isArray(setLogs)) return [];

  return setLogs.filter(isCandidateSet);
}

function isCandidateSet(value: unknown): value is LastPerformanceCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const set = value as Record<string, unknown>;
  return (
    typeof set.exerciseId === 'string' &&
    typeof set.isWarmup === 'boolean' &&
    set.loggedAt instanceof Date &&
    (set.weightKg === null || typeof set.weightKg === 'number') &&
    (set.reps === null || typeof set.reps === 'number')
  );
}
