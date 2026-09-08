import { and, eq, gte } from 'drizzle-orm';

import { getLocalDb } from '../../db/client.ts';
import { outbox } from '../../db/schema/sync.ts';
import { labelForOutboxProcedure } from '../../db/schema-version.ts';

import { flushOutbox, MAX_ATTEMPTS, type FlushOutboxOptions } from './flush.ts';

// The read and the manual retry behind DB§14.4's "surfaced in the UI as
// 'couldn't sync — retry', never silently dropped". Lives in `lib/outbox`
// rather than in `features/sync` for one hard reason: the retry WRITES to
// the outbox table, and the `outbox/no-direct-outbox-write` lint rule
// exempts exactly this folder.
//
// "Permanently failed" is narrower than `status='failed'`. A row on
// attempt 3 is also `'failed'` — it is backing off and will very likely
// win. Only a row that has exhausted `MAX_ATTEMPTS` is stuck, and only
// those are shown to the client; announcing the others would be raising an
// alarm about a problem that resolves itself.

export type FailedOutboxGroup = {
  /** The tRPC path. For keys and analytics, never for display. */
  procedure: string;
  /** What the client calls it — "Logged sets", never `workouts.logSet`. */
  label: string;
  count: number;
  /** The newest `created_at` in the group, epoch ms. */
  lastQueuedAt: number;
};

export type FailedOutboxSummary = {
  totalCount: number;
  /** Newest group first, so the most recent thing the client did is at the top. */
  groups: FailedOutboxGroup[];
};

/** `status='failed'` AND at the attempt ceiling — see this file's header. */
const isPermanentlyFailed = () =>
  and(eq(outbox.status, 'failed'), gte(outbox.attempts, MAX_ATTEMPTS));

/**
 * Every outbox row that has exhausted its attempts, grouped for display.
 *
 * Grouped in JS rather than in SQL: the row count here is a handful by
 * construction (a client with hundreds of permanently-failed mutations has
 * a different problem), and the grouping needs `labelForOutboxProcedure`,
 * which is TypeScript.
 */
export async function readFailedOutboxEntries(): Promise<FailedOutboxSummary> {
  const db = await getLocalDb();
  const rows = db
    .select({ procedure: outbox.procedure, createdAt: outbox.createdAt })
    .from(outbox)
    .where(isPermanentlyFailed())
    .all();

  const byProcedure = new Map<string, FailedOutboxGroup>();
  for (const row of rows) {
    const existing = byProcedure.get(row.procedure);
    if (existing) {
      existing.count += 1;
      existing.lastQueuedAt = Math.max(existing.lastQueuedAt, row.createdAt);
      continue;
    }
    byProcedure.set(row.procedure, {
      procedure: row.procedure,
      label: labelForOutboxProcedure(row.procedure),
      count: 1,
      lastQueuedAt: row.createdAt,
    });
  }

  const groups = [...byProcedure.values()].sort(
    // Procedure name as the tie-break, so the list never reorders itself
    // between two renders of the same data.
    (a, b) => b.lastQueuedAt - a.lastQueuedAt || a.procedure.localeCompare(b.procedure),
  );

  return { totalCount: rows.length, groups };
}

/**
 * The manual "Try again". Resets every permanently-failed row to
 * `attempts=0`, `status='queued'`, `next_attempt_at=now()` and then runs
 * the ordinary flush loop over them.
 *
 * Deliberately NOT a bespoke send path: a second way to reach the server is
 * a second place `clientLocalId` handling, dependency ordering, and the
 * single-flight guard can drift (DB§14.2, `offline-sync` §4). What the user
 * pressed is "put these back in the queue", nothing more.
 *
 * `last_error` is cleared because it now describes a state the row is no
 * longer in; if the retry fails again the loop writes a fresh code.
 *
 * Returns how many rows were re-queued. Never deletes one — DB§14.4 forbids
 * it, and a failed retry leaves the entry exactly where the banner can find
 * it again.
 */
export async function retryFailedOutboxEntries(options: FlushOutboxOptions = {}): Promise<number> {
  const db = await getLocalDb();
  const stuck = db.select({ id: outbox.id }).from(outbox).where(isPermanentlyFailed()).all();
  if (stuck.length === 0) return 0;

  db.update(outbox)
    .set({
      status: 'queued',
      attempts: 0,
      nextAttemptAt: (options.now ?? Date.now)(),
      lastError: null,
    })
    .where(isPermanentlyFailed())
    .run();

  await flushOutbox(options);
  return stuck.length;
}
