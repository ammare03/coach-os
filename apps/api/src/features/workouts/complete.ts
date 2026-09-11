import { recomputeSessionVolume, schema, type DbClient, type WorkoutSession } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';

// `workouts.complete` — the server half of
// `phase-09-workout-logger/session-runtime/07`. The last transition in a
// session's lifecycle: `status → 'completed'`, `completed_at` stamped,
// `duration_seconds` and `total_volume_kg` derived, and the hand-off to
// `session-summary` unblocked.
//
// Six decisions, in the order they matter:
//
// (a) **This is an UPDATE, not an upsert** — `./start.ts` decision (a),
//     verbatim and for the same reason. The row exists: a materialised
//     session was created by `../../lib/materialise-sessions.ts`, an ad-hoc
//     one by `./start-ad-hoc.ts`. Routing this through
//     `../../lib/workout-session-upsert.ts` would key it on
//     `(client_id, client_local_id)` — and because that column is NULLABLE
//     behind a PARTIAL unique index, a row whose stored key is null would
//     take the INSERT branch and give the client a second, completed,
//     empty workout. That is the exact duplicate this subsystem exists to
//     prevent (`offline-sync` §10).
//
// (b) **The session is named by its `client_local_id`, and `./start.ts`
//     names its own by the server id.** The difference is not an
//     inconsistency; it is the only shape that works. `workouts.start` only
//     ever moves an ASSIGNED session, which the server materialised long
//     before the device lost signal, so a server id is always to hand. This
//     procedure also has to complete an AD-HOC session — one created on the
//     device, whose row is still sitting in the outbox, and whose server id
//     the flush loop never writes back. A client who starts an empty session
//     in a gym basement and finishes it there has no `workout_sessions.id`
//     to send. Every session row a client can reach carries a non-null
//     `client_local_id` (deterministic for a materialised one, DB§14.5
//     mechanism 1; device-generated for an ad-hoc one), so that is the key
//     that always exists on both sides.
//
//     Keying on it costs nothing in safety. The predicate below pins
//     `client_id` to `ctx.user.clientProfileId`, so the statement cannot
//     reach another client's row — the same scoping `workouts.startAdHoc`
//     and `workouts.upcoming` rely on, and the reason this procedure carries
//     no `ownsResource`: there is no caller-supplied id that resolves to
//     somebody else's row for the middleware to guard
//     (`../../routers/workouts.ts` states this at the call site).
//
// (c) **`started_at IS NOT NULL` is in the predicate, not in a prior read.**
//     The `session_completion` CHECK (`packages/db/src/schema/training.ts`)
//     is `status <> 'completed' OR (started_at IS NOT NULL AND completed_at
//     IS NOT NULL)`. Confirming the start in the same statement that writes
//     the completion is what makes the constraint unreachable rather than
//     merely unlikely — a read-then-write leaves a window in which a
//     concurrent write clears the column between the two.
//
// (d) **`status = 'in_progress'` is the idempotency**, exactly as
//     `WHERE status = 'scheduled'` is `./start.ts`'s. The tenth replay finds
//     the row already `completed`, writes nothing, and answers with it — so
//     a second `completed_at` reported hours later by a re-queued outbox
//     entry cannot drag the transition anywhere.
//
//     `skipped` is left alone for `./start.ts` decision (c)'s reason: it is
//     the coach's write against a device holding a stale copy, and `status`,
//     `started_at` and `skip_reason` may only move together. `scheduled` is
//     left alone too — the completion is chained to the start in the outbox
//     (DB§14.2), so reaching here means the chain was absent, and the floor
//     under that is "write nothing", never "write a row the CHECK refuses".
//     Neither is raised as an error: the client is standing in a gym and has
//     nothing to do with a rejection, and the next prefetch corrects the
//     device.
//
// (e) **`duration_seconds` is the server's own subtraction.** Both
//     timestamps are already on the row by the time this statement runs, so
//     nothing the caller could send would be more truthful — and a local
//     clock is not the source of truth for a number the coach may review
//     later. `GREATEST(0, …)` is the one guard on top: a phone whose clock
//     runs backwards reports a finish before its own start, and while
//     neither instant is trustworthy enough to refuse the session over,
//     "-12 min" is not a duration.
//
// (f) **The volume recompute rides the same transaction, and it runs on the
//     replay path too.** DB§8.2's guarantee is that it must be impossible to
//     mark a session completed and not compute its volume; sharing one
//     transaction is what makes a failure in the second half roll the first
//     half back. Running it again on a replay is the deliberate extra: the
//     completion chains to the session START, not to the sets, so the sets
//     are siblings and some may still be in flight when the completion lands
//     (`apps/mobile/src/lib/outbox/enqueue.ts` rule 4). A recompute is
//     idempotent — it reads the rows rather than accumulating — so the one
//     moment the server gets to look again, it does.
//
// (g) **The program snapshot is discarded here, in the same statement**
//     (`./program-snapshot.ts`, DB§14.6, `session-runtime/09` step 7). Once
//     the session is `completed` the frozen prescription has served its
//     purpose and the `set_logs` are the record. Left behind, the column
//     becomes a second copy of program history that will eventually
//     disagree with `program_exercises` — and nothing would ever read it
//     again to notice.
//
//     It rides the SET rather than a follow-up UPDATE for the reason (f)
//     shares a transaction: a completion that cleared nothing, or a clear
//     that completed nothing, are both states no later code is written to
//     expect. An ABANDONED session keeps its snapshot until the 24-hour
//     abandonment sweep — it may still be resumed, and resuming it must
//     find the same prescription it started with.
//
//     ⚠️ This narrows the window; it does not close it. A set log that
//     lands after a completion nothing ever replays leaves the stored total
//     behind the rows. The systematic fix is `set-entry`'s: an insert into
//     `set_logs` for an already-completed session must pair with
//     `recomputeSessionVolume` in its own transaction, the way every write
//     path in `packages/db/src/aggregates/README.md`'s table does.

