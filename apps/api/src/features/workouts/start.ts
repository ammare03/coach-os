import { schema, type DbClient, type WorkoutSession } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';

// `workouts.start` — the server half of
// `phase-09-workout-logger/session-runtime/01`. A client taps Start on the
// session their coach programmed; this is the row transition that lands
// behind them once the outbox reaches the network.
//
// Four decisions, in the order they matter:
//
// (a) **This is an UPDATE, not an upsert.** Every other offline-capable
//     write in P09 goes through `../../lib/offline-upsert.ts`, because it
//     creates a row the server has never seen. This one does not: an
//     assigned session was materialised by `../../lib/materialise-sessions.ts`
//     long before the client left signal, so there is nothing to insert.
//     Routing it through `upsertWorkoutSession` anyway would key it on
//     `(client_id, client_local_id)` — and `workout_sessions.client_local_id`
//     is NULLABLE with a PARTIAL unique index, so a row whose stored key is
//     null would take the INSERT branch and give the client a second
//     workout for one tap. That is the exact duplicate this subsystem exists
//     to prevent (`offline-sync` §10).
//
// (b) **Idempotency is the transition's own.** `WHERE status = 'scheduled'`
//     is what makes the tenth replay a no-op: it finds the row already
//     `in_progress` and writes nothing, then reads it back and answers with
//     it. Same guarantee `ON CONFLICT` gives elsewhere, by the mechanism
//     that fits a row that already exists.
//
// (c) **`completed` and `skipped` are left exactly as they are**, and that
//     is not an oversight in (b)'s condition. A start arriving after a
//     completion can only be a replay — the device chains its completion to
//     its start (DB§14.2), so the start is `'done'` before the completion is
//     ever claimable — and reverting on a replay is `CLAUDE.md` §25.12's
//     double-apply. A `skipped` row is the coach's write against a device
//     holding a stale `scheduled` copy; moving it would leave the row
//     carrying a `skip_reason` its own status contradicts, and `status`,
//     `started_at`, and `skip_reason` may only move together
//     (`../../lib/workout-session-upsert.ts`). The row is returned unchanged
//     rather than raised as an error: the client is standing in a gym and
//     has nothing to do with a rejection, and the next prefetch corrects
//     the device.
//
// (d) **The client comes from `ctx.user` and the row from `ownsResource`.**
//     `workoutSessionId` is the one caller-supplied id, and it is registered
//     in `../../trpc/authz/resource-fields.ts`, so the enumeration test
//     probes it. The `client_id` predicate below is belt-and-braces on top
//     of that guard, not a substitute for it — and it is what makes the
//     UPDATE itself unable to touch another client's row even if the
//     middleware were ever removed.

/**
 * What the device is told about the row it started. Mapped field by field
 * and never returned wholesale, so a column added to `workout_sessions`
 * tomorrow does not silently start crossing the wire — the same rule
 * `AdHocSessionSummary` states.
 */
export interface StartedSessionSummary extends Pick<
  WorkoutSession,
  'id' | 'clientLocalId' | 'scheduledDate' | 'status' | 'startedAt'
> {
  /**
   * The mutation's own key, echoed so a caller can match a replayed
   * response to the entry that produced it. Not the row's `clientLocalId`,
   * which is beside it and means something else — decision (a).
   */
  mutationClientLocalId: string;
}

export type StartSessionInput = z.infer<typeof workoutsSchemas.startSessionInput>;

export async function startSession(
  db: DbClient,
  clientProfileId: string,
  input: StartSessionInput,
): Promise<StartedSessionSummary> {
  const owned = and(
    eq(schema.workoutSessions.id, input.workoutSessionId),
    eq(schema.workoutSessions.clientId, clientProfileId),
    isNull(schema.workoutSessions.deletedAt),
  );

  // Decisions (b) and (c), as a predicate rather than a `CASE` in the `SET`:
  // `status` and `started_at` move together or not at all, and the statement
  // that decides is the one that writes, so two concurrent replays serialise
  // on the row lock and only the first matches.
  const [updated] = await db
    .update(schema.workoutSessions)
    .set({ status: 'in_progress', startedAt: input.startedAt })
    .where(and(owned, eq(schema.workoutSessions.status, 'scheduled')))
    .returning();

  if (updated) return summarise(updated, input.clientLocalId);

  // Nothing matched, which is either "already started" (the replay this
  // procedure has to be a no-op for) or "not this client's row". Only the
  // second is an error, and the read below is what tells them apart — it
  // runs on the no-op path only, never on the write path.
  const [existing] = await db.select().from(schema.workoutSessions).where(owned).limit(1);

  if (!existing) {
    // A row that does not exist, belongs to someone else, or was purged
    // between `ownsResource` and here. One answer for all three — anything
    // finer is an existence oracle (`ERRORS.md` ER§2.1).
    throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
  }

  return summarise(existing, input.clientLocalId);
}

function summarise(row: WorkoutSession, mutationClientLocalId: string): StartedSessionSummary {
  return {
    id: row.id,
    clientLocalId: row.clientLocalId,
    mutationClientLocalId,
    scheduledDate: row.scheduledDate,
    status: row.status,
    startedAt: row.startedAt,
  };
}
