import { schema, type DbClient } from '@coachos/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

// `programs.days.midSessionClients` — who is inside this program day right
// now (`session-runtime/09` Approach step 5).
//
// This is the half of the program-snapshot rule that is easy to skip and
// matters most. The client's side is visible to the client; the coach's
// side is invisible to everyone, including us. A coach who believes they
// just fixed a client's working weight, and did not, makes a worse decision
// than one who knows — and nothing in the product would ever tell them.
//
// Three decisions:
//
// (a) **A query, not a field on the seven mutations that can change a day.**
//     `exercises.create/update/delete/reorder/setSupersetGroup/
//     setAlternatives` and `days.update` all rewrite a prescription, and
//     four of them return void by design. Threading a warning through every
//     return type would couple seven contracts to one advisory, and the
//     editor already refetches this day after each write
//     (`useProgramDayBuilder`'s `invalidate`), so the answer arrives on a
//     request that was being made anyway.
//
//     ⚠️ The cost is a millisecond-wide race, and it is recorded rather
//     than hidden: a client who STARTS between the save committing and this
//     query running is named by a warning that is not true of them — their
//     session froze against the edited day, so the change did reach them.
//     The opposite error, the one that matters, cannot happen: a client who
//     was mid-session when the write landed is still mid-session a
//     millisecond later, because sessions last an hour. Closing it entirely
//     means reading inside each write's transaction, which is decision (a)'s
//     seven contracts.
//
// (b) **Scoped by `coach_id`, not only by the `ownsResource('programDay')`
//     guard in front of it.** Owning the program proves the coach may read
//     the DAY; it does not prove they may be told a given person's NAME.
//     A client who left this coach (`account-lifecycle/06` nulls
//     `workout_sessions.coach_id`) may still be inside a session generated
//     from this day, and that person's name is no longer the coach's to
//     see. The predicate is what makes the read unable to return them, not
//     a filter applied afterwards.
//
// (c) **It names people, so it returns names and nothing else.** No
//     `session_id`, no `scheduled_date`, no progress. The coach needs to
//     know who and how many; anything further is a client's training data
//     reached through a program editor, which is not a door this procedure
//     should open (`security-and-privacy`, DB§18).

/**
 * The ceiling on how many rows this is willing to name. Well past any real
 * simultaneity — a coach's whole book is 75 clients on Studio, and they do
 * not all train the same day at the same minute — and it stops an Agency
 * template day from turning an advisory into an unbounded read.
 */
const MAX_NAMED = 50;

export interface MidSessionClient {
  clientId: string;
  /** `users.name`. The coach's own client, named to their own coach only. */
  name: string;
  startedAt: Date;
}

/**
 * Clients with an `in_progress` session generated from this program day,
 * oldest start first.
 *
 * Empty is the overwhelmingly common answer, and the editor renders nothing
 * for it — this is a warning, not a status line.
 */
export async function findMidSessionClients(
  db: DbClient,
  coachProfileId: string,
  programDayId: string,
): Promise<MidSessionClient[]> {
  const rows = await db
    .select({
      clientId: schema.workoutSessions.clientId,
      name: schema.users.name,
      startedAt: schema.workoutSessions.startedAt,
    })
    .from(schema.workoutSessions)
    .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.workoutSessions.clientId))
    .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
    .where(
      and(
        eq(schema.workoutSessions.programDayId, programDayId),
        // Decision (b). From `ctx.user`, never the wire.
        eq(schema.workoutSessions.coachId, coachProfileId),
        eq(schema.workoutSessions.status, 'in_progress'),
        isNull(schema.workoutSessions.deletedAt),
      ),
    )
    .orderBy(asc(schema.workoutSessions.startedAt), asc(schema.workoutSessions.clientId))
    .limit(MAX_NAMED);

  return rows.flatMap((row) =>
    // `started_at` is NOT NULL in practice for an `in_progress` row — the
    // two move together in one statement (`workouts/start.ts`) — but the
    // column is nullable, and a row that somehow lost it is not one to
    // report a start time for.
    row.startedAt === null ? [] : [{ ...row, startedAt: row.startedAt }],
  );
}
