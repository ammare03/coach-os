import { assignments as assignmentsSchemas, paginationInput } from '@coachos/schemas';

import { listAssignableClients } from '../features/assignments/assignable-clients.ts';
import { bulkCreateAssignments } from '../features/assignments/bulk-create-assignments.ts';
import { completeAssignment } from '../features/assignments/complete-assignment.ts';
import { createAssignment } from '../features/assignments/create-assignment.ts';
import { getAssignment } from '../features/assignments/get-assignment.ts';
import { pauseAssignment } from '../features/assignments/pause-assignment.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource } from '../trpc/procedures.ts';

// `assignment/01` — the bridge between an authored program and a client's
// real, scheduled workout sessions (`../features/programs/versioning.md`'s
// live-reference decision governs this whole router: `program_id` points
// at the template directly, never a snapshot).
export const assignmentsRouter = router({
  // Guarded on BOTH the program and the client — a coach may assign only a
  // program they own to a client they own, and neither guard alone answers
  // the other (`CLAUDE.md` §6.2). Chained after `.input()`, never inlined
  // in the resolver below.
  create: coachProcedure
    .input(assignmentsSchemas.createAssignmentInput)
    .use(ownsResource('program', (i: { programId: string }) => i.programId))
    .use(ownsResource('client', (i: { clientId: string }) => i.clientId))
    .mutation(({ ctx, input }) =>
      createAssignment(ctx.db, {
        programId: input.programId,
        clientId: input.clientId,
        coachId: ctx.user.coachProfileId,
        startDate: input.startDate,
      }),
    ),

  // One of the two resolutions the assign sheet offers on
  // `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`. `assignment/05` owns automatic
  // completion and week advance; this stays minimal on purpose.
  pause: coachProcedure
    .input(assignmentsSchemas.pauseAssignmentInput)
    .use(ownsResource('assignment', (i: { assignmentId: string }) => i.assignmentId))
    .mutation(async ({ ctx, input }) => {
      await pauseAssignment(ctx.db, input.assignmentId);
    }),

  complete: coachProcedure
    .input(assignmentsSchemas.completeAssignmentInput)
    .use(ownsResource('assignment', (i: { assignmentId: string }) => i.assignmentId))
    .mutation(async ({ ctx, input }) => {
      await completeAssignment(ctx.db, input.assignmentId);
    }),

  // `assignment/05`'s read path: `current_week`/`status`/`completed_at`
  // are computed-on-read with a lazy write-back, never trusted stale off
  // the stored column (`../features/assignments/advance-assignment.ts`,
  // decision (a)) — this is the procedure that actually reads one.
  get: coachProcedure
    .input(assignmentsSchemas.getAssignmentInput)
    .use(ownsResource('assignment', (i: { assignmentId: string }) => i.assignmentId))
    .query(({ ctx, input }) => getAssignment(ctx.db, input.assignmentId)),

  // `assignment/02` — the bulk picker's commit (`CLAUDE.md` §1's "change
  // Tuesday's session for 12 clients without opening 12 chats"). Guarded on
  // the program AND on EVERY id in `clientIds`, not just the first — the
  // second `ownsResource` call's selector returns the whole array, and
  // `ownsResource` is already all-or-nothing over an array selector
  // (`../trpc/middleware/owns-resource.ts`, the same mechanism
  // `programs.reorder`/`programs.setSupersetGroup` use for
  // `orderedExerciseIds`/`exerciseIds`): a coach who owns 11 of 12 ids and
  // not the 12th is refused outright, never partially served, so a foreign
  // client id can never be slipped into a batch. `clientIds` itself is
  // bounded at `MAX_ID_ARRAY` in `packages/schemas` — the input schema is
  // the one place that bound lives.
  bulkCreate: coachProcedure
    .input(assignmentsSchemas.bulkCreateAssignmentInput)
    .use(ownsResource('program', (i: { programId: string }) => i.programId))
    .use(ownsResource('client', (i: { clientIds: string[] }) => i.clientIds))
    .mutation(({ ctx, input }) =>
      bulkCreateAssignments(ctx.db, {
        programId: input.programId,
        clientIds: input.clientIds,
        coachId: ctx.user.coachProfileId,
        startDate: input.startDate,
      }),
    ),

  // The assign sheet's client picker. `paginationInput` straight from the
  // barrel, the shape every list procedure takes (`programs.listTemplates`
  // does the same) — not re-exported through `assignmentsSchemas`, which
  // may import only zod and `./primitives.ts`
  // (`packages/schemas/src/__tests__/layout.test.ts`).
  //
  // `coachProcedure`, no `ownsResource`: the only row this reads is the
  // caller's own roster, scoped by `ctx.user.coachProfileId` — a `coachId`
  // in the input would be the enumeration hole §6.2 exists to close. Not
  // `coach.clients.list`: see `../features/assignments/assignable-clients.ts`'s
  // own comment for why this is a separate, deliberate query rather than a
  // reach into that still-stubbed procedure.
  assignableClients: coachProcedure
    .input(paginationInput)
    .query(({ ctx, input }) => listAssignableClients(ctx.db, ctx.user.coachProfileId, input)),
});
