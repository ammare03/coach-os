// `account-lifecycle/10` — the export builder's front door: dedupe, rate
// limit, enqueue. `09` built the expensive job this guards; this file is
// what keeps a $0/month budget (`CLAUDE.md` §3.4.2) from being amplified by
// a double-tap or a retry loop.
import { schema, type DbClient } from '@coachos/db';
import { and, desc, eq, sql } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import { enqueueDataExport } from '../../queues/enqueue.ts';
import type { Context } from '../../trpc/context.ts';

/**
 * One completed export per 24 hours (Approach step 2). The arithmetic that
 * keeps this above DPDP/GDPR's 30-day floor (Approach step 3): a user
 * requesting once a month clears a 24h-since-last-COMPLETION gate on every
 * single attempt, because 30 days is thirty multiples of this window, not a
 * fraction of it. `request.test.ts` asserts this directly rather than
 * trusting the arithmetic by eye — tighten this constant only after
 * re-reading that test, never independently of it.
 */
export const COMPLETION_RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

export interface RequestExportResult {
  exportId: string;
  status: typeof schema.exportRequests.$inferSelect.status;
}

/**
 * `account-lifecycle/12` — carried only by the guardian/operator call sites
 * in `./delegated.ts`; the self-service `me.requestExport` never passes
 * this. `destinationEmail` is resolved by the caller from already-verified,
 * server-side state (the confirmed `guardian_email`, or the subject's own
 * email) — never from caller input, per that task's "no destination
 * parameter" rule. Recorded to `audit_log` below, never used to route mail
 * itself (`../../jobs/send-export-ready-email.ts` re-derives the same
 * destination independently at send time).
 */
export interface DelegationInfo {
  relationship: 'guardian' | 'operator';
  reason?: string;
  ticketReference?: string;
  destinationEmail: string;
}

/**
 * `me.requestExport`. Deliberately has no `clientId`/subject parameter
 * beyond `userId` — this is the self-service path only; a guardian or
 * operator request (`account-lifecycle/12`) is a different function that
 * still lands on this same table, never a wider version of this one.
 *
 * No suspension check here, and none should be added without a product
 * decision to override it — `phase-26-trust-and-safety` (unbuilt) is where
 * a suspension gate will eventually live, and this procedure is meant to
 * stay off its allowlist permanently (Approach step 4: "suspension limits
 * participation, never a user's rights over their own data").
 */
export async function requestExport(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  delegation?: DelegationInfo,
): Promise<RequestExportResult> {
  return db.transaction(async (tx) => {
    // Serialises concurrent calls for the SAME user for the lifetime of
    // this transaction — auto-released on commit/rollback, no cleanup
    // needed. `export_requests_active` (DATABASE.md DB§5.5.2) is a plain
    // index, not a UNIQUE one, so without this lock two requests arriving
    // within the same millisecond could both read "nothing active" and
    // both insert — exactly the "assert one job" verification step this
    // task calls for. A Postgres advisory lock, not a Redis one: Redis is
    // deliberately fail-open in this codebase (`../../lib/redis-safe.ts`),
    // the wrong property for a correctness-critical dedupe rather than a
    // best-effort cache.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const [active] = await tx
      .select()
      .from(schema.exportRequests)
      .where(
        and(
          eq(schema.exportRequests.userId, userId),
          sql`${schema.exportRequests.status} IN ('queued', 'building')`,
        ),
      )
      .orderBy(desc(schema.exportRequests.createdAt))
      .limit(1);
    if (active) {
      throw appError('EXPORT_ALREADY_RUNNING', "We're already putting your export together.", {
        exportId: active.id,
        status: active.status,
      });
    }

    // The limit is on COMPLETIONS, not requests (Approach step 2) — a
    // failed build never appears here, so it never consumes the day's
    // allowance.
    const [lastReady] = await tx
      .select({ completedAt: schema.exportRequests.completedAt })
      .from(schema.exportRequests)
      .where(
        and(eq(schema.exportRequests.userId, userId), eq(schema.exportRequests.status, 'ready')),
      )
      .orderBy(desc(schema.exportRequests.completedAt))
      .limit(1);
    if (lastReady?.completedAt) {
      const elapsedMs = Date.now() - lastReady.completedAt.getTime();
      if (elapsedMs < COMPLETION_RATE_LIMIT_MS) {
        const retryAfterSeconds = Math.ceil((COMPLETION_RATE_LIMIT_MS - elapsedMs) / 1000);
        throw appError('EXPORT_RATE_LIMITED', 'You can request one export per day.', {
          retryAfterSeconds,
        });
      }
    }

    const [row] = await tx
      .insert(schema.exportRequests)
      .values({ userId, requestedByUserId: ctx.user?.id ?? userId, status: 'queued' })
      .returning();
    if (!row) throw new Error('requestExport: export_requests insert returned no row');

    // Requester and subject (Approach step 8) — identical here (self-
    // service); `account-lifecycle/12`'s guardian/operator paths are what
    // make the two differ, and this is the same audit action they reuse —
    // `delegation` is what makes this record carry the relationship,
    // reason, and destination that task's own AC requires on top of the
    // requester/subject pair `writeAuditLog` already captures from `ctx`/
    // `targetId`.
    await writeAuditLog(tx, ctx, {
      action: 'account.export_requested',
      targetType: 'user',
      targetId: userId,
      metadata: {
        exportId: row.id,
        ...(delegation
          ? {
              relationship: delegation.relationship,
              reason: delegation.reason,
              ticketReference: delegation.ticketReference,
              destination: delegation.destinationEmail,
            }
          : {}),
      },
    });

    // Deliberately inside the transaction, after the insert it depends on
    // but before commit — `enqueueDataExport`'s `export.{exportId}` jobId
    // (`../../queues/enqueue.ts`) already makes a duplicate enqueue a
    // no-op, so there's no correctness reason to delay this past commit,
    // and every other write in this function already happens inside `tx`.
    await enqueueDataExport({ exportId: row.id });

    // ANALYTICS DEFERRED: Approach step 7 calls for an `export_requested`
    // event carrying `role` only. `apps/api/src/lib/analytics.ts` (the
    // typed server emitter `ANALYTICS.md` §AN1 specifies) does not exist
    // in this codebase yet — no phase has built the typed event registry
    // (`packages/schemas/src/analytics/events.ts`) this call would import
    // from. Emitting through an untyped escape hatch would violate AN§1's
    // own "there is no `track(name, props)` escape hatch" rule more than
    // skipping the event does. Wire this in once that infrastructure
    // lands — tracked in `docs/UNFORGET.md`.

    return { exportId: row.id, status: row.status };
  });
}