/**
 * What the device is told about the session it completed. Mapped field by
 * field and never returned wholesale, so a column added to
 * `workout_sessions` tomorrow does not silently start crossing the wire —
 * the same rule `StartedSessionSummary` states.
 */
export interface CompletedSessionSummary extends Pick<
  WorkoutSession,
  | 'id'
  | 'clientLocalId'
  | 'scheduledDate'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'durationSeconds'
> {
  /**
   * The mutation's own key, echoed so a caller can match a replayed response
   * to the entry that produced it. Not the row's `clientLocalId`, which is
   * beside it and means something else.
   */
  mutationClientLocalId: string;
  /**
   * Kilograms, parsed once here at the boundary. Drizzle hands back
   * `numeric` as a string (`code-conventions` §3's "numeric trap"), and a
   * caller that had to remember to parse it would eventually not.
   *
   * `null` means "no working set carried both a rep count and a weight" —
   * a bodyweight session — and is deliberately distinct from `0`
   * (`COPY.md` CO§2).
   */
  totalVolumeKg: number | null;
}

export type CompleteSessionInput = z.infer<typeof workoutsSchemas.completeSessionInput>;

/** The shape `recomputeSessionVolume` satisfies — injected so decision (f) is testable. */
export type RecomputeVolume = (
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  workoutSessionId: string,
) => Promise<void>;

