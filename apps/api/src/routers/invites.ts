import { invites as invitesSchemas } from '@coachos/schemas';

import { acceptInviteAsExistingClient } from '../features/invites/accept-invite-as-existing-client.ts';
import { acceptInvite } from '../features/invites/accept-invite.ts';
import { confirmGuardianConsent } from '../features/invites/confirm-guardian-consent.ts';
import { createInvite } from '../features/invites/create-invite.ts';
import { listPendingInvites } from '../features/invites/list-pending-invites.ts';
import { previewInvite } from '../features/invites/preview-invite.ts';
import { revokeInvite } from '../features/invites/revoke-invite.ts';
import { router } from '../trpc/init.ts';
import {
  authProcedure,
  clientProcedure,
  coachProcedure,
  ownsResource,
  publicProcedure,
  rateLimit,
  RATE_LIMIT_TIERS,
} from '../trpc/procedures.ts';

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

  // `07` — the returning-client path: `clientProcedure`, not
  // `authProcedure` above. The caller is already signed in as themselves
  // (`accept-invite-as-existing-client.ts`'s own doc comment on why that's
  // the identity proof here, not a fresh password), so this needs no
  // `ownsResource` — `ctx.user.clientProfileId` is the only client id ever
  // touched, never one from `input`.
  acceptAsExistingClient: clientProcedure
    .input(invitesSchemas.acceptInviteAsExistingClientInput)
    .mutation(({ ctx, input }) => acceptInviteAsExistingClient(ctx.db, ctx, input)),

  // `client-onboarding/01` — the read the returning-client acceptance
  // screen needs before it can ask anything. A `clientProcedure` and an
  // email check, for the reason `preview-invite.ts` states; no
  // `ownsResource`, because the only ids involved are the caller's own and
  // the invite's, and the invite is addressed by the code the caller holds.
  preview: clientProcedure
    .input(invitesSchemas.previewInviteInput)
    .query(({ ctx, input }) => previewInvite(ctx.db, ctx, input.code)),

  // `05` — `ownsResource` guards the id (`security-and-privacy` skill §1:
  // every procedure taking an id resolving to a coach's own resource passes
  // through it), chained after `.input()` per the required order
  // (`../trpc/middleware/owns-resource.ts`'s own doc comment).
  revoke: coachProcedure
    .input(invitesSchemas.revokeInviteInput)
    .use(ownsResource('invite', (i: { inviteId: string }) => i.inviteId))
    .mutation(async ({ ctx, input }) => {
      await revokeInvite(ctx.db, ctx, input.inviteId);
      return { success: true } as const;
    }),

  listPending: coachProcedure.query(({ ctx }) =>
    listPendingInvites(ctx.db, ctx.user.coachProfileId),
  ),

  // `guardian-consent/02` — `publicProcedure`, not `authProcedure`: the
  // caller is a parent with no CoachOS account, following a link from an
  // email, and the single-use token is the entire proof of authority
  // (`../__tests__/authz-allowlist.ts`'s entry for this path). It gets its
  // own tier rather than the shared `auth.*` per-IP bucket, which is scoped
  // to sign-in-shaped attempts and which this would pollute.
  //
  // Returns an outcome instead of throwing for a replayed or dead link —
  // `05`'s public page needs three values to switch on, not a transport
  // error to interpret.
  confirmGuardianConsent: publicProcedure
    .use(rateLimit(RATE_LIMIT_TIERS.guardianConsentConfirm))
    .input(invitesSchemas.confirmGuardianConsentInput)
    .mutation(({ ctx, input }) => confirmGuardianConsent(ctx.db, ctx, input.token)),
});
