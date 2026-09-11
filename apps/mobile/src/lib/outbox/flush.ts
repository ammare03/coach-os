import type { TRPCUntypedClient } from '@trpc/client';
// Type-only, like `lib/trpc.ts` — a value import would drag the Drizzle
// driver and Node builtins into the Metro bundle.
import type { AppRouter } from 'api/src/routers/index.ts';
import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localMeals } from '../../db/schema/local-nutrition.ts';
import { localSetLogs, localWorkoutSessions } from '../../db/schema/local-training.ts';
import { outbox } from '../../db/schema/sync.ts';
import { asProcedureName, trackEvent } from '../analytics/index.ts';
import { getErrorCode } from '../error-code.ts';

import { computeBackoff } from './backoff.ts';
import { deserializeOutboxPayload } from './enqueue.ts';
import { publishOutboxResult } from './results.ts';

// The engine of the outbox (DB§14.1, DB§14.2): read the rows that are ready,
// send each to its tRPC procedure, mark it done — with the two properties
// DB§14 puts above everything else, idempotent sends and correct ordering.
//
// The one mechanism the phase's exit gate rests on is `claimReadyEntries`
// below: the read and the `status='inflight'` write happen inside one local
// SQLite transaction, and — because `expo-sqlite`'s API is synchronous — with
// no `await` between them, so no second flush can observe a row after the
// first has read it but before the first has claimed it. Adding an `await`
// inside that function silently removes the guarantee.

/**
 * DB§14.4's ceiling. A row at this many attempts is never claimed again —
 * it is terminal, not lost: `lib/outbox/failed-entries.ts` reads it back
 * and `features/sync` surfaces it with a manual retry.
 */
export const MAX_ATTEMPTS = 10;

/** How many rows one pass claims. Bounds concurrent in-flight sends; the loop keeps passing until nothing is ready. */
export const FLUSH_BATCH_SIZE = 20;

/**
 * The device-mirror tables a conflict has to mark (DB§13). Every writable
 * one carries `client_local_id` and `sync_state`, and the id is a UUIDv7,
 * so at most one row across all three can match — which is why this is a
 * sweep rather than a `procedure` → table map. A map would have to be
 * edited by every feature that adds a mutation, and the failure mode of
 * forgetting is a silent no-op: a conflicted row still rendering as if it
 * had synced.
 */
const CONFLICTABLE_MIRRORS = [localWorkoutSessions, localSetLogs, localMeals] as const;

type OutboxStatus = (typeof outbox.$inferSelect)['status'];

/** `queued`, plus a `failed` row whose backoff has elapsed — DB§14.4's retry-due state. */
const READY_STATUSES: OutboxStatus[] = ['queued', 'failed'];

/** `router.procedure`, tRPC's own path shape. Anything else can only be a bad enqueue. */
const PROCEDURE_PATH = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** One claimed row, narrowed to the columns the sender needs — inferred, never restated. */
export type OutboxEntry = Pick<
  typeof outbox.$inferSelect,
  'id' | 'procedure' | 'clientLocalId' | 'payloadJson' | 'dependsOn' | 'attempts'
>;

/** Mirrors `TRPCUntypedClient.mutation(path, input)` — injected so tests never touch the network. */
export type OutboxSender = (procedure: string, input: Record<string, unknown>) => Promise<unknown>;

export interface FlushOutboxOptions {
  send?: OutboxSender;
  now?: () => number;
  backoffMs?: (attempts: number) => number;
}

export interface FlushOutboxResult {
  claimed: number;
  sent: number;
  failed: number;
}

/** A failure this device caused and a retry cannot fix. Loud and specific, never silent. */
class OutboxDispatchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OutboxDispatchError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The tRPC client the flush loop sends through. Built lazily and imported
// dynamically for one concrete reason: `trpc-links.ts` resolves
// `EXPO_PUBLIC_API_URL` at module scope, so a static import would make merely
// importing this module throw wherever that variable is unset. It is also a
// second client, separate from `TRPCProvider`'s: that one is created inside a
// component's `useState` and is unreachable from a module the connectivity
// listener calls. Both share the same links, so the same auth, refresh, and
// superjson transformer apply.
let sendClient: Promise<TRPCUntypedClient<AppRouter>> | null = null;

