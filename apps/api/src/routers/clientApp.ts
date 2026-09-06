import { client as clientSchemas } from '@coachos/schemas';

import { getMyCoach } from '../features/clientApp/get-my-coach.ts';
import { updateClientProfile } from '../features/clientApp/update-profile.ts';
import {
  detachClient,
  notifyRelationshipEnded,
  updateHistorySharing,
} from '../services/coach-client-transition.ts';
import { router } from '../trpc/init.ts';
import { clientProcedure } from '../trpc/procedures.ts';

// `dashboard`/`today` (phase-06-onboarding) are still empty. `coach` is
// filled by `client-onboarding/01` — the invite route cannot tell a client
// who already has a coach from one who has left theirs without it.
// `leaveCoach` (`account-lifecycle/06`) lands ahead of that phase — same
// shape as `coach.ts`'s `clients.list` stub note: real name, real path,
// filled here rather than waiting on the phase that owns the rest of this
// router.
export const clientAppRouter = router({
  // `client-onboarding/01` — null for a coachless client, which is a real
  // state and not an error (`account-lifecycle/06`). No `ownsResource`:
  // the profile is addressed by `ctx.user`, never by caller input.
  coach: clientProcedure.query(({ ctx }) => {
    if (ctx.user.clientProfileId === null) {
      throw new Error('clientApp.coach: authenticated client has no clientProfileId');
    }
    return getMyCoach(ctx.db, ctx.user.clientProfileId);
  }),

  // No input — a client can only ever leave their own coach; `ctx.user`
  // supplies `clientProfileId`, never a caller-provided id
  // (`api-conventions` §2: no `ownsResource` needed, same reasoning as
  // `me.get`).
  leaveCoach: clientProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.clientProfileId === null) {
      throw new Error('leaveCoach: authenticated client has no clientProfileId');
    }
    const result = await detachClient(ctx.db, ctx, {
      clientProfileId: ctx.user.clientProfileId,
      initiatedBy: 'client',
    });
    void notifyRelationshipEnded(result).catch(() => {});
    return { success: true } as const;
  }),

  // `client-onboarding/05` — the client onboarding flow's single write,
  // sent once with everything steps 02–04 accumulated. The allowlist is in
  // `updateProfileInput`; this procedure never accepts a wider shape than
  // that schema admits. No `ownsResource` for the same reason as
  // `leaveCoach` — the row is addressed by `ctx.user.clientProfileId`.
  updateProfile: clientProcedure
    .input(clientSchemas.updateProfileInput)
    .mutation(({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('clientApp.updateProfile: authenticated client has no clientProfileId');
      }
      return updateClientProfile(ctx.db, ctx.user.clientProfileId, input);
    }),

  // `07` — "Settings → what {coach} can see". No `ownsResource` needed for
  // the same reason as `leaveCoach` above.
  updateHistorySharing: clientProcedure
    .input(clientSchemas.updateHistorySharingInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('updateHistorySharing: authenticated client has no clientProfileId');
      }
      await updateHistorySharing(ctx.db, ctx, {
        clientProfileId: ctx.user.clientProfileId,
        ...input,
      });
      return { success: true } as const;
    }),
});
