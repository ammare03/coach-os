import { schema, type DbClient, type WorkoutSession } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { upsertWorkoutSession } from '../../lib/workout-session-upsert.ts';

// `workouts.startAdHoc` — the server half of
// `phase-09-workout-logger/today-card/04`. A client with no program, on a
// rest day, or with today's session already finished taps one button and is
// in the logger; this is the row that lands behind them once the outbox
// reaches the network.
//
// Four decisions, in the order they matter:
//
// (a) **Both `assignment_id` and `program_day_id` stay null.** DB§5.2's own
//     comment says the columns are nullable precisely so an ad-hoc session
//     can exist. They are written explicitly rather than omitted so a
//     replay's `DO UPDATE` restates them — a row that somehow acquired an
//     assignment is not silently left with one.
//
// (b) **The client comes from `ctx.user`, never the wire.** The input takes
//     no `clientId`, so there is no caller-supplied identifier
//     `ownsResource` could guard and none it needs to
//     (`api-conventions` §3, the same shape as `upcoming`).
//
// (c) **Idempotency is `../../lib/workout-session-upsert.ts`, not a hand-
//     written statement.** The outbox replays a mutation until the server
//     answers, so a retry that inserted a second row would give a client two
//     workouts for one tap (`CLAUDE.md` §25.12). `INSERT ... ON CONFLICT
//     (client_id, client_local_id) DO UPDATE` makes the tenth attempt return
//     the row the first one created.
//
// (d) **The row is born `in_progress`, not `scheduled`.** There is no second
//     "Start" step anywhere in the ad-hoc flow — frame `H` hands the client
//     straight to the logger — so a `scheduled` row would describe a
//     workout the client is already inside.
//     `session-runtime/01`'s `workouts.start` owns the scheduled→in_progress
//     transition for *assigned* sessions and never sees this one.

/**
 * What the device is told about the row it created. Mapped field by field
 * from the row and never returned wholesale, so a column added to
 * `workout_sessions` tomorrow does not silently start crossing the wire.
 *
 * The four columns are `Pick`ed from Drizzle's inferred row rather than
 * restated — `id` is a uuid, `scheduledDate` a calendar date, `status` the
 * `session_status` enum, and hand-writing any of them is how the two drift
 * (`code-conventions` §3).
 */
export interface AdHocSessionSummary extends Pick<
  WorkoutSession,
  'id' | 'scheduledDate' | 'status' | 'startedAt'
> {
  /**
   * Echoed back so a caller can match the response to the mutation it
   * replayed. Non-null here, unlike the column: it is half the conflict
   * target, so a row this procedure created always has one.
   */
  clientLocalId: string;
}

export type StartAdHocSessionInput = z.infer<typeof workoutsSchemas.startAdHocSessionInput>;

export async function startAdHocSession(
  db: DbClient,
  clientProfileId: string,
  input: StartAdHocSessionInput,
): Promise<AdHocSessionSummary> {
  // DB§6's denormalised ownership column, read from the client's own row
  // and set on INSERT only — `workout_sessions_no_owner_change` (migration
  // 0022) rejects an UPDATE that moves it, and `deviceWinsSet` never writes
  // it on a replay.
  const [client] = await db
    .select({ coachId: schema.clientProfiles.coachId })
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.id, clientProfileId))
    .limit(1);
  if (!client) {
    throw new Error(`startAdHocSession: no identity.client_profiles row for "${clientProfileId}"`);
  }

  const session = await upsertWorkoutSession(db, {
    clientId: clientProfileId,
    coachId: client.coachId,
    // Decision (a). A coachless client (`account-lifecycle/06`) simply
    // carries a null here, exactly as their assigned sessions do.
    assignmentId: null,
    programDayId: null,
    scheduledDate: input.scheduledDate,
    status: 'in_progress',
    startedAt: input.startedAt,
    clientLocalId: input.clientLocalId,
    // The moment of the local change, which for a session that is created
    // and started in one action is the same instant as `started_at`.
    updatedAt: input.startedAt,
  });

  return {
    id: session.id,
    clientLocalId: input.clientLocalId,
    scheduledDate: session.scheduledDate,
    status: session.status,
    startedAt: session.startedAt,
  };
}
