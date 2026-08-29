// `account-lifecycle/05` — sent once to every non-archived client of a
// coach whose 7-day personal deletion grace has elapsed. `product-copy`
// skill §2/§3: state the fact, no diagnosis, no promise of a feature this
// task doesn't build (the export UI is `account-lifecycle/09`–`12`, later)
// — this only tells the client what is already true today: their data
// stays theirs and stays in the app.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s own doc comment for why.
import { Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface CoachDeletionNoticeEmailProps {
  coachName: string;
}

export function CoachDeletionNoticeEmail({ coachName }: CoachDeletionNoticeEmailProps) {
  const heading = `${coachName} is closing their CoachOS account`;

  return createElement(EmailLayout, {
    preheading: heading,
    heading,
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        `${coachName}'s CoachOS account will be removed in 30 days. Your training history, comments, and check-ins are yours — they stay in your account and stay accessible.`,
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        'You can keep using CoachOS and start with a new coach at any time.',
      ),
    ),
  });
}
