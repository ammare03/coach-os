// `guardian-consent/01` — tells the coach their new client is under 18, at
// the one moment that becomes true (`auth-server/07` Approach step 5).
// Mirrors `./send-invite-email.ts`; carries no URL, because there is
// nothing for the coach to do.
//
// The argument list is `coachEmail` and `clientName` only: the birthdate,
// the age in years, and the guardian's address are never told to the coach
// (`CLAUDE.md` §21.5), and there is no parameter here that could carry one.
import { sendEmail } from '../../lib/email/client.ts';
import { ClientIsMinorEmail } from '../../lib/email/templates/client-is-minor.ts';

export interface SendClientIsMinorEmailInput {
  coachEmail: string;
  clientName: string;
}

export async function sendClientIsMinorEmail({
  coachEmail,
  clientName,
}: SendClientIsMinorEmailInput): Promise<void> {
  await sendEmail({
    to: coachEmail,
    subject: `${clientName} is under 18`,
    react: ClientIsMinorEmail({ clientName }),
  });
}