export async function completeSession(
  db: DbClient,
  clientProfileId: string,
  input: CompleteSessionInput,
  /**
   * Defaulted rather than imported at the call site so a test can break the
   * aggregate and watch the transition roll back with it — DB§8.2's whole
   * guarantee, and the only way to prove it. Nothing in production passes
   * anything else.
   */
  recompute: RecomputeVolume = recomputeSessionVolume,
): Promise<CompletedSessionSummary> {
  // Decision (b). `client_id` is from `ctx.user`, never the wire, and it is
  // what makes this statement unable to touch another client's row.
  const owned = and(
    eq(schema.workoutSessions.clientId, clientProfileId),
    eq(schema.workoutSessions.clientLocalId, input.sessionClientLocalId),
    isNull(schema.workoutSessions.deletedAt),
  );

  return db.transaction(async (tx) => {
    // Decisions (c), (d) and (e) in one statement: the predicate decides and
    // the same statement writes, so two concurrent replays serialise on the
    // row lock and only the first matches.
    //
    // The instant is bound as an ISO string with an explicit cast rather
    // than as a `Date`: a raw `sql` fragment carries no column type mapper,
    // so postgres.js would be handed a value it cannot serialise and the
    // statement would fail at Bind. Drizzle applies the mapper only to the
    // plain-object form used for `status`/`completed_at` above it
    // (`./start.ts` hit the same edge).
    const completedAtSql = sql`${input.completedAt.toISOString()}::timestamptz`;

    const [updated] = await tx
      .update(schema.workoutSessions)
      .set({
        status: 'completed',
        completedAt: input.completedAt,
        // Decision (g). Cleared by the statement that completes the
        // session, not by a sweep afterwards.
        programSnapshot: null,
        durationSeconds: sql`GREATEST(0, EXTRACT(EPOCH FROM (${completedAtSql} - ${schema.workoutSessions.startedAt}))::integer)`,
      })
      .where(
        and(
          owned,
          eq(schema.workoutSessions.status, 'in_progress'),
          isNotNull(schema.workoutSessions.startedAt),
        ),
      )
      .returning();

    if (updated) {
      // Decision (f). Inside the transaction, after the transition, so the
      // sum sees a row that is already `completed` and a failure takes the
      // transition down with it.
      await recompute(tx, updated.id);
      return summarise(await reread(tx, updated.id), input.clientLocalId);
    }

    // Nothing matched. Either the session is already completed (the replay
    // this has to be a no-op for), or it is in a state decision (d) leaves
    // alone, or it is not this client's row. Only the last is an error, and
    // the read below is what tells them apart — it runs on the no-op path
    // only, never on the write path.
    const [existing] = await tx.select().from(schema.workoutSessions).where(owned).limit(1);

    if (!existing) {
      // A row that does not exist, belongs to someone else, or was purged
      // between the flush and here. One answer for all three — anything
      // finer is an existence oracle (`ERRORS.md` ER§2.1).
      throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
    }

    if (existing.status !== 'completed') return summarise(existing, input.clientLocalId);

    // Decision (f)'s replay branch: the transition is already done and must
    // not move, but the sets may have caught up since it happened.
    await recompute(tx, existing.id);
    return summarise(await reread(tx, existing.id), input.clientLocalId);
  });
}

/**
 * Re-reads the row after the recompute, because `total_volume_kg` is written
 * by a second statement and the `RETURNING` of the first cannot know about
 * it. One indexed read on a row this transaction already holds the lock for.
 */
async function reread(
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  id: string,
): Promise<WorkoutSession> {
  const [row] = await tx
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, id))
    .limit(1);

  if (!row) {
    // Unreachable: the row was updated microseconds ago inside this same
    // transaction. Thrown rather than coerced so a schema change that made
    // it reachable would say so loudly.
    throw new Error(`completeSession: session ${id} vanished inside its own transaction`);
  }
  return row;
}

function summarise(row: WorkoutSession, mutationClientLocalId: string): CompletedSessionSummary {
  return {
    id: row.id,
    clientLocalId: row.clientLocalId,
    mutationClientLocalId,
    scheduledDate: row.scheduledDate,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationSeconds: row.durationSeconds,
    totalVolumeKg: row.totalVolumeKg === null ? null : Number(row.totalVolumeKg),
  };
}
