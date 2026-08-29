// `account-lifecycle/09` — split from `data-export.ts` for the same reason
// `send-coach-deletion-notice-email.ts` splits from `coach-deletion-flow.ts`:
// the build-and-upload and the send stay visually distinct, and a slow
// provider here never holds up the job's own status update.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { sendEmail } from '../lib/email/client.ts';
import { ExportReadyEmail } from '../lib/email/templates/export-ready.ts';

/**
 * Sends to the subject's own verified email — never a delivery address the
 * job data could specify (Approach step 8, `security-and-privacy` skill
 * §6's "no delegated export accepts a delivery address"). `userId` here is
 * always `export_requests.user_id`, the data SUBJECT — never
 * `requested_by_user_id`, which may be a guardian or operator
 * (`account-lifecycle/12`) who is never the recipient.
 */
export async function sendExportReadyEmail(db: DbClient, userId: string): Promise<void> {
  const [user] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) {
    // The job just read this same user's row moments earlier — not
    // reachable in practice. Refuse loudly rather than silently skipping
    // the one notification a completed export exists to trigger.
    throw new Error(`sendExportReadyEmail: users ${userId} not found`);
  }

  await sendEmail({
    to: user.email,
    subject: 'Your CoachOS data export is ready',
    react: ExportReadyEmail({ name: user.name }),
  });
}
