// Input schemas for `assignments.*` — the live-reference bridge between an
// authored program and a client's actual training
// (`apps/api/src/features/programs/versioning.md`'s resolution:
// `assignments.program_id` points at the program directly, never a
// snapshot). `assignment/01` fills `create`, `pause`, `complete`.
//
// `assignableClients` takes `paginationInput` straight from this package's
// barrel, exactly as `programs.listTemplates` does (`api-conventions` §6) —
// it has no input shape of its own to declare here.
//
// `assignment/05` adds `getAssignmentInput` — `assignments.get`'s shape,
// the one procedure this task adds to read a single assignment's
// lazily-corrected `current_week`/`status` (`apps/api/src/features/assignments/advance-assignment.ts`).
//
// `assignment/02` adds `bulkCreateAssignmentInput` — one program, one start
// date, many clients (`CLAUDE.md` §1's "change Tuesday's session for 12
// clients without opening 12 chats"). `clientIds` is capped at
// `MAX_ID_ARRAY`, the same array cap `../authorization-middleware/
// 03-owns-resource.md` step 5 sized for a Studio coach's 75 seats
// (`./limits.ts`'s own doc comment) — bulk assignment past that size is a
// background job, not a synchronous request.
import { z } from 'zod';

import { calendarDate, id, MAX_ID_ARRAY, strictObject } from './primitives.ts';

export const createAssignmentInput = strictObject({
  programId: id,
  clientId: id,
  /** Client-local calendar day, never a timestamp (`code-conventions` §6). */
  startDate: calendarDate,
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentInput>;

export const pauseAssignmentInput = strictObject({
  assignmentId: id,
});
export type PauseAssignmentInput = z.infer<typeof pauseAssignmentInput>;

export const completeAssignmentInput = strictObject({
  assignmentId: id,
});
export type CompleteAssignmentInput = z.infer<typeof completeAssignmentInput>;

export const getAssignmentInput = strictObject({
  assignmentId: id,
});
export type GetAssignmentInput = z.infer<typeof getAssignmentInput>;

export const bulkCreateAssignmentInput = strictObject({
  programId: id,
  /** At least one client, never more than `MAX_ID_ARRAY` in one call. */
  clientIds: z.array(id).min(1).max(MAX_ID_ARRAY),
  /** The same start date for every client in the batch — no per-client override (task's own Scope). */
  startDate: calendarDate,
});
export type BulkCreateAssignmentInput = z.infer<typeof bulkCreateAssignmentInput>;
