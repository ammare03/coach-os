// `account-lifecycle/12` — sent to the minor client themselves the moment
// their guardian's export completes (Approach step 1: "the minor is told:
// an in-app notice and an email... A child's data being handed to an adult
// is legitimate and should not be invisible to the child."). The in-app
// half is tracked in `docs/UNFORGET.md` — no notifications table or surface
// exists yet (`phase-15-notifications`, unbuilt).
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why.
import { Text } from '@react-email/components';
import { createElement } from 'react';

import { EmailLayout } from '../layout.ts';

export interface GuardianExportNoticeEmailProps {
  name: string;
}

export function GuardianExportNoticeEmail({ name }: GuardianExportNoticeEmailProps) {
  const heading = 'Your parent or guardian requested a copy of your CoachOS data';

  return createElement(EmailLayout, {
    preheading: heading,
    heading,
    body: createElement(
      Text,
      { style: { fontSize: '14px', lineHeight: '20px', margin: 0 } },
      `Hi ${name}, your parent or guardian requested and received a copy of your CoachOS data. This is a normal part of guardian access on your account and needs no action from you.`,
    ),
  });
}
