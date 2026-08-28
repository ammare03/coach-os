// The one template this task sends (`auth-server/06`). `resetUrl` is
// caller-supplied, already built from `APP_PUBLIC_URL` — this file never
// reads env itself, so it stays a pure render function the test suite can
// snapshot with a fixed input.
import { Text } from '@react-email/components';

import { EmailLayout } from '../layout.tsx';

export interface PasswordResetEmailProps {
  resetUrl: string;
}

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <EmailLayout
      preheading="Reset your CoachOS password"
      heading="Reset your password"
      actionLabel="Reset password"
      actionUrl={resetUrl}
      body={
        <>
          <Text style={{ fontSize: '14px', lineHeight: '20px', margin: '0 0 12px' }}>
            We received a request to reset your CoachOS password. This link expires in 60 minutes.
          </Text>
          <Text style={{ fontSize: '14px', lineHeight: '20px', margin: 0 }}>
            If you didn&apos;t request this, you can ignore this email — your password hasn&apos;t
            changed.
          </Text>
        </>
      }
    />
  );
}