function getSendClient(): Promise<TRPCUntypedClient<AppRouter>> {
  if (!sendClient) {
    const building = Promise.all([import('@trpc/client'), import('../trpc-links.ts')]).then(
      ([{ createTRPCUntypedClient }, { buildLinks }]) =>
        createTRPCUntypedClient<AppRouter>({ links: buildLinks() }),
    );
    // Don't memoise a failure (same idiom as `db/client.ts`).
    building.catch(() => {
      sendClient = null;
    });
    sendClient = building;
  }
  return sendClient;
}

// Dispatch is by string, because that is what `outbox.procedure` is: a value
// read back from SQLite after an app restart, which no type can constrain.
// `enqueueMutation` takes `procedure: string` for the same reason, so there is
// no call site where a literal could be checked against `AppRouter` either.
// What is achievable is the "or at minimum" half of the requirement: the path
// shape is validated before the send, and a bad one fails with its own code
// and a log line rather than a silent no-op.
const sendViaTrpc: OutboxSender = async (procedure, input) => {
  const client = await getSendClient();
  return client.mutation(procedure, input);
};

/**
 * Reads the rows ready to send and claims them, in one transaction.
 *
 * Ready means `status='queued'`, or a `failed` row whose `next_attempt_at` has
 * elapsed and which is still under `MAX_ATTEMPTS` — and whose `depends_on`
 * row, if it has one, is already `'done'` (DB§14.2: a set log waits for its
 * session). A dangling or unfinished parent leaves the child unclaimed, which
 * is the safe direction: late beats out of order.
 *
 * Synchronous end to end. See this file's header for why that matters.
 */
export function claimReadyEntries(
  db: LocalDb,
  nowMs: number,
  limit: number = FLUSH_BATCH_SIZE,
): OutboxEntry[] {
  return db.transaction((tx) => {
    const candidates = tx
      .select({
        id: outbox.id,
        procedure: outbox.procedure,
        payloadJson: outbox.payloadJson,
        clientLocalId: outbox.clientLocalId,
        dependsOn: outbox.dependsOn,
        attempts: outbox.attempts,
      })
      .from(outbox)
      .where(
        and(
          inArray(outbox.status, READY_STATUSES),
          lte(outbox.nextAttemptAt, nowMs),
          lt(outbox.attempts, MAX_ATTEMPTS),
        ),
      )
      // Oldest first, so a parent is always considered before its children and
      // a full batch can never starve the chain it is blocking.
      .orderBy(asc(outbox.createdAt))
      .limit(limit)
      .all();

    if (candidates.length === 0) return [];

    const parentIds = [
      ...new Set(
        candidates
          .map((candidate) => candidate.dependsOn)
          .filter((id): id is string => id !== null),
      ),
    ];
    const syncedParents = new Set<string>();
    if (parentIds.length > 0) {
      // One batched lookup, never one per row (`code-conventions` §7).
      const parents = tx
        .select({ id: outbox.id, status: outbox.status })
        .from(outbox)
        .where(inArray(outbox.id, parentIds))
        .all();
      for (const parent of parents) {
        if (parent.status === 'done') syncedParents.add(parent.id);
      }
    }

    const ready = candidates.filter(
      (candidate) => candidate.dependsOn === null || syncedParents.has(candidate.dependsOn),
    );
    if (ready.length === 0) return [];

    tx.update(outbox)
      .set({ status: 'inflight' })
      .where(
        inArray(
          outbox.id,
          ready.map((entry) => entry.id),
        ),
      )
      .run();

    return ready;
  });
}

/** The idempotency key travels in the input — it is what the server's `ON CONFLICT` upsert keys on (DB§14.1). */
function buildProcedureInput(entry: OutboxEntry): Record<string, unknown> {
  if (!PROCEDURE_PATH.test(entry.procedure)) {
    throw new OutboxDispatchError('INVALID_PROCEDURE', 'Not a tRPC procedure path');
  }
  let payload: unknown;
  try {
    // superjson, never `JSON.parse` — a `Date` captured at action time has to
    // still be a `Date` here, or every synced row is timestamped at reconnect
    // (`offline-sync` §10).
    payload = deserializeOutboxPayload(entry.payloadJson);
  } catch {
    throw new OutboxDispatchError('CORRUPT_PAYLOAD', 'Stored payload could not be decoded');
  }
  if (!isRecord(payload)) {
    throw new OutboxDispatchError('INVALID_PAYLOAD', 'Payload is not an object');
  }
  // The row's id wins over anything the payload carries: the row is the only
  // place the id generated at action time is authoritative.
  return { ...payload, clientLocalId: entry.clientLocalId };
}

