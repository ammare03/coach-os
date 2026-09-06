import { coach as coachSchemas } from '@coachos/schemas';

import { updateCoachProfile } from '../features/coach/update-profile.ts';
import { detachClient, notifyRelationshipEnded } from '../services/coach-client-transition.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource, protectedProcedure } from '../trpc/procedures.ts';

// `dashboard` (phase-10-coach-review-surfaces) and `notes` (phase-06-onboarding)
// are still empty. `clients.list` is a stub, not a placeholder: it exists
// solely so `04-router-registry.md`'s and `../authorization-middleware/04`'s
// reflective walks have a real two-level path (`coach.clients.list`) to
// reach. phase-06-onboarding replaces it with the real procedure — same
// name, same path, real implementation. `clients.release` (`account-
// lifecycle/06`) lands ahead of that phase, same as `client.ts`'s
// `leaveCoach`.
export const coachRouter = router({
  // `phase-06-onboarding/coach-onboarding/02` — onboarding step 2's write.
  // `coachProcedure`, and no `ownsResource`: the row is addressed by
  // `ctx.user.coachProfileId` alone and no id crosses the wire, the same
  // reasoning `me.update` states.
  updateProfile: coachProcedure
    .input(coachSchemas.updateProfileInput)
    .mutation(({ ctx, input }) => updateCoachProfile(ctx.db, ctx.user.coachProfileId, input)),

  clients: router({
    list: protectedProcedure.query(() => []),

    release: coachProcedure
      .input(coachSchemas.releaseClientInput)
      .use(ownsResource('client', (i: { clientId: string }) => i.clientId))
      .mutation(async ({ ctx, input }) => {
        const result = await detachClient(ctx.db, ctx, {
          clientProfileId: input.clientId,
          initiatedBy: 'coach',
        });
        void notifyRelationshipEnded(result).catch(() => {});
        return { success: true } as const;
      }),
  }),
});
