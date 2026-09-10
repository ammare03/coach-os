import { workouts as workoutsSchemas } from '@coachos/schemas';

import { startAdHocSession } from '../features/workouts/start-ad-hoc.ts';
import { startSession } from '../features/workouts/start.ts';
import { listUpcomingWorkouts } from '../features/workouts/upcoming.ts';
import { router } from '../trpc/init.ts';
import { clientProcedure, ownsResource } from '../trpc/procedures.ts';

// Filled by phase-09-workout-logger, apart from `upcoming` — which
// `phase-08-offline-core/prefetch/01` needs and P08 precedes P09, so it
// lands here first (`../features/workouts/upcoming.ts`). P09's
// `today-card/02` extends that read rather than adding a second one.
export const workoutsRouter = router({
  // No `ownsResource`: the range is the only caller-supplied input and the
  // client is read from `ctx.user`, never from the wire — the same shape
  // as `clientApp.coach` (`api-conventions` §3). A client can therefore
  // only ever query their own sessions.
  upcoming: clientProcedure.input(workoutsSchemas.upcomingWorkoutsInput).query(({ ctx, input }) => {
    if (ctx.user.clientProfileId === null) {
      throw new Error('workouts.upcoming: authenticated client has no clientProfileId');
    }
    return listUpcomingWorkouts(ctx.db, ctx.user.clientProfileId, {
      from: input.from,
      to: input.to,
    });
  }),

  // Same shape, same reason: no `ownsResource`, because the only ids in the
  // input are the client's own idempotency key and a calendar date. The row
  // is created for `ctx.user.clientProfileId` and nothing else
  // (`../features/workouts/start-ad-hoc.ts` decision (b)).
  startAdHoc: clientProcedure
    .input(workoutsSchemas.startAdHocSessionInput)
    .mutation(({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('workouts.startAdHoc: authenticated client has no clientProfileId');
      }
      return startAdHocSession(ctx.db, ctx.user.clientProfileId, input);
    }),

  // Unlike the two above, this one DOES name a row the caller could point
  // elsewhere — `workoutSessionId` is a real server id — so it carries
  // `ownsResource` (`api-conventions` §3). Chained after `.input()`, or the
  // selector receives `unknown` and rejects everything.
  start: clientProcedure
    .input(workoutsSchemas.startSessionInput)
    .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
    .mutation(({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('workouts.start: authenticated client has no clientProfileId');
      }
      return startSession(ctx.db, ctx.user.clientProfileId, input);
    }),
});
