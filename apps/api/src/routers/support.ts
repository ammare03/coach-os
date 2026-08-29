// `account-lifecycle/12` — SUPPORT.md SU§3's "Trigger a user's own data
// export" safe operation. The one procedure in this router today; the rest
// of the admin surface (`SUPPORT.md` SU§2's `apps/web` route group) is
// `phase-26-trust-and-safety/support-tooling/`, unbuilt — this is the data
// surface that UI will call.
import { schema } from '@coachos/db';
import { support as supportSchemas } from '@coachos/schemas';

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
});
