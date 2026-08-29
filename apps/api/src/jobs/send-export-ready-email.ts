// `account-lifecycle/09` — split from `data-export.ts` for the same reason
// `send-coach-deletion-notice-email.ts` splits from `coach-deletion-flow.ts`:
// the build-and-upload and the send stay visually distinct, and a slow
// provider here never holds up the job's own status update.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { sendEmail } from '../lib/email/client.ts';
import { ExportReadyEmail } from '../lib/email/templates/export-ready.ts';
import { GuardianExportNoticeEmail } from '../lib/email/templates/guardian-export-notice.ts';

/**
 * Sends to the subject's own verified email — never a delivery address the
 * job data could specify (Approach step 8, `security-and-privacy` skill
 * §6's "no delegated export accepts a delivery address") — **unless** the
 * subject is currently a minor with a confirmed guardian and this exact
 * export was requested by that same guardian, in which case delivery goes
 * to the guardian's own verified email instead (`account-lifecycle/12`
 * Approach step 1: "the archive is delivered to that guardian email").
 *
 * The guardian match is re-verified here, independently, at send time —
 * never trusted from whatever was true when the export was *requested*. A
 * guardian relationship revoked or aged out between request and completion
 * must not still receive the archive; re-deriving from current `users` state
 * is what guarantees that without a stored, possibly-stale destination
 * column on `export_requests` itself.
 *
 * An operator-triggered export never matches this: the operator's own email
 * is never the subject's `guardian_email`, so delivery falls through to the
 * subject's own address by construction — this is the entire mechanism that
 * keeps "the operator never receives the archive" (`account-lifecycle/12`)
 * true without a separate code path.
 */
export async function sendExportReadyEmail(
  db: DbClient,
  request: Pick<typeof schema.exportRequests.$inferSelect, 'userId' | 'requestedByUserId'>,
): Promise<void> {
  const [subject] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
      isMinor: schema.users.isMinor,
      guardianEmail: schema.users.guardianEmail,
      guardianConsentAt: schema.users.guardianConsentAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, request.userId));
  if (!subject) {
    // The job just read this same user's row moments earlier — not
    // reachable in practice. Refuse loudly rather than silently skipping
    // the one notification a completed export exists to trigger.
    throw new Error(`sendExportReadyEmail: users ${request.userId} not found`);
  }

  let deliverTo = subject.email;
  let guardianDelivery = false;

  if (
    subject.isMinor &&
    subject.guardianEmail &&
    subject.guardianConsentAt &&
    request.requestedByUserId &&
    request.requestedByUserId !== request.userId
  ) {
    const [requester] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, request.requestedByUserId));
    if (requester && requester.email.toLowerCase() === subject.guardianEmail.toLowerCase()) {
      deliverTo = subject.guardianEmail;
      guardianDelivery = true;
    }
  }

  await sendEmail({
    to: deliverTo,
    subject: 'Your CoachOS data export is ready',
    react: ExportReadyEmail({ name: subject.name }),
  });

  if (guardianDelivery) {
    // Approach step 1's "the minor is told" — the email half. The in-app
    // half is deferred: no notifications table or surface exists yet
    // (`docs/UNFORGET.md`).
    await sendEmail({
      to: subject.email,
      subject: 'Your parent or guardian requested a copy of your CoachOS data',
      react: GuardianExportNoticeEmail({ name: subject.name }),
    });
  }
}
