// `account-lifecycle/06` — sent to both parties when a coaching
// relationship ends, whichever side initiated it. `product-copy` skill §5:
// state the fact, no reason forwarded, no blame either direction — the
// initiator's reason (if any) is not the other party's business.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s own doc comment for why.
import { Text } from '@react-email/components';
import { createElement } from 'react';

import { EmailLayout } from '../layout.ts';

export interface RelationshipEndedEmailProps {
  // Who this specific email is addressed to — the copy differs by
  // perspective even though both emails describe the same event.
  recipientRole: 'coach' | 'client';
  otherPartyName: string;
}

export function RelationshipEndedEmail({
  recipientRole,
  otherPartyName,
}: RelationshipEndedEmailProps) {
  const heading =
    recipientRole === 'coach'
      ? `${otherPartyName} is no longer working with you on CoachOS`
      : `You're no longer working with ${otherPartyName} on CoachOS`;

  const detail =
    recipientRole === 'coach'
      ? 'Their training history and your notes stay available to you for 30 days, then this account loses access.'
      : 'Your training history stays yours. You can start with a new coach at any time.';

  return createElement(EmailLayout, {
    preheading: heading,
    heading,
    body: createElement(
      Text,
      { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
      detail,
    ),
  });
}
