import { schema, type DbClient, type WorkoutSession } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';

// `workouts.updateNotes` — the server half of
// `phase-09-workout-logger/session-summary/03`. The two subjective fields a
// client attaches to a finished session, and the last thing written about
// it before the coach reads it.
//
// Five decisions, in the order they matter:
//
// (a) **This is an UPDATE of two columns and nothing else.** It does not
//     touch `status`, either instant, `duration_seconds` or
//     `total_volume_kg` — those are `./complete.ts`'s, computed from rows
//     this procedure cannot see. A notes update that also re-derived the
//     session would be a second, disagreeing definition of a completed
//     workout.
//
// (b) **The session is named by its `client_local_id`** — `./complete.ts`
//     decision (b), verbatim and for its reason. An ad-hoc session started
//     and finished offline has no `workout_sessions.id` the device could
//     send, and the note written about it in the same basement has to
//     travel on the same key.
//
//     Keying on it costs nothing in safety, which is why this procedure
//     carries no `ownsResource`: the predicate pins `client_id` to
//     `ctx.user.clientProfileId`, so the statement cannot reach another
//     client's row even when the caller invents a key
//     (`../../routers/workouts.ts` states this at the call site, and
//     `workouts.updateNotes.test.ts` proves it against two clients who
//     share a coach).
//
// (c) **The device wins, and the server words nothing.** `client_notes` and
//     `perceived_exertion` are the client's own account of their own
//     session (DB§14.3's device-wins side), so this writes exactly what it
//     is handed. In particular the skip lines
//     `session-modifications/03` recorded are composed INTO the string on
//     the device by `composeSessionNotes`, not appended here: the one place
//     that can see every skip of a session is the device that took them,
//     and a server-side append would be a second author of one column.
//
// (d) **No status predicate.** The capture is chained behind the completion
//     in the outbox, but a session whose local row carried no
//     `complete_outbox_id` queues the update unchained
//     (`useUpdateSessionNotes` rule (d)), so it can legitimately arrive
//     first — and a client may also reopen a summary and edit a note days
//     later. Refusing either would strand a note over an ordering detail the
//     client has nothing to do with, and neither column participates in the
//     `session_completion` CHECK.
//
// (e) **Idempotency is the values', not a key's.** There is no transition
//     to guard and no row to insert: a replay writes the same two values a
//     second time and answers identically. That is why `clientLocalId` is
//     only the outbox's de-duplication key here and is never read.

/**
 * What the device is told about the session it annotated. Mapped field by
 * field and never returned wholesale, the same rule `CompletedSessionSummary`
 * states: a column added to `workout_sessions` tomorrow must not silently
 * start crossing the wire.
 */
export interface SessionNotesSummary extends Pick<
  WorkoutSession,
  'id' | 'clientLocalId' | 'perceivedExertion' | 'clientNotes'
> {
  /** The mutation's own key, echoed so a caller can match a replayed response to its entry. */
  mutationClientLocalId: string;
}

export type UpdateSessionNotesInput = z.infer<typeof workoutsSchemas.updateSessionNotesInput>;

export async function updateSessionNotes(
  db: DbClient,
  clientProfileId: string,
  input: UpdateSessionNotesInput,
): Promise<SessionNotesSummary> {
  // Decision (b). `client_id` is from `ctx.user`, never the wire.
  const owned = and(
    eq(schema.workoutSessions.clientId, clientProfileId),
    eq(schema.workoutSessions.clientLocalId, input.sessionClientLocalId),
    isNull(schema.workoutSessions.deletedAt),
  );

  const [updated] = await db
    .update(schema.workoutSessions)
    .set({
      // Decisions (a) and (c): two columns, both taken verbatim, both
      // written even when null so a field the client CLEARED is cleared
      // rather than left standing.
      perceivedExertion: input.perceivedExertion,
      clientNotes: input.clientNotes,
    })
    .where(owned)
    .returning();

  if (!updated) {
    // A row that does not exist, belongs to someone else, or was purged
    // between the flush and here. One answer for all three — anything finer
    // is an existence oracle (`ERRORS.md` ER§2.1).
    throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
  }

  return {
    id: updated.id,
    clientLocalId: updated.clientLocalId,
    mutationClientLocalId: input.clientLocalId,
    perceivedExertion: updated.perceivedExertion,
    clientNotes: updated.clientNotes,
  };
}
