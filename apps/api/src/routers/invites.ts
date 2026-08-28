import { invites as invitesSchemas } from '@coachos/schemas';

import { createInvite } from '../features/invites/create-invite.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure } from '../trpc/procedures.ts';

export const invitesRouter = router({
  // `01` — seat-checked, collision-retried code generation (`03`), and
  // (`02`) a fire-and-forget email send after the row commits.
  create: coachProcedure
    .input(invitesSchemas.createInviteInput)
    .mutation(({ ctx, input }) => createInvite(ctx.db, ctx, ctx.user.coachProfileId, input)),
});
