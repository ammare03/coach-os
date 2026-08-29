// `account-lifecycle/12` — the three delegated export paths from that
// task's own "Why this exists" table, minus the nomination path (record-
// only, honoured by `docs/runbooks/nomination-claim.md`, never automated).
// The rule every function here obeys: no destination parameter, ever — the
// email a completed export reaches is always resolved from already-
// verified server-side state, never from caller input.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import type { Context } from '../../trpc/context.ts';

import { requestExport, type RequestExportResult } from './request.ts';

/**
 * True only when `guardianUserId` is a real, email-verified account whose
 * own email matches the confirmed `guardian_email` on `dependentUserId`'s
 * row — `isMinor` and `guardian_consent_at` both still true, the row not
 * soft-deleted. Shared by the request path below (at request time) and
 * `../../routers/me.ts`'s `exportStatus`/`exportDownloadUrl`/`exportHistory`
 * (at read time) so a guardian who requested an export can also poll,
 * download, and see it in history through the same screens self-service
 * already uses — no second download surface exists to keep in sync with
 * this one (`security-and-privacy` skill §4's ≤1h signed-URL ceiling rules
 * out ever emailing a working link directly, the same reasoning
 * `../../jobs/send-export-ready-email.ts`'s doc comment already states for
 * the self-service case).
 *
 * Re-evaluated fresh on every call, never cached — this is exactly the
 * check that must return `false` the instant `is_minor` clears at 18
 * (`account-lifecycle/12`'s own AC).
 */
export async function isConfirmedGuardianOf(
  db: DbClient,
  guardianUserId: string,
  dependentUserId: string,
): Promise<boolean> {
  const [guardian] = await db
    .select({ email: schema.users.email, emailVerifiedAt: schema.users.emailVerifiedAt })
    .from(schema.users)
    .where(eq(schema.users.id, guardianUserId));
  if (!guardian?.emailVerifiedAt) return false;

  const [dependent] = await db
    .select({
      role: schema.users.role,
      isMinor: schema.users.isMinor,
      guardianEmail: schema.users.guardianEmail,
      guardianConsentAt: schema.users.guardianConsentAt,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, dependentUserId));

  return (
    dependent !== undefined &&
    dependent.deletedAt === null &&
    dependent.role === 'client' &&
    dependent.isMinor &&
    dependent.guardianConsentAt !== null &&
    dependent.guardianEmail !== null &&
    dependent.guardianEmail.toLowerCase() === guardian.email.toLowerCase()
  );
}

/**
 * `me.requestExportForDependent`. `dependentUserId` is the subject
 * `requestExport` rate-limits and dedupes against — a guardian with two
 * minors gets two independent daily allowances, one per subject (Approach
 * step 5), for free, because each is a separate call with a separate
 * subject id.
 *
 * `EXPORT_NOT_FOUND` — never `FORBIDDEN` — for every ineligible case: not a
 * client, not a minor, no consent yet, wrong email, or aged out past 18.
 * Collapsing all of them into one code is deliberate
 * (`security-and-privacy` skill §1's enumeration-oracle rule): a guardian
 * probing ids must not learn *which* condition failed, or whether the id
 * even names a real account.
 */
export async function requestExportForDependent(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  dependentUserId: string,
): Promise<RequestExportResult> {
  const guardianId = ctx.user?.id;
  if (!guardianId) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  const [dependent, eligible] = await Promise.all([
    db
      .select({ guardianEmail: schema.users.guardianEmail })
      .from(schema.users)
      .where(eq(schema.users.id, dependentUserId))
      .then((rows) => rows[0]),
    isConfirmedGuardianOf(db, guardianId, dependentUserId),
  ]);
  if (!eligible || !dependent?.guardianEmail) {
    throw appError('DEPENDENT_NOT_FOUND', "We couldn't find that account.", {});
  }

  return requestExport(db, ctx, dependentUserId, {
    relationship: 'guardian',
    destinationEmail: dependent.guardianEmail,
  });
}

export interface OperatorExportRequest {
  reason: string;
  ticketReference: string;
}

/**
 * `support.triggerUserExport`'s underlying logic — the router procedure
 * itself carries the `operatorProcedure` gate and the pre-body audit write
 * (`../../routers/support.ts`); this function only re-confirms the subject
 * is a real, non-deleted account before handing off to the same
 * `requestExport` self-service reuses. Delivery is never widened here: an
 * operator-triggered row's `requested_by_user_id` is the operator, and
 * `send-export-ready-email.ts` only ever treats a `requested_by_user_id` as
 * a delivery target when it independently re-verifies a guardian match —
 * which an operator's own email never satisfies (Approach step 2, "the
 * operator never receives the archive").
 */
export async function requestExportForSubject(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  subjectUserId: string,
  info: OperatorExportRequest,
): Promise<RequestExportResult> {
  const [subject] = await db
    .select({ email: schema.users.email, deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, subjectUserId));
  if (!subject || subject.deletedAt !== null) {
    throw appError('DEPENDENT_NOT_FOUND', "We couldn't find that account.", {});
  }

  return requestExport(db, ctx, subjectUserId, {
    relationship: 'operator',
    reason: info.reason,
    ticketReference: info.ticketReference,
    destinationEmail: subject.email,
  });
}
