import { schema, type Assignment, type DbClient, type Program } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { syncAssignmentProgress } from './advance-assignment.ts';

// `assignments.get` (`assignment/05`) — the one new read this task adds:
// a single assignment's lazily-corrected `current_week`/`status`/`completed_at`
// (`./advance-assignment.ts`'s `syncAssignmentProgress`, decision (a)).
// Guarded by `ownsResource('assignment', …)` in the router, which also
// guarantees the row exists before this resolver runs — a `null` from
// `syncAssignmentProgress` here would mean that guard was bypassed, so it
// throws loudly rather than degrading to a silent `null` response.

export type AssignmentDetail = Pick<
  Assignment,
  'id' | 'programId' | 'clientId' | 'startDate' | 'currentWeek' | 'status' | 'completedAt'
> &
  Pick<Program, 'durationWeeks'> & { programName: string };

export async function getAssignment(db: DbClient, assignmentId: string): Promise<AssignmentDetail> {
  const [row] = await db
    .select({
      id: schema.assignments.id,
      programId: schema.assignments.programId,
      clientId: schema.assignments.clientId,
      startDate: schema.assignments.startDate,
      programName: schema.programs.name,
      durationWeeks: schema.programs.durationWeeks,
    })
    .from(schema.assignments)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.assignments.programId))
    .where(eq(schema.assignments.id, assignmentId))
    .limit(1);
  if (!row) {
    throw new Error(`getAssignment: no training.assignments row for id "${assignmentId}"`);
  }

  const progress = await syncAssignmentProgress(db, assignmentId);
  if (!progress) {
    throw new Error(`getAssignment: syncAssignmentProgress found no row for id "${assignmentId}"`);
  }

  return {
    id: row.id,
    programId: row.programId,
    clientId: row.clientId,
    startDate: row.startDate,
    programName: row.programName,
    durationWeeks: row.durationWeeks,
    currentWeek: progress.currentWeek,
    status: progress.status,
    completedAt: progress.completedAt,
  };
}
