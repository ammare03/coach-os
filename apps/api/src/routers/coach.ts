import { coach as coachSchemas } from '@coachos/schemas';

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
