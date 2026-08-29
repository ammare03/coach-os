// `account-lifecycle/03` — builds the deep link and https fallback and
// sends through the shared `sendEmail` wrapper, never the `resend` package
// directly. Kept separate from `request-deletion.ts` so that file's
// transaction and this one's I/O stay visually distinct, matching
// `../invites/create-invite.ts`'s own split from `send-invite-email.ts`.
import { env } from '../../env.ts';
import { sendEmail } from '../../lib/email/client.ts';
import { DeletionRecoveryEmail } from '../../lib/email/templates/deletion-recovery.ts';

function formatPurgeDate(date: Date, timeZone: string): string {
  // `Intl.DateTimeFormat`, not `date-fns` — that package lives only in
  // `packages/utils` today (`code-conventions` §1: no new dependency for
  // one call site), and the runtime's own formatter is already this
  // codebase's pattern for timezone-aware work (`packages/schemas/src/
  // primitives.ts`'s `isSupportedTimeZone`).
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone }).format(date);
}

export async function sendDeletionRecoveryEmail(
  email: string,
  timezone: string,
  scheduledPurgeAt: Date,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Your CoachOS account is scheduled for deletion',
    react: DeletionRecoveryEmail({
      scheduledPurgeDate: formatPurgeDate(scheduledPurgeAt, timezone),
      // The mobile settings route this deep-links into is built by a later
      // phase (`phase-05-app-shell`) — this only ever renders the two URLs
      // it's given, same as `invite.ts`'s own doc comment.
      deepLinkUrl: 'coachos://settings',
      httpsFallbackUrl: `${env.APP_PUBLIC_URL}/account`,
    }),
  });
}
