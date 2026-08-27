// The base layout every transactional email in the product uses
// (`auth-server/06`) — fixes the visual/structural vocabulary once: a
// single primary action, the raw URL printed beneath it for clients that
// strip links, no remotely-loaded image, no tracking pixel (a §20
// guardrail as much as a deliverability one — an email open is not an
// event this product needs). `../invites/02` and `../account-lifecycle/03`
// build their own template on this, never a copy of it.
import { Body, Button, Container, Head, Hr, Html, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

export interface EmailLayoutProps {
  preheading: string;
  heading: string;
  body: ReactNode;
  actionLabel?: string;
  actionUrl?: string;
}

export function EmailLayout({
  preheading,
  heading,
  body,
  actionLabel,
  actionUrl,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        {/* Visually hidden preheader — the summary line webmail clients show next to the subject. */}
        <Text style={{ display: 'none', fontSize: 1, lineHeight: '1px', maxHeight: 0, opacity: 0 }}>
          {preheading}
        </Text>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', maxWidth: '480px' }}>
          <Text style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 16px' }}>{heading}</Text>
          <Section>{body}</Section>
          {actionLabel && actionUrl ? (
            <Section style={{ marginTop: '24px' }}>
              <Button
                href={actionUrl}
                style={{
                  backgroundColor: '#111827',
                  color: '#ffffff',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  fontSize: '15px',
                  textDecoration: 'none',
                }}
              >
                {actionLabel}
              </Button>
              {/* Printed as plain text too — a link a mail client rewrites is a link that stops working ('06' step 8). */}
              <Text style={{ fontSize: '13px', color: '#6b7280', wordBreak: 'break-all' }}>
                {actionUrl}
              </Text>
            </Section>
          ) : null}
          <Hr style={{ margin: '32px 0 16px', borderColor: '#e5e7eb' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>
            CoachOS · This is a transactional email about your account.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
