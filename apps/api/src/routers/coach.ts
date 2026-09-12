import { coach as coachSchemas } from '@coachos/schemas';

import { getClientOverview } from '../features/coach/client-overview.ts';
import { getCoachDashboard } from '../features/coach/dashboard.ts';
import { updateCoachProfile } from '../features/coach/update-profile.ts';
import { detachClient, notifyRelationshipEnded } from '../services/coach-client-transition.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource } from '../trpc/procedures.ts';

// `notes` (phase-06-onboarding) is still empty. `clients.list` is a stub, not
// a placeholder: it exists solely so `04-router-registry.md`'s and
// `../authorization-middleware/04`'s
// reflective walks have a real two-level path (`coach.clients.list`) to
// reach. **phase-10-coach-review-surfaces** replaces it with the real
// procedure — same name, same path, real implementation. `clients.release`
// (`account-lifecycle/06`) lands ahead of that phase, same as `client.ts`'s
// `leaveCoach`.
export const coachRouter = router({
  // `phase-10-coach-review-surfaces/adherence-engine/02` — §8.2's three
  // counters plus the client list. No input and no `ownsResource`: the
  // whole result is resolved from `ctx.user.coachProfileId`, so there is no
  // id crossing the wire to guard, and nothing another coach owns is
  // reachable through it.
  dashboard: coachProcedure.query(({ ctx }) => getCoachDashboard(ctx.db, ctx.user.coachProfileId)),

  // `phase-06-onboarding/coach-onboarding/02` — onboarding step 2's write.
  // `coachProcedure`, and no `ownsResource`: the row is addressed by
  // `ctx.user.coachProfileId` alone and no id crosses the wire, the same
  // reasoning `me.update` states.
  updateProfile: coachProcedure
    .input(coachSchemas.updateProfileInput)
    .mutation(({ ctx, input }) => updateCoachProfile(ctx.db, ctx.user.coachProfileId, input)),

  clients: router({
    // `coachProcedure`, not `protectedProcedure`: the real procedure resolves
    // against `ctx.user.coachProfileId`, so a client's session must never
    // reach it. The stub returns `[]` either way — but the builder is what
    // P10 inherits, and a no-input procedure is the one shape the enumeration
    // test cannot probe (pre-phase-09 audit, Q2/S3).
    list: coachProcedure.query(() => []),

    // `phase-10-coach-review-surfaces/client-detail/01` — §8.3's Overview
    // tab in ONE call, not five. `coach.clients.overview` rather than a new
    // top-level `client.*` router: this file's own header says P10 is what
    // fills `coach.clients` in, and the caller is a coach reading one of
    // their own clients, which is exactly what `coach.clients` means.
    // (`client.*` in `api-conventions` §1 is the CLIENT app's router —
    // `clientApp.ts` here — and putting a coach-only read there would put
    // the two roles' procedures in one namespace.)
    //
    // `ownsResource('client', …)` is the whole security story: the resolver
    // below re-checks nothing, and everything it reads is addressed by the
    // client id this middleware has already proven the caller owns.
    overview: coachProcedure
      .input(coachSchemas.clientOverviewInput)
      .use(ownsResource('client', (i: { clientId: string }) => i.clientId))
      .query(({ ctx, input }) =>
        getClientOverview(ctx.db, ctx.user.coachProfileId, input.clientId),
      ),

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
