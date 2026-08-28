// The consent request `07`'s Approach step 4 requires before a 13-17
// client's account activates ("never let coaching begin and then
// retroactively obtain consent"). Sent to `guardian_email`, confirmed by
// link — the confirmation endpoint itself belongs to
// `../../../invites/04-invite-acceptance.md`, the only caller of this
// template; this file only renders it.
import { Text } from '@react-email/components';

import { EmailLayout } from '../layout.tsx';

export interface GuardianConsentEmailProps {
  clientName: string;
  coachName: string;
  consentUrl: string;
}

export function GuardianConsentEmail({
  clientName,
  coachName,
  consentUrl,
}: GuardianConsentEmailProps) {
  return (
    <EmailLayout
      preheading={`${clientName} wants to join CoachOS as a client of ${coachName}`}
      heading="A parent or guardian's consent is needed"
      actionLabel="Review and confirm"
      actionUrl={consentUrl}
      body={
        <>
          <Text style={{ fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' }}>
            {clientName} has been invited to join CoachOS as a client of {coachName}. Because
            they&apos;re under 18, we need a parent or guardian to confirm before their account can
            start.
          </Text>
          <Text style={{ fontSize: '14px', lineHeight: '20px', margin: 0 }}>
            Nothing happens with their account until you confirm — no coaching, no data collection
            beyond this request.
          </Text>
        </>
      }
    />
  );
}