/**
 * A short, stable code for `outbox.last_error` — never the error message.
 * A message can carry an echoed payload, an email, or a URL, and this column
 * is read back into a support surface (`observability-ops` §1, §3).
 */
function describeSendFailure(error: unknown): string {
  if (error instanceof OutboxDispatchError) return error.code;
  const appCode = getErrorCode(error);
  if (appCode) return appCode;
  const data: unknown = isRecord(error) ? error.data : null;
  if (isRecord(data) && typeof data.code === 'string') return data.code;
  return 'NETWORK_ERROR';
}

/**
 * Whether the server answered with a genuine conflict.
 *
 * Keyed on the **transport status**, not on our own `SYNC_CONFLICT` code:
 * a 409 is the server saying "I understood you and the answer is no", and
 * no number of retries changes that (DB§14.4, `offline-sync` §5). Retrying
 * one would burn all ten attempts and then tell the client their set could
 * not be saved, which is both wrong and the most damaging thing this
 * subsystem can say.
 *
 * Reads `error.data` structurally rather than requiring a
 * `TRPCClientError`, because the sender is an injected seam and the shape
 * is what matters, not the class.
 */
function isConflictFailure(error: unknown): boolean {
  if (error instanceof OutboxDispatchError) return false;
  if (getErrorCode(error) === 'SYNC_CONFLICT') return true;
  const data: unknown = isRecord(error) ? error.data : null;
  if (!isRecord(data)) return false;
  return data.httpStatus === 409 || data.code === 'CONFLICT';
}

/**
 * Hands the row to conflict resolution and takes it out of the retry loop.
 *
 * The mirror row goes to `sync_state='conflict'`, which is where
 * `sync-engine` picks it up — this task deliberately stops there and
 * resolves nothing (`outbox/03` Scope).
 *
 * The outbox row goes to `'done'` with `SYNC_CONFLICT` in `last_error`,
 * and `attempts` is left exactly where it was. `'done'` reads oddly until
 * you ask what it means: the outbox is finished with this row. The
 * mutation *reached* the server and got a definitive answer, so it must
 * not be retried (`'failed'` would be re-claimed the moment its backoff
 * elapsed) and must not count toward the failure banner, which tells a
 * client their work never left the device. DB§14's status set is closed —
 * queued/inflight/failed/done — so a fifth value is not this task's to
 * invent (`CLAUDE.md` rule 4). DB§14.4 carries the same rule.
 */
function markConflicted(db: LocalDb, entry: OutboxEntry): void {
  let mirrored = 0;
  for (const mirror of CONFLICTABLE_MIRRORS) {
    mirrored += db
      .update(mirror)
      .set({ syncState: 'conflict' })
      .where(eq(mirror.clientLocalId, entry.clientLocalId))
      .run().changes;
  }
  db.update(outbox)
    .set({ status: 'done', lastError: 'SYNC_CONFLICT' })
    .where(eq(outbox.id, entry.id))
    .run();

  // The sweep above is the only thing that makes a conflict visible — to the
  // client, and to `sync-engine`, which resolves it. Match nothing and the
  // conflict survives solely in `last_error` on a row reading `'done'`, which
  // no surface and no pending count looks at. Unreachable while every
  // offline-writable mutation maps to a mirror carrying `sync_state`, and
  // silently reachable the first one that does not (DB§14.4).
  if (mirrored === 0) {
    console.warn('outbox.conflict_unmirrored', {
      outboxId: entry.id,
      procedure: entry.procedure,
    });
  }
}

function markDone(db: LocalDb, entryId: string): void {
  // Left in place rather than deleted: DB§14 does not call for deletion, and a
  // recently-synced row is what answers "did my workout upload?" without
  // reading any of its content. Pruning old `'done'` rows is a later concern.
  db.update(outbox).set({ status: 'done' }).where(eq(outbox.id, entryId)).run();
}

