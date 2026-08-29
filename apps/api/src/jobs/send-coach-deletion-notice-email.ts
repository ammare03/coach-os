// `account-lifecycle/05` — split from `coach-deletion-flow.ts` for the same
// reason `invites/create-invite.ts` splits from `send-invite-email.ts`:
// the write and the send stay visually distinct, and a slow provider here
// never holds up the sweep that drives the whole flow.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { sendEmail } from '../lib/email/client.ts';
import { CoachDeletionNoticeEmail } from '../lib/email/templates/coach-deletion-notice.ts';

export async function sendCoachDeletionNoticeEmail(
  db: DbClient,
  clientProfileId: string,
  coachName: string,
): Promise<void> {
  const [row] = await db
    .select({ email: schema.users.email })
    .from(schema.clientProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
    .where(eq(schema.clientProfiles.id, clientProfileId));
  if (!row) {
    // The caller just read this row in the same sweep pass — not reachable
    // in practice. Refuse loudly rather than silently skipping a notice.
    throw new Error(`sendCoachDeletionNoticeEmail: client_profiles ${clientProfileId} not found`);
  }

  await sendEmail({
    to: row.email,
    subject: `${coachName} is closing their CoachOS account`,
    react: CoachDeletionNoticeEmail({ coachName }),
  });
}
