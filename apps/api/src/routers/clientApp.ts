import { client as clientSchemas } from '@coachos/schemas';

import {
  detachClient,
  notifyRelationshipEnded,
  updateHistorySharing,
} from '../services/coach-client-transition.ts';
import { router } from '../trpc/init.ts';
import { clientProcedure } from '../trpc/procedures.ts';

// `dashboard`/`today`/`coach` (phase-06-onboarding) are still empty.
// `leaveCoach` (`account-lifecycle/06`) lands ahead of that phase — same
// shape as `coach.ts`'s `clients.list` stub note: real name, real path,
// filled here rather than waiting on the phase that owns the rest of this
// router.
export const clientAppRouter = router({
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
