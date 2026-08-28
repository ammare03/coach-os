// The invite email (`invites/02`) — sent after `invites/01`'s row commits.
// Carries both the `coachos://` deep link (for a device that already has
// the app) and an HTTPS fallback (the button, and what most email clients
// actually render reliably — `02`'s Approach step 1: the fallback matters
// for clients that strip custom URI schemes, and for a recipient who
// hasn't installed the app yet, where the https page is what can redirect
// to the store). Deep-link *resolution* itself is `phase-05-app-shell/
// deep-linking`'s job — this template only ever renders the two URLs it's
// given.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why (`docs/UNFORGET.md` S3).
import { Link, Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface InviteEmailProps {
  coachName: string;
  deepLinkUrl: string;
  httpsFallbackUrl: string;
}

export function InviteEmail({ coachName, deepLinkUrl, httpsFallbackUrl }: InviteEmailProps) {
  return createElement(EmailLayout, {
    preheading: `${coachName} invited you to CoachOS`,
    heading: `${coachName} invited you to CoachOS`,
    actionLabel: 'Accept invite',
    actionUrl: httpsFallbackUrl,
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        `${coachName} has invited you to train with them on CoachOS. This invite expires in 14 days.`,
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        'Already have the app installed? ',
        createElement(Link, { href: deepLinkUrl }, 'Open it directly'),
        '.',
      ),
    ),
  });
}
