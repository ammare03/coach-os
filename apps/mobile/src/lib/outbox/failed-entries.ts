import { and, eq, gte, inArray } from 'drizzle-orm';

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
//
// It is also WIDER than the attempt ceiling, and that half was missing
// until S31. A row whose `depends_on` never reached `'done'` is never
// claimed (`flush.ts`'s `claimReadyEntries`), so it is never sent, so its
// `attempts` stays 0 — while being exactly as stuck as the row blocking
// it. A client who logs a 30-set session on a dead connection has one
// session-start at the ceiling and thirty set-logs parked behind it; a
// banner reading "1 item couldn't be saved" is wrong by a factor of
// thirty at the moment it most needs to be right. So the read-side
// predicate is: **at the ceiling, or transitively behind a row that is.**
//
// This changes what the BANNER COUNTS and nothing else. `attempts`, the
// claim rule, and the flush loop's own idea of failure are untouched — a
// stranded child is still an ordinary `'queued'` row that syncs the moment
// its parent does.

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
 * Every status a row can still be waiting in.
 *
 * `'done'` is excluded for two reasons, and both matter. It is never part
 * of a stuck chain — a row only reaches `'done'` by being sent, and it is
 * only sent once its own parent is `'done'`, so no descendant of an
 * exhausted row can be `'done'`. And `flush.ts` deliberately never deletes
 * a `'done'` row, so that set grows for the life of the install while this
 * one stays the size of the unsynced backlog. An `in (…)` over the three
 * live statuses reads through the `outbox_ready` index; `status <> 'done'`
 * would scan the history too.
 */
const PENDING_STATUSES = ['queued', 'inflight', 'failed'] as const;

/** One pending row, narrowed to the columns the walk needs — inferred, never restated (the same shape rule `flush.ts`'s `OutboxEntry` follows). */
type PendingRow = Pick<
  typeof outbox.$inferSelect,
  'id' | 'procedure' | 'createdAt' | 'dependsOn' | 'attempts' | 'status'
>;

/** At the ceiling on its own account — the root of any stuck chain. */
const isExhausted = (row: PendingRow) => row.status === 'failed' && row.attempts >= MAX_ATTEMPTS;

/**
 * Every exhausted row, plus everything transitively parked behind one.
 *
 * One breadth-first pass in JS over the rows already in hand, not a
 * recursive CTE and emphatically not a query per row. This runs on the
 * client's device on the screen they are looking at while sync is failing,
 * so the cost has to be one read: the pending set is tens of rows (a
 * session plus its sets), and walking it is cheaper than a second round
 * trip through the driver. The CTE was the other candidate and was
 * rejected on testability — `expo-sqlite` supports `WITH RECURSIVE`, but
 * the outbox suites run against `__fixtures__/sqlite-fake.ts`, whose SQL
 * subset does not, so the one path that matters would have been the one
 * path no test could execute.
 *
 * **Cycles terminate by construction.** `depends_on` should never form
 * one — `enqueueMutation` only ever points a new row at an existing one —
 * but a corrupt row must not hang the banner, which would be a worse
 * failure than the undercount this fixes. `seen` is checked before a row
 * is ever enqueued, so each row is visited at most once and the walk is
 * bounded by `rows.length` regardless of the edge shape. It is also what
 * keeps a row that is both exhausted and a dependent from being counted
 * twice.
 */
function collectStuckRows(rows: PendingRow[]): PendingRow[] {
  const childrenByParent = new Map<string, PendingRow[]>();
  for (const row of rows) {
    if (row.dependsOn === null) continue;
    const siblings = childrenByParent.get(row.dependsOn);
    if (siblings) siblings.push(row);
    else childrenByParent.set(row.dependsOn, [row]);
  }

  const seen = new Set<string>();
  const stuck: PendingRow[] = [];
  for (const row of rows) {
    if (!isExhausted(row) || seen.has(row.id)) continue;
    seen.add(row.id);
    stuck.push(row);
  }
  // `stuck` is the frontier and the result at once — appending to it while
  // reading forward is the breadth-first walk.
  for (let i = 0; i < stuck.length; i += 1) {
    const row = stuck[i];
    if (row === undefined) continue;
    for (const child of childrenByParent.get(row.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      stuck.push(child);
    }
  }
  return stuck;
}

/**
 * Every outbox row the client is waiting on and will keep waiting on,
 * grouped for display — see `collectStuckRows` for what qualifies.
 *
 * Grouped in JS rather than in SQL: the row count here is a handful by
 * construction (a client with hundreds of permanently-failed mutations has
 * a different problem), and the grouping needs `labelForOutboxProcedure`,
 * which is TypeScript.
 */
export async function readFailedOutboxEntries(): Promise<FailedOutboxSummary> {
  const db = await getLocalDb();
  const pending = db
    .select({
      id: outbox.id,
      procedure: outbox.procedure,
      createdAt: outbox.createdAt,
      dependsOn: outbox.dependsOn,
      attempts: outbox.attempts,
      status: outbox.status,
    })
    .from(outbox)
    .where(inArray(outbox.status, [...PENDING_STATUSES]))
    .all();
  const rows = collectStuckRows(pending);

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
 * The reset stays at the attempt ceiling even though the banner now counts
 * the rows stranded behind it (S31), and that asymmetry is deliberate: a
 * stranded row is already `'queued'` with `attempts=0` and due, so there is
 * nothing about it to reset — it is waiting on its parent, not on the
 * clock. Re-queueing the root is what frees the whole chain, and the flush
 * loop takes the children with it in order. Resetting a child directly
 * could only ever move it AHEAD of the parent it depends on, which is the
 * one thing DB§14.2 forbids.
 *
 * `last_error` is cleared because it now describes a state the row is no
 * longer in; if the retry fails again the loop writes a fresh code.
 *
 * Returns how many rows were re-queued — the roots, which is not the
 * banner's count and is not shown to anyone. Never deletes one — DB§14.4
 * forbids it, and a failed retry leaves the entry exactly where the banner
 * can find it again.
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