function scheduleRetry(
  db: LocalDb,
  entry: OutboxEntry,
  error: unknown,
  nowMs: number,
  backoffMs: (attempts: number) => number,
): void {
  const attempts = entry.attempts + 1;
  // Strictly in the future, always: a delay of 0 would make the row eligible
  // again inside the same flush run and spin the loop on one failing row.
  const delayMs = Math.max(1, Math.trunc(backoffMs(attempts)));
  db.update(outbox)
    .set({
      status: 'failed',
      attempts,
      nextAttemptAt: nowMs + delayMs,
      lastError: describeSendFailure(error),
    })
    .where(eq(outbox.id, entry.id))
    .run();

  // DB§14.4's terminal state. `claimReadyEntries` already refuses a row at
  // the ceiling, so nothing more is needed to stop the retrying — what is
  // needed is that it stops SILENTLY nowhere. This is the moment the
  // failure becomes user-visible (`features/sync`) and operator-visible.
  if (attempts >= MAX_ATTEMPTS) {
    // Fixed message, ids and codes only (`observability-ops` §1, §3). A
    // permanently-failed outbox row is a P1 integrity signal (§4).
    console.warn('outbox.permanently_failed', {
      outboxId: entry.id,
      procedure: entry.procedure,
      attempts,
      errorCode: describeSendFailure(error),
    });
    trackEvent('sync_failed', {
      procedure: asProcedureName(entry.procedure),
      attempts,
    });
  }
}

async function sendEntry(
  db: LocalDb,
  entry: OutboxEntry,
  nowMs: number,
  send: OutboxSender,
  backoffMs: (attempts: number) => number,
): Promise<boolean> {
  try {
    const input = buildProcedureInput(entry);
    const result = await send(entry.procedure, input);
    markDone(db, entry.id);
    // After the row is `done`, and isolated from it (`./results.ts` rule
    // (b)): a delivered mutation must never become a retry because a
    // listener threw. The response is otherwise discarded — the mirror is
    // device-wins (`offline-sync` §5), so almost nothing a server returns
    // is news. `workouts.logSet.newPersonalRecords` is the exception, and
    // this is the only way off the flush loop it has.
    publishOutboxResult({
      procedure: entry.procedure,
      clientLocalId: entry.clientLocalId,
      input,
      result,
    });
    return true;
  } catch (error) {
    if (error instanceof OutboxDispatchError) {
      // Fixed message, ids and codes only (`observability-ops` §1). A row this
      // device can never send is worth one loud line, not a silent retry.
      console.warn('outbox.dispatch_rejected', {
        outboxId: entry.id,
        procedure: entry.procedure,
        errorCode: error.code,
      });
    }
    if (isConflictFailure(error)) {
      markConflicted(db, entry);
      return false;
    }
    scheduleRetry(db, entry, error, nowMs, backoffMs);
    return false;
  }
}

/**
 * One claim-and-send batch, awaited to completion.
 *
 * Exported for one job only: it is the unit the single-flight guard protects,
 * so calling it directly bypasses the promise in `flushOutbox` and leaves the
 * `inflight` claim as the sole defence — which is exactly what the concurrency
 * test needs to prove. `runFlush` below deliberately does NOT use it, because
 * awaiting a whole batch is the barrier task 04 exists to remove.
 */
