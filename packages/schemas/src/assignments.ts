// Input schemas for `assignments.*` — the live-reference bridge between an
// authored program and a client's actual training
// (`apps/api/src/features/programs/versioning.md`'s resolution:
// `assignments.program_id` points at the program directly, never a
// snapshot). `assignment/01` fills `create`, `pause`, `complete`.
//
// `assignableClients` takes `paginationInput` straight from this package's
// barrel, exactly as `programs.listTemplates` does (`api-conventions` §6) —
// it has no input shape of its own to declare here.
import type { z } from 'zod';

import { calendarDate, id, strictObject } from './primitives.ts';

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
