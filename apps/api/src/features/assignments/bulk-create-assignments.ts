import type { DbClient } from '@coachos/db';
import type { AppErrorPayloads } from '@coachos/schemas';

import { isCatalogedError } from '../../lib/app-error.ts';

import { createAssignment, type CreateAssignmentInput } from './create-assignment.ts';

// Same reasoning as `create-assignment.ts`'s own `ConflictPayload` alias:
// `AppErrorCause`'s `details` is typed off its generic `Code`, which
// `isCatalogedError`'s type guard leaves at the full `AppErrorCode` union —
// checking `appCode === 'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT'` narrows
// `appCode`'s literal type but not `details`'s, since the two are
// independent properties of one interface rather than a discriminated
// union. The assertion below is exactly as safe as that file's: this
// branch is only reached once `appCode` has been confirmed to equal this
// one code, and `appError()` is the only place that pairs a code with a
// payload, always matched by construction.
type ConflictPayload = AppErrorPayloads['CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT'];

// `assignments.bulkCreate` (`assignment/02`) — the coach persona's own job
// (`CLAUDE.md` §1: "change Tuesday's session for 12 clients without opening
// 12 chats"), built as a per-client loop over `assignment/01`'s
// `createAssignment`, never as one all-or-nothing transaction. That
// distinction is the entire point of this task (its own Risks section):
// wrapping the whole batch in one transaction would mean ONE client who
// already has an active assignment blocks the other eleven from ever
// being written — exactly the failure bulk assignment exists to avoid.
// `createAssignment` already commits its own insert-plus-materialisation
// atomically per client (that file's own header comment), so looping here
// with no enclosing transaction is what makes each client's outcome
// independent of every other's.

export interface BulkCreateAssignmentsInput {
  programId: string;
  /** Ownership of every one of these is checked before this function ever runs (`../../routers/assignments.ts`). */
  clientIds: readonly string[];
  coachId: string;
  /** The same client-local calendar day for every client in the batch. */
  startDate: string;
}

export interface BulkCreateSucceededItem {
  clientId: string;
  assignmentId: string;
}

/** The same payload `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT` carries in the single-client path, plus which client it's about. */
export interface BulkCreateConflictedItem {
  clientId: string;
  assignmentId: string;
  programName: string;
  currentWeek: number;
  durationWeeks: number;
}

export interface BulkCreateAssignmentsResult {
  succeeded: BulkCreateSucceededItem[];
  conflicted: BulkCreateConflictedItem[];
}

/**
 * Loops `createAssignment` once per client id, in the order given.
 *
 * **A `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT` refusal is recorded as a
 * conflict and the loop continues** — this is the "one client shouldn't
 * block the other eleven" behaviour the task exists to build.
 *
 * **Any other error is rethrown immediately, aborting the rest of the
 * batch.** This is deliberate, not an oversight: a conflict is a normal,
 * expected outcome the UI already has a designed resolution for (Pause /
 * Complete); anything else — a database outage, a materialisation bug, a
 * constraint this function doesn't recognise — is a real defect, and
 * folding it into `conflicted` would render in the outcome view exactly
 * like an ordinary "already has a program" case, hiding a bug behind a UI
 * that reads as business-as-usual (this task's own instruction). Every
 * client already processed before the failure keeps its outcome: each
 * `createAssignment` call committed in its OWN transaction, so an
 * unexpected error on client 6 of 12 does not undo clients 1 through 5 —
 * the coach sees a failed request and can retry the remainder once
 * whatever broke is fixed, rather than the batch silently reporting a
 * false conflict for clients 6 through 12.
 */
export async function bulkCreateAssignments(
  db: DbClient,
  input: BulkCreateAssignmentsInput,
): Promise<BulkCreateAssignmentsResult> {
  const succeeded: BulkCreateSucceededItem[] = [];
  const conflicted: BulkCreateConflictedItem[] = [];

  for (const clientId of input.clientIds) {
    const clientInput: CreateAssignmentInput = {
      programId: input.programId,
      clientId,
      coachId: input.coachId,
      startDate: input.startDate,
    };

    try {
      const result = await createAssignment(db, clientInput);
      succeeded.push({ clientId, assignmentId: result.id });
    } catch (error) {
      if (
        isCatalogedError(error) &&
        error.cause.appCode === 'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT'
      ) {
        const details = error.cause.details as ConflictPayload;
        conflicted.push({
          clientId,
          assignmentId: details.assignmentId,
          programName: details.programName,
          currentWeek: details.currentWeek,
          durationWeeks: details.durationWeeks,
        });
        continue;
      }
      // Not a conflict — see this function's own doc comment above.
      throw error;
    }
  }

  return { succeeded, conflicted };
}
