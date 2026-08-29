// `account-lifecycle/09` — sent once the data-export job finishes. No
// `actionUrl`/`actionLabel`: `account-lifecycle/10`/`/11` haven't built the
// authenticated download surface yet, and this task's own security review
// (Approach step 8, `security-and-privacy` skill §4) refuses to embed a raw
// R2 signed URL in an email — a link that outlives the ≤1h signature ceiling
// would be broken long before the archive's 7-day life ends, and one that
// respects the ceiling would be dead on arrival for anyone who doesn't open
// the email within the hour. Same reasoning `../templates/coach-deletion-
// notice.ts` already established for not promising a feature this task
// doesn't build.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s own doc comment for why.
import { Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface ExportReadyEmailProps {
  name: string;
}

export function ExportReadyEmail({ name }: ExportReadyEmailProps) {
  const heading = 'Your CoachOS data export is ready';

  return createElement(EmailLayout, {
    preheading: heading,
    heading,
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        `Hi ${name}, the data export you requested is ready. Open the CoachOS app and go to Settings → Your data to download it.`,
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        "It's available to download for 7 days from today.",
      ),
    ),
  });
}
