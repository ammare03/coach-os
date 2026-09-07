import {
  schema,
  type Assignment,
  type ClientProfile,
  type DbClient,
  type Program,
} from '@coachos/db';
import type { PaginationInput } from '@coachos/schemas';
import { toLocalDate } from '@coachos/utils';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';

import { computeAssignmentWeekProgress } from './advance-assignment.ts';

// `assignments.assignableClients` (`assignment/01`) — the picker's list.
//
// **Not `coach.clients.list`.** That procedure is a deliberate stub owned
// by `phase-06-onboarding` (`../../routers/coach.ts`) — this exists as its
// own query rather than waiting on or repurposing it, because the picker
// needs a shape `coach.clients.list` doesn't (each client's *current active
// assignment*, joined, so the sheet can render "No active program" / "On
// {program}" without a second round trip per row —
// `code-conventions` §7's "no query inside a loop").
//
// `coachProcedure`, no `ownsResource`: the only row this reads is the
// caller's own client roster, scoped by `ctx.user.coachProfileId` — a
// `coachId` in the input would be the enumeration hole §6.2 exists to
// close, the same reasoning `programs.listTemplates` gives for its own
// absent filter arguments.
//
// **Which statuses "can hold an assignment"** (§15.5's client-status
// vocabulary): `active` and `paused` — a client with a real, ongoing
// coaching relationship. `invited` is excluded: a client who hasn't
// accepted yet has never opened the app and has nothing to materialise a
// session into (`assignment/03`). `archived` is excluded by name in the
// task doc. This reading isn't settled with Ammar; flagged in the PR.
//
// `assignment/05`: `currentWeek` below is recomputed for DISPLAY via
// `computeAssignmentWeekProgress` (`./advance-assignment.ts`), not read
// raw off the stored column — this is a multi-row list, so it cannot call
// `syncAssignmentProgress`'s per-row write-back without a query-per-row
// loop (`code-conventions` §7). The number shown is always correct; the
// STORED column for a row nobody has individually opened may lag until
// `assignments.get` or `assignments.create`'s conflict check next touches
// it — see that module's header comment for the full reasoning. An
// assignment whose final week has already passed still displays here
// (capped at `durationWeeks`) until one of those paths flips its `status`
// to `'completed'`, at which point this LEFT JOIN's `status = 'active'`
// condition stops matching it and the client shows "No active program"
// automatically, with nothing to reconcile on this file's part.

export const ASSIGNABLE_CLIENT_STATUSES = [
  'active',
  'paused',
] as const satisfies readonly ClientProfile['status'][];

// `Pick<…> & { … }`, not a plain object literal — `programName` is a
// renamed join column (`programs.name`), not a database row shape this
// package could import whole, but `id`/`currentWeek` and `durationWeeks`
// are, and are derived rather than redeclared (`local/no-hand-written-row-type`).
export type AssignableClientActiveAssignment = Pick<Assignment, 'id' | 'currentWeek'> &
  Pick<Program, 'durationWeeks'> & { programName: string };

export type AssignableClient = Pick<ClientProfile, 'id' | 'status'> & {
  /** `users.name`, not a `client_profiles` column — joined in, not redeclared. */
  name: string;
  /** `null` when the client holds no active assignment — the picker's "No active program" row. */
  activeAssignment: AssignableClientActiveAssignment | null;
};

export interface AssignableClientsResult {
  items: AssignableClient[];
  nextCursor: string | null;
}

export async function listAssignableClients(
  db: DbClient,
  coachProfileId: string,
  input: PaginationInput,
): Promise<AssignableClientsResult> {
  const filters = [
    eq(schema.clientProfiles.coachId, coachProfileId),
    isNull(schema.clientProfiles.deletedAt),
    inArray(schema.clientProfiles.status, ASSIGNABLE_CLIENT_STATUSES),
  ];
  if (input.cursor !== undefined) {
    filters.push(lt(schema.clientProfiles.createdAt, new Date(input.cursor)));
  }

  // One statement, not one per row: the client's active assignment (at
  // most one, guaranteed by `assignments_one_active`) and that
  // assignment's program are both LEFT JOINed in, so a client with none of
  // either still returns exactly one row with null assignment columns.
  const page = await db
    .select({
      id: schema.clientProfiles.id,
      name: schema.users.name,
      status: schema.clientProfiles.status,
      createdAt: schema.clientProfiles.createdAt,
      timezone: schema.users.timezone,
      assignmentId: schema.assignments.id,
      assignmentStartDate: schema.assignments.startDate,
      currentWeek: schema.assignments.currentWeek,
      programName: schema.programs.name,
      durationWeeks: schema.programs.durationWeeks,
    })
    .from(schema.clientProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
    .leftJoin(
      schema.assignments,
      and(
        eq(schema.assignments.clientId, schema.clientProfiles.id),
        eq(schema.assignments.status, 'active'),
      ),
    )
    .leftJoin(schema.programs, eq(schema.programs.id, schema.assignments.programId))
    .where(and(...filters))
    .orderBy(desc(schema.clientProfiles.createdAt))
    .limit(input.limit + 1);

  const hasMore = page.length > input.limit;
  const pageItems = hasMore ? page.slice(0, input.limit) : page;
  const nextCursor = hasMore
    ? (pageItems[pageItems.length - 1]?.createdAt.toISOString() ?? null)
    : null;

  const items: AssignableClient[] = pageItems.map((row) => {
    if (
      row.assignmentId === null ||
      row.assignmentStartDate === null ||
      row.currentWeek === null ||
      row.programName === null ||
      row.durationWeeks === null
    ) {
      return { id: row.id, name: row.name, status: row.status, activeAssignment: null };
    }

    // Display-only recomputation — see this file's header comment above.
    const today = toLocalDate(new Date(), row.timezone);
    const { currentWeek } = computeAssignmentWeekProgress(
      row.assignmentStartDate,
      today,
      row.durationWeeks,
    );

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      activeAssignment: {
        id: row.assignmentId,
        currentWeek,
        programName: row.programName,
        durationWeeks: row.durationWeeks,
      },
    };
  });

  return { items, nextCursor };
}
