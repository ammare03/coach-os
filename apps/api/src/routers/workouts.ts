import { workouts as workoutsSchemas } from '@coachos/schemas';

import { claimSession, heartbeatSession } from '../features/workouts/claim.ts';
import { completeSession } from '../features/workouts/complete.ts';
import { logSet } from '../features/workouts/log-set.ts';
import { startAdHocSession } from '../features/workouts/start-ad-hoc.ts';
import { startSession } from '../features/workouts/start.ts';
import { listUpcomingWorkouts } from '../features/workouts/upcoming.ts';
import { appError } from '../lib/app-error.ts';
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
      // `ctx.deviceId`, never `input` — DB§14.5's claim has to name an
      // identity the caller cannot choose (`../features/workouts/claim.ts`
      // rule (c)).
      return startSession(ctx.db, ctx.user.clientProfileId, input, ctx.deviceId);
    }),

  // The last transition in a session's lifecycle (`session-runtime/07`).
  //
  // No `ownsResource`, and that is the same reasoning `startAdHoc` above
  // carries rather than a weakening of it: the only ids in the input are the
  // client's own keys — the session's `client_local_id` and the mutation's —
  // and neither resolves to a row another client could own. The client is
  // `ctx.user.clientProfileId`, never the wire, and the UPDATE pins
  // `client_id` to it (`../features/workouts/complete.ts` decision (b)), so
  // the statement cannot reach across the boundary even in principle.
  // `sessionClientLocalId` is registered in `NON_RESOURCE_ID_FIELDS` with
  // that reason, so the enumeration test asserts the choice rather than
  // missing it.
  complete: clientProcedure
    .input(workoutsSchemas.completeSessionInput)
    .mutation(({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('workouts.complete: authenticated client has no clientProfileId');
      }
      return completeSession(ctx.db, ctx.user.clientProfileId, input);
    }),

  // One logged set (`set-entry/01`). The most frequently replayed mutation
  // in the product, and the only one in this router that is a real
  // `ON CONFLICT` upsert rather than a status transition — `set_logs.
  // client_local_id` is NOT NULL behind a plain unique index, so there is no
  // null-keyed row for the conflict target to miss
  // (`../features/workouts/log-set.ts` decision (a)).
  //
  // No `ownsResource`, and it is `complete` above's reasoning verbatim: the
  // session is named by its `client_local_id` because an ad-hoc session
  // started offline has no server id to name, the client is
  // `ctx.user.clientProfileId` rather than the wire, and the SELECT and the
  // INSERT are both pinned to it, so no caller-supplied id resolves to a row
  // another client could own. `sessionClientLocalId` and `exerciseId` are
  // both registered in `NON_RESOURCE_ID_FIELDS` with their reasons, so the
  // enumeration test asserts this choice rather than missing it.
  logSet: clientProcedure.input(workoutsSchemas.logSetInput).mutation(({ ctx, input }) => {
    if (ctx.user.clientProfileId === null) {
      throw new Error('workouts.logSet: authenticated client has no clientProfileId');
    }
    return logSet(ctx.db, ctx.user.clientProfileId, input);
  }),

  // DB§14.5 mechanism 3 (`session-runtime/08`). Called live, at the moment
  // the client taps Start and BEFORE the logger opens — never queued in the
  // outbox, because with no signal there is no claim check at all and an
  // offline start must never be blocked by one.
  //
  // The one procedure in this router that can refuse. `SESSION_CLAIMED_ELSEWHERE`
  // is a decision handed back to the person holding the phone, not a
  // failure: the client answers it with "Continue here", which re-calls
  // this with `transfer: true` (`ERRORS.md` ER§1.4). A **stale** claim
  // never reaches that branch — it transfers here, silently, with no sheet.
  claim: clientProcedure
    .input(workoutsSchemas.claimSessionInput)
    .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('workouts.claim: authenticated client has no clientProfileId');
      }

      const result = await claimSession(ctx.db, ctx.user.clientProfileId, {
        workoutSessionId: input.workoutSessionId,
        deviceId: ctx.deviceId,
        // The server's clock, never the caller's — the same rule as
        // `deviceId` and for the same reason. A live call needs no device
        // instant, and a device clock is the one input that can quietly
        // invert the staleness decision (`claimSessionInput`).
        at: new Date(),
        transfer: input.transfer,
      });

      if (result.status === 'not_found') {
        throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
      }

      // No device identity on this token, so there was nothing to write.
      // Reported as an outcome and never as an error — refusing here would
      // strand a client over a token shape they cannot see or fix
      // (`claim.ts` rule (a)).
      if (result.status === 'no_device') return { outcome: 'unclaimable' as const };

      if (result.outcome === 'held_elsewhere') {
        throw appError(
          'SESSION_CLAIMED_ELSEWHERE',
          "You're logging this session on another device. Continue here instead?",
          {},
        );
      }

      return { outcome: result.outcome };
    }),

  // The liveness touch the active device sends every few minutes while the
  // logger is open. Deliberately incapable of transferring: a heartbeat that
  // could would steal the session back, once per interval, from the device
  // the client had just moved to (`claimSessionInput`'s own note).
  //
  // It never throws for a claim reason. A device that has lost the claim
  // keeps logging — its sets are device-wins and merge by their own keys —
  // and is told so in the outcome rather than interrupted mid-set.
  heartbeat: clientProcedure
    .input(workoutsSchemas.heartbeatSessionInput)
    .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.clientProfileId === null) {
        throw new Error('workouts.heartbeat: authenticated client has no clientProfileId');
      }

      const result = await heartbeatSession(ctx.db, ctx.user.clientProfileId, {
        workoutSessionId: input.workoutSessionId,
        deviceId: ctx.deviceId,
        // Server clock — a heartbeat asserts liveness *now*, so the instant
        // is exactly the part a caller must not choose.
        at: new Date(),
      });

      if (result.status === 'not_found') {
        throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
      }
      if (result.status === 'no_device') return { outcome: 'unclaimable' as const };

      return { outcome: result.outcome };
    }),
});
