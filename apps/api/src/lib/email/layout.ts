// The base layout every transactional email in the product uses
// (`auth-server/06`) — fixes the visual/structural vocabulary once: a
// single primary action, the raw URL printed beneath it for clients that
// strip links, no remotely-loaded image, no tracking pixel (a §20
// guardrail as much as a deliverability one — an email open is not an
// event this product needs). `../invites/02` and `../account-lifecycle/03`
// build their own template on this, never a copy of it.
//
// Plain `createElement` calls, not JSX (`.ts`, not `.tsx`) — deliberately.
// Node's `--experimental-strip-types` (`pnpm dev`/`pnpm worker`'s dev-loop
// invocation) has no JSX transform and cannot load a `.tsx` file at all
// ("Unknown file extension" at the module-loader level, not a transform
// gap); the production path (`tsc` → `dist/`) would have handled JSX fine,
// which is why this went unnoticed until someone ran `pnpm dev` end to end
// (`docs/UNFORGET.md` S3). `@react-email/components`'s elements don't
// require JSX — `createElement(Tag, props, ...children)` renders
// identically, verified by `__tests__/templates.test.ts`'s own HTML
// assertions, which are unchanged by this file's shape.
import { Body, Button, Container, Head, Hr, Html, Section, Text } from '@react-email/components';
import { createElement, type ReactNode } from 'react';

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
  return createElement(
    Html,
    { lang: 'en' },
    createElement(Head, null),
    createElement(
      Body,
      { style: { backgroundColor: '#f4f4f5', fontFamily: 'Helvetica, Arial, sans-serif' } },
      // Visually hidden preheader — the summary line webmail clients show next to the subject.
      createElement(
        Text,
        { style: { display: 'none', fontSize: 1, lineHeight: '1px', maxHeight: 0, opacity: 0 } },
        preheading,
      ),
      createElement(
        Container,
        { style: { backgroundColor: '#ffffff', padding: '32px', maxWidth: '480px' } },
        createElement(
          Text,
          { style: { fontSize: '20px', fontWeight: 700, margin: '0 0 16px' } },
          heading,
        ),
        createElement(Section, null, body),
        actionLabel && actionUrl
          ? createElement(
              Section,
              { style: { marginTop: '24px' } },
              createElement(
                Button,
                {
                  href: actionUrl,
                  style: {
                    backgroundColor: '#111827',
                    color: '#ffffff',
                    padding: '12px 20px',
                    borderRadius: '8px',
                    fontSize: '15px',
                    textDecoration: 'none',
                  },
                },
                actionLabel,
              ),
              // Printed as plain text too — a link a mail client rewrites is a link that stops working ('06' step 8).
              createElement(
                Text,
                { style: { fontSize: '13px', color: '#6b7280', wordBreak: 'break-all' } },
                actionUrl,
              ),
            )
          : null,
        createElement(Hr, { style: { margin: '32px 0 16px', borderColor: '#e5e7eb' } }),
        createElement(
          Text,
          { style: { fontSize: '12px', color: '#9ca3af', margin: 0 } },
          'CoachOS · This is a transactional email about your account.',
        ),
      ),
    ),
  );
}
