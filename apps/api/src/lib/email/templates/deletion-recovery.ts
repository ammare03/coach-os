// The deletion-request recovery email (`account-lifecycle/03`) — sent every
// time `me.requestDeletion` runs, whether it created the pending row or
// found one already there (a safety net, not proof of a new event; that
// task's Approach step 3). Carries both the `coachos://` deep link and an
// HTTPS fallback, same shape as `./invite.ts` — landing in the app's own
// settings, where §21.4's "cancel deletion" affordance lives, rather than a
// link that performs the cancellation itself: cancelling needs no token,
// only the caller's own session (`03`'s Interfaces section), so there is
// nothing for a stateless link to authenticate against.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why (`docs/UNFORGET.md` S3).
import { Link, Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface DeletionRecoveryEmailProps {
  scheduledPurgeDate: string;
  deepLinkUrl: string;
  httpsFallbackUrl: string;
}

export function DeletionRecoveryEmail({
  scheduledPurgeDate,
  deepLinkUrl,
  httpsFallbackUrl,
}: DeletionRecoveryEmailProps) {
  return createElement(EmailLayout, {
    preheading: 'Your CoachOS account is scheduled for deletion',
    heading: 'Account deletion requested',
    actionLabel: 'Cancel deletion',
    actionUrl: httpsFallbackUrl,
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        `Your CoachOS account and all its data will be permanently deleted on ${scheduledPurgeDate}. ` +
          "If this wasn't you, or you've changed your mind, you can cancel any time before then.",
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        'Already have the app installed? ',
        createElement(Link, { href: deepLinkUrl }, 'Open settings'),
        ' to cancel from there.',
      ),
    ),
  });
}
