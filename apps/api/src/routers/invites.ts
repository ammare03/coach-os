import { invites as invitesSchemas } from '@coachos/schemas';

import { acceptInvite } from '../features/invites/accept-invite.ts';
import { createInvite } from '../features/invites/create-invite.ts';
import { router } from '../trpc/init.ts';
import { authProcedure, coachProcedure } from '../trpc/procedures.ts';

export const invitesRouter = router({
  // `01` — seat-checked, collision-retried code generation (`03`), and
  // (`02`) a fire-and-forget email send after the row commits.
  create: coachProcedure
    .input(invitesSchemas.createInviteInput)
    .mutation(({ ctx, input }) => createInvite(ctx.db, ctx, ctx.user.coachProfileId, input)),

  // `04` — `authProcedure`, not `protectedProcedure`: this is where a
  // client's account is created (`CLAUDE.md` §8.1, no separate client
  // sign-up exists), so there is no caller identity yet — same reasoning as
  // `auth.signUp` (`../__tests__/authz-allowlist.ts`'s entry for this path).
  // Runs under the shared `auth.*` per-IP throttle, same as `signUp`.
  accept: authProcedure.input(invitesSchemas.acceptInviteInput).mutation(({ ctx, input }) =>
    acceptInvite(ctx.db, ctx, {
      code: input.code,
      password: input.password,
      name: input.name,
      timezone: input.timezone,
      dateOfBirth: input.dateOfBirth,
      guardianEmail: input.guardianEmail,
      device: {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
      },
    }),
  ),
});