export async function runFlushPass(
  db: LocalDb,
  nowMs: number,
  options: FlushOutboxOptions = {},
): Promise<FlushOutboxResult> {
  const send = options.send ?? sendViaTrpc;
  const backoffMs = options.backoffMs ?? computeBackoff;

  const claimed = claimReadyEntries(db, nowMs);
  if (claimed.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  const outcomes = await Promise.all(
    claimed.map((entry) => sendEntry(db, entry, nowMs, send, backoffMs)),
  );
  const sent = outcomes.filter(Boolean).length;
  return { claimed: claimed.length, sent, failed: outcomes.length - sent };
}

/**
 * Sends everything ready, re-claiming as each send settles (DB§14.2).
 *
 * The scheduling rule is one line: **a send starts the moment its row becomes
 * claimable, and never waits on a row it does not depend on.** That is both
 * halves of DB§14.2 at once — a child is unclaimable until its parent is
 * `'done'`, which is the strict order within a chain, and nothing else
 * synchronises, which is the parallelism across chains.
 *
 * Why a race and not a batch loop. The obvious shape — claim a batch, await
 * the batch, claim again — is correct but installs a barrier at every batch
 * boundary: one slow session holds up the sets of every *other* session in
 * the queue, which is precisely the artificial serialisation DB§14.2's
 * "parallel across chains" exists to forbid. Racing instead means one settled
 * send immediately re-opens the claim, so an unrelated chain advances on its
 * own schedule.
 *
 * It terminates. A claimed row is `'inflight'`, and every exit from a send
 * leaves it `'done'` or `'failed'` with `next_attempt_at > startedAt`, so no
 * row is claimed twice in one run; each turn of the loop either consumes rows
 * or retires an in-flight send, and it stops when neither is possible.
 */
async function drainOutbox(
  db: LocalDb,
  startedAt: number,
  options: FlushOutboxOptions,
): Promise<FlushOutboxResult> {
  const send = options.send ?? sendViaTrpc;
  const backoffMs = options.backoffMs ?? computeBackoff;
  const total: FlushOutboxResult = { claimed: 0, sent: 0, failed: 0 };
  const inFlight = new Set<Promise<void>>();

  for (;;) {
    // `FLUSH_BATCH_SIZE` bounds sends in flight, not sends per claim — a
    // device on hotel wifi opening 60 sockets because its queue is 60 deep
    // helps nobody.
    const capacity = FLUSH_BATCH_SIZE - inFlight.size;
    for (const entry of capacity > 0 ? claimReadyEntries(db, startedAt, capacity) : []) {
      total.claimed += 1;
      const settled = sendEntry(db, entry, startedAt, send, backoffMs).then((wasSent) => {
        if (wasSent) total.sent += 1;
        else total.failed += 1;
      });
      inFlight.add(settled);
      void settled.then(() => inFlight.delete(settled));
    }

    if (inFlight.size === 0) return total;
    // Any one completion may have unblocked a child; go and look.
    await Promise.race(inFlight);
  }
}

/**
 * Rows left `'inflight'` by a process that died mid-send — a force-quit during
 * a workout is the ordinary case. Nothing else can produce one at startup,
 * because only one flush runs per process and none has run yet, so returning
 * them to `'queued'` is safe and is the difference between a retried set and a
 * silently stranded one. Runs once per process, before the first claim.
 */
function recoverOrphanedEntries(db: LocalDb): void {
  db.update(outbox).set({ status: 'queued' }).where(eq(outbox.status, 'inflight')).run();
}

let activeFlush: Promise<FlushOutboxResult> | null = null;
let orphansRecovered = false;

async function runFlush(options: FlushOutboxOptions): Promise<FlushOutboxResult> {
  const db = await getLocalDb();
  if (!orphansRecovered) {
    recoverOrphanedEntries(db);
    orphansRecovered = true;
  }

  // One clock for the whole run. A row rescheduled by a failure during this
  // run is dated after `startedAt` and so cannot be re-claimed later in the
  // same run — which is what makes the loop terminate.
  const startedAt = (options.now ?? Date.now)();
  return drainOutbox(db, startedAt, options);
}

/**
 * Flushes the outbox. Called by the connectivity listener on regain and on app
 * foreground (`phase-08-offline-core/connectivity/01`) — this module owns no
 * trigger of its own.
 *
 * Single-flight in two independent layers, and both are deliberate:
 *
 *  1. A second call while one is running joins the running promise rather than
 *     starting a second loop — the "foreground and connectivity fire together"
 *     case (`offline-sync` §4).
 *  2. Even if a second loop somehow starts, `claimReadyEntries` has already
 *     marked its rows `'inflight'`, so the second loop claims none of them.
 *     Layer 2 is the guarantee; layer 1 is only an optimisation of it.
 *
 * A mutation enqueued *during* a run is not picked up by that run — it stays
 * `'queued'` and goes on the next trigger. Nothing is lost, and the alternative
 * (a moving clock) costs the loop its termination proof.
 */
export function flushOutbox(options: FlushOutboxOptions = {}): Promise<FlushOutboxResult> {
  if (activeFlush) return activeFlush;
  const running = runFlush(options).finally(() => {
    activeFlush = null;
  });
  activeFlush = running;
  return running;
}

/** Test seam — mirrors `resetLocalDbForTests` in `db/client.ts`. */
export function resetOutboxFlushStateForTests(): void {
  activeFlush = null;
  orphansRecovered = false;
  sendClient = null;
}
