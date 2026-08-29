// `invites/02` — builds the two invite URLs and sends through the shared
// `sendEmail` wrapper (`../../lib/email/client.ts`), never the `resend`
// package directly. Kept separate from `create-invite.ts` so that file's
// transaction and this one's I/O stay visually distinct, matching
// `../auth/password-reset.ts`'s own split between the request-path
// function and its `sendResetEmail` helper.
import type { Invite } from '@coachos/db';

import { env } from '../../env.ts';
import { sendEmail } from '../../lib/email/client.ts';
import { InviteEmail } from '../../lib/email/templates/invite.ts';

export async function sendInviteEmail(invite: Invite, coachName: string): Promise<void> {
  await sendEmail({
    to: invite.email,
    subject: `${coachName} invited you to CoachOS`,
    react: InviteEmail({
      coachName,
      deepLinkUrl: `coachos://invite/${invite.code}`,
      httpsFallbackUrl: `${env.APP_PUBLIC_URL}/invite/${invite.code}`,
    }),
  });
}
