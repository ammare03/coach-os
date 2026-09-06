// `guardian-consent/01` — builds the guardian's confirmation URL and sends
// through the shared `sendEmail` wrapper (`../../lib/email/client.ts`),
// never the `resend` package directly. Same split as
// `./send-invite-email.ts`: the caller's transaction and this file's I/O
// stay visually distinct.
//
// **https only, never `coachos://`.** Unlike `./send-invite-email.ts` there
// is no deep-link half at all — the recipient is a parent who almost
// certainly does not have CoachOS installed and will never install it
// (feature README, decision 2026-09-05). The page this points at is built
// by `guardian-consent/05`; until then the route 404s, exactly as every
// other https link this repo emails does today.
import { env } from '../../env.ts';
import { sendEmail } from '../../lib/email/client.ts';
import { GuardianConsentEmail } from '../../lib/email/templates/guardian-consent.ts';

export interface SendGuardianConsentEmailInput {
  guardianEmail: string;
  clientName: string;
  coachName: string;
  /** The raw token. Only its hash was stored (`../../lib/auth/guardian-consent-token.ts`). */
  token: string;
}

export async function sendGuardianConsentEmail({
  guardianEmail,
  clientName,
  coachName,
  token,
}: SendGuardianConsentEmailInput): Promise<void> {
  await sendEmail({
    to: guardianEmail,
    subject: `${clientName} needs a parent or guardian to confirm their CoachOS account`,
    react: GuardianConsentEmail({
      clientName,
      coachName,
      consentUrl: `${env.APP_PUBLIC_URL}/guardian-consent/${token}`,
    }),
  });
}
