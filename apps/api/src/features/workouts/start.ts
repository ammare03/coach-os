import { schema, type DbClient, type WorkoutSession } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';

import { buildProgramSnapshot } from './program-snapshot.ts';

// `workouts.start` — the server half of
// `phase-09-workout-logger/session-runtime/01`. A client taps Start on the
// session their coach programmed; this is the row transition that lands
// behind them once the outbox reaches the network.
//
// Five decisions, in the order they matter:
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
//
// (e) **The claim is taken by the transition, in the same statement**
//     (`./claim.ts`, DB§14.5 mechanism 3, added by `session-runtime/08`).
//     Claiming on Start and not on open is the rule; this IS the start, so
//     this is where it belongs. Three properties make it safe on a path
//     that may be replayed from an outbox hours later:
//
//     - It only ever fills a claim that is **empty**. `COALESCE` keeps
//       whatever is already there, so a late-arriving start from a device
//       that lost the race cannot take the session from the device that
//       won. Adjudicating a live claim is `workouts.claim`'s job, on the
//       live call the client is actually waiting on.
//     - It rides the existing `WHERE status = 'scheduled'` predicate, so a
//       replay writes nothing here either — decision (b) covers both
//       columns for free.
//     - Both expressions read the OLD row (one `SET`, one snapshot), so
//       `claimed_at` moves exactly when `active_device_id` did.
//
//     **It cannot fail the start.** There is no claim check in front of
//     this UPDATE and no branch where a claim refuses one: an offline start
//     is never blocked by a claim check (task 08's named risk), and a start
//     replayed from the outbox has a client who stopped waiting for the
//     answer long ago.
//
// (f) **The program snapshot is frozen by the same statement**
//     (`./program-snapshot.ts`, DB§14.6, added by `session-runtime/09`).
//     Start is the ONLY place it may be written: a session scheduled on
//     Monday and started on Thursday has to pick up Tuesday's edit, so
//     freezing at materialisation would make a coach's edits useless for
//     every session generated in advance.
//
//     It needs the row's `program_day_id`, which the UPDATE does not have
//     to hand, so there is one indexed read in front of it. That read is
//     NOT the decision — the `WHERE status = 'scheduled'` predicate still
//     is. If the row moved between the two, the predicate matches nothing,
//     the snapshot is discarded with the rest of the SET, and the
//     already-started row is returned unchanged; decision (b)'s idempotency
//     covers this column for free, exactly as it does the claim's. The
//     block read is skipped entirely on that path, so a replay costs one
//     lookup rather than two.
//

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
  /**
   * `ctx.deviceId` — the `did` claim, never the wire (`./claim.ts` rule
   * (c)). `null` leaves the claim columns untouched: a token with no device
   * identity is not a reason to refuse a client the session in front of
   * them.
   */
  deviceId: string | null = null,
): Promise<StartedSessionSummary> {
  const owned = and(
    eq(schema.workoutSessions.id, input.workoutSessionId),
    eq(schema.workoutSessions.clientId, clientProfileId),
    isNull(schema.workoutSessions.deletedAt),
  );

  // Decision (f). Read before the write because the snapshot's content is
  // addressed by a column the UPDATE cannot see; built only for a row that
  // still looks startable, so a replay pays one lookup and no block scan.
  const [before] = await db
    .select({
      status: schema.workoutSessions.status,
      programDayId: schema.workoutSessions.programDayId,
    })
    .from(schema.workoutSessions)
    .where(owned)
    .limit(1);

  const snapshot =
    before?.status === 'scheduled' ? await buildProgramSnapshot(db, before.programDayId) : null;

  // Decisions (b) and (c), as a predicate rather than a `CASE` in the `SET`:
  // `status` and `started_at` move together or not at all, and the statement
  // that decides is the one that writes, so two concurrent replays serialise
  // on the row lock and only the first matches.
  const [updated] = await db
    .update(schema.workoutSessions)
    .set({
      status: 'in_progress',
      startedAt: input.startedAt,
      // Decision (f). Omitted rather than written as null for an ad-hoc
      // session or a day with no id — there is no prescription to protect,
      // and a null written here would be indistinguishable from one this
      // statement deliberately left alone.
      ...(snapshot === null ? {} : { programSnapshot: snapshot }),
      // Decision (e). `claimed_at` is the last heartbeat (`./claim.ts` rule
      // (b)), and a start is the first one.
      //
      // The instant is bound as an ISO string with an explicit cast, not as
      // a `Date`: a raw `sql` fragment carries no column type mapper, so
      // postgres.js is handed a value it cannot serialise and the statement
      // fails at Bind. Drizzle applies the mapper only to the plain-object
      // form used for `status`/`started_at` above.
      ...(deviceId === null
        ? {}
        : {
            activeDeviceId: sql`COALESCE(${schema.workoutSessions.activeDeviceId}, ${deviceId})`,
            claimedAt: sql`CASE WHEN ${schema.workoutSessions.activeDeviceId} IS NULL THEN ${input.startedAt.toISOString()}::timestamptz ELSE ${schema.workoutSessions.claimedAt} END`,
          }),
    })
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
