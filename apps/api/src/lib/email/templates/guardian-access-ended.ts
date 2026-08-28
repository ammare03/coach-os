// Sent by `../../../jobs/age-sweep.ts` when a minor client turns 18 —
// `07`'s Approach step 6: "emails both the client and their guardian that
// guardian access has ended." Two short, role-specific bodies rather than
// one generic one, since the two recipients need different information
// (the client: nothing changed except a flag; the guardian: your access is
// gone).
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why (`docs/UNFORGET.md` S3).
import { Text } from '@react-email/components';
import { createElement } from 'react';

import { EmailLayout } from '../layout.ts';

export interface GuardianAccessEndedEmailProps {
  recipient: 'client' | 'guardian';
}

export function GuardianAccessEndedEmail({ recipient }: GuardianAccessEndedEmailProps) {
  if (recipient === 'guardian') {
    return createElement(EmailLayout, {
      preheading: 'Guardian access to this CoachOS account has ended',
      heading: 'Guardian access has ended',
      body: createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: 0 } },
        'The CoachOS account you had guardian access to now belongs to someone who has turned 18. Guardian access — consent management, exports, and deletion requests on their behalf — has ended. No further action is needed from you.',
      ),
    });
  }

  return createElement(EmailLayout, {
    preheading: 'Your CoachOS account has been updated',
    heading: 'Your account has been updated',
    body: createElement(
      Text,
      { style: { fontSize: '14px', lineHeight: '20px', margin: 0 } },
      "Now that you're 18, your CoachOS account no longer needs guardian consent to operate, and features that were unavailable to a minor account are now available. Your coach and your data are unchanged.",
    ),
  });
}
