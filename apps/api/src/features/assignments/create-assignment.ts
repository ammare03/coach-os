import { schema, type Assignment, type DbClient } from '@coachos/db';
import type { AppErrorPayloads } from '@coachos/schemas';
import { and, eq } from 'drizzle-orm';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { appError } from '../../lib/app-error.ts';
import { materialiseSessions } from '../../lib/materialise-sessions.ts';

// `assignments.create` (`assignment/01`, extended by `assignment/03`) — the
// first write to `training.assignments`, and the write that turns a
// program's day/week structure into real `workout_sessions` rows
// (`../../lib/materialise-sessions.ts`). Live-reference, not snapshot
// (`../programs/versioning.md`): `program_id` points at the template
// directly, so nothing here forks a copy. Ownership is
// `ownsResource('program', …)` AND `ownsResource('client', …)` in the
// router — both, chained after `.input()`, never inlined here (`CLAUDE.md`
// §6.2).
//
// `db.transaction` now wraps BOTH the assignment insert AND materialisation
// — `assignment/03`'s own requirement that "all sessions for one
// assignment materialise in a single transaction," extended here one step
// further so the assignment row itself and its sessions commit or roll
// back together: an assignment that exists with zero materialised sessions
// (because the assignment insert committed but materialisation then
// failed) is exactly the kind of partial state a transaction exists to
// rule out, so a plain sequential "insert, then separately materialise" was
// rejected in favour of this.
//
// This does not reopen the race-handling problem the original single-row
// design was written to avoid: a Postgres transaction that hits a unique
// violation refuses every further statement until it rolls back, but
// `db.transaction`'s own rollback-on-throw already leaves the connection
// pool clean by the time the `catch` below runs — the race-case re-query
// uses the outer `db` handle (never `tx`), which was never part of the
// failed transaction and is unaffected by it.

const ONE_ACTIVE_CONSTRAINT = 'assignments_one_active';

export interface CreateAssignmentInput {
  programId: string;
  clientId: string;
  coachId: string;
  /** Client-local calendar day (`packages/schemas` `calendarDate`). */
  startDate: string;
}

export type CreatedAssignment = Pick<Assignment, 'id'>;

type ConflictPayload = AppErrorPayloads['CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT'];

/** The client's current active assignment, joined with its program's name and length — everything the conflict card needs, or `null` if there isn't one. */
async function activeAssignmentConflict(
  db: DbClient,
  clientId: string,
): Promise<ConflictPayload | null> {
  const [row] = await db
    .select({
      assignmentId: schema.assignments.id,
      currentWeek: schema.assignments.currentWeek,
      programName: schema.programs.name,
      durationWeeks: schema.programs.durationWeeks,
    })
    .from(schema.assignments)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.assignments.programId))
    .where(and(eq(schema.assignments.clientId, clientId), eq(schema.assignments.status, 'active')))
    .limit(1);
  if (!row) return null;
  return {
    assignmentId: row.assignmentId,
    programName: row.programName,
    currentWeek: row.currentWeek,
    durationWeeks: row.durationWeeks,
  };
}

function conflictError(payload: ConflictPayload) {
  return appError(
    'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT',
    'This client already has an active program. Pause or complete it first.',
    payload,
  );
}

export async function createAssignment(
  db: DbClient,
  input: CreateAssignmentInput,
): Promise<CreatedAssignment> {
  // The good error: named in the payload, checked before the write is even
  // attempted — mirrors `createProgramWeek`'s own precedent
  // (`../programs/create-program-week.ts`).
  const conflict = await activeAssignmentConflict(db, input.clientId);
  if (conflict) throw conflictError(conflict);

  try {
    return await db.transaction(async (tx) => {
      const [assignment] = await tx
        .insert(schema.assignments)
        .values({
          programId: input.programId,
          clientId: input.clientId,
          coachId: input.coachId,
          startDate: input.startDate,
        })
        .returning({ id: schema.assignments.id });
      if (!assignment) throw new Error('insert into training.assignments did not return a row');

      await materialiseSessions(tx, assignment.id);

      return { id: assignment.id };
    });
  } catch (error) {
    // The guarantee: a second request that raced the pre-check above and
    // won still cannot leave two active assignments — `assignments_one_active`
    // refuses the insert, and this is what turns that raw violation back
    // into the same catalogued, richly-payloaded error rather than a bare
    // `UNKNOWN_CONFLICT` (`api-conventions` §5, mirroring
    // `../invites/accept-invite.ts`'s catch shape).
    const dbError = unwrapDatabaseError(error);
    if (dbError?.code === '23505' && dbError.constraint_name === ONE_ACTIVE_CONSTRAINT) {
      const raceConflict = await activeAssignmentConflict(db, input.clientId);
      if (raceConflict) throw conflictError(raceConflict);
      // Structurally shouldn't happen — the violation just fired, so a row
      // must exist — but degrade to the generic catalogued fallback rather
      // than assume it.
      throw appError('UNKNOWN_CONFLICT', 'That change conflicts with something already saved.', {});
    }
    throw error;
  }
}
