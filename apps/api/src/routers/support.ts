// `account-lifecycle/12` — SUPPORT.md SU§3's "Trigger a user's own data
// export" safe operation. The one procedure in this router today; the rest
// of the admin surface (`SUPPORT.md` SU§2's `apps/web` route group) is
// `phase-26-trust-and-safety/support-tooling/`, unbuilt — this is the data
// surface that UI will call.
import { schema } from '@coachos/db';
import { support as supportSchemas } from '@coachos/schemas';

import { clearSessionClaim } from '../features/workouts/claim.ts';
import { appError } from '../lib/app-error.ts';
import { requestExportForSubject } from '../services/export/delegated.ts';
import { router } from '../trpc/init.ts';
import { operatorProcedure } from '../trpc/procedures.ts';

export const supportRouter = router({
  // Audited **before** the body runs (this task's own AC) — an operator's
  // attempt is on record even if `requestExportForSubject` itself throws
  // (unknown subject, already running, rate limited). A direct insert, not
  // `writeAuditLog`: that helper takes an open transaction
  // (`../lib/audit-log.ts`), and this write is deliberately unconditional,
  // outside and ahead of whatever transaction the body opens next
  // (`../jobs/data-export.ts`'s own precedent for writing `audit_log`
  // outside a helper when the call site's own shape calls for it).
  triggerUserExport: operatorProcedure
    .input(supportSchemas.triggerUserExportInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(schema.auditLog).values({
        actorUserId: ctx.user.id,
        action: 'account.export_triggered_by_operator',
        targetType: 'user',
        targetId: input.subjectUserId,
        ip: ctx.request.ip,
        userAgent: ctx.request.userAgent,
        metadata: { reason: input.reason, ticketReference: input.ticketReference },
      });

      return requestExportForSubject(ctx.db, ctx, input.subjectUserId, {
        reason: input.reason,
        ticketReference: input.ticketReference,
      });
    }),

  // `SUPPORT.md` SU§3's lost-phone release, and DB§14.5's third way out of a
  // claim alongside the six-hour ceiling and the fifteen-minute heartbeat
  // rule (`phase-09-workout-logger/session-runtime/08`).
  //
  // Two properties make this a safe operation rather than a read surface:
  //
  // - It **clears two columns and reads nothing else.** No set, no
  //   prescription, no name crosses this procedure. The operator learns only
  //   whether a claim was there (`../features/workouts/claim.ts`).
  // - It is **audited before the body runs**, matching `triggerUserExport`
  //   above: the attempt is on record even when there was no claim to clear.
  //
  // No `ownsResource`: an operator is not a coach and owns nothing. The
  // enumeration test's allowlist is where that exemption is stated, per
  // SU§2's rule for every `operatorProcedure`.
  clearSessionClaim: operatorProcedure
    .input(supportSchemas.clearSessionClaimInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(schema.auditLog).values({
        actorUserId: ctx.user.id,
        action: 'workout_session.claim_cleared_by_operator',
        targetType: 'workout_session',
        targetId: input.workoutSessionId,
        ip: ctx.request.ip,
        userAgent: ctx.request.userAgent,
        metadata: { reason: input.reason, ticketReference: input.ticketReference },
      });

      const result = await clearSessionClaim(ctx.db, input.workoutSessionId);
      if (!result.found) {
        throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
      }

      return { cleared: result.cleared };
    }),
});
