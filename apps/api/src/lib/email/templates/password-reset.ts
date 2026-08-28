// The one template this task sends (`auth-server/06`). `resetUrl` is
// caller-supplied, already built from `APP_PUBLIC_URL` — this file never
// reads env itself, so it stays a pure render function the test suite can
// snapshot with a fixed input.
//
// `.ts`, not `.tsx` — see `../layout.ts`'s doc comment for why (`docs/UNFORGET.md` S3).
import { Text } from '@react-email/components';
import { createElement, Fragment } from 'react';

import { EmailLayout } from '../layout.ts';

export interface PasswordResetEmailProps {
  resetUrl: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return createElement(EmailLayout, {
    preheading: 'Reset your CoachOS password',
    heading: 'Reset your password',
    actionLabel: 'Reset password',
    actionUrl: resetUrl,
    body: createElement(
      Fragment,
      null,
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' } },
        'We received a request to reset your CoachOS password. This link expires in 60 minutes.',
      ),
      createElement(
        Text,
        { style: { fontSize: '14px', lineHeight: '20px', margin: 0 } },
        "If you didn't request this, you can ignore this email — your password hasn't changed.",
      ),
    ),
  });
}
