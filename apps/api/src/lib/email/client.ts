// The Resend client and `sendEmail` — the only module that talks to Resend
// (`auth-server/06`). Every later email (`../invites/02`, the deletion
// recovery notice, the weekly digest) sends through this wrapper, never
// imports the `resend` SDK directly.
//
// Rendered with `react-dom/server`'s own `renderToStaticMarkup`, not
// `@react-email/render`'s `render()` — that function does its HTML/plain-text
// work behind an internal `await import('react-dom/server')`, which Jest's
// CommonJS-transpiled test runner cannot execute without
// `--experimental-vm-modules` (a Jest-wide flag change this task isn't
// taking on for one dependency). `renderToStaticMarkup` is a static import,
// so it just works; `toPlainText` below is this file's own, much smaller,
// replacement for the plain-text half.
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Resend } from 'resend';

import { env } from '../../env.ts';
import { logger } from '../logger.ts';

const resend = new Resend(env.RESEND_API_KEY);

// A slow Resend call must not hold the request open indefinitely — bounded
// so the caller (e.g. `auth.requestReset`'s fire-and-forget) resolves
// either way within a predictable window.
const SEND_TIMEOUT_MS = 10_000;

export function renderEmailHtml(react: ReactElement): string {
  return `<!doctype html>${renderToStaticMarkup(react)}`;
}

/**
 * A deliberately small tag-stripper, not a general HTML-to-text library —
 * every template this project sends goes through `./layout.tsx`, whose
 * structure (heading, paragraphs, one button, the URL printed as text
 * beneath it) this function is written against. A template with a
 * fundamentally different shape (a table, nested lists) should get a
 * matching test in `__tests__/templates.test.ts` before trusting this
 * blindly, not a rewrite of this function on a hunch.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface SendEmailInput {
  to: string;
  subject: string;
  react: ReactElement;
}

export interface SendEmailResult {
  ok: boolean;
}

/**
 * Renders `react` to HTML and a plaintext alternative and sends through
 * Resend, from `EMAIL_FROM`. Never throws — a send failure is logged and
 * reported in the return value, not an exception, because the one caller
 * this task has (`auth.requestReset`) must show the identical response
 * whether or not the send actually succeeded (`06`'s Approach step 1: a
 * "your email failed to send" message is the enumeration leak wearing yet
 * another face). A future caller that genuinely needs to know synchronously
 * reads `ok`.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const html = renderEmailHtml(input.react);
  const text = toPlainText(html);

  try {
    const result = await Promise.race([
      resend.emails.send({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html,
        text,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('email send timed out')), SEND_TIMEOUT_MS);
      }),
    ]);

    if (result.error) {
      // `errorCode` here carries Resend's own error name, not a catalogued
      // `AppErrorCode` — same reuse `../alerts.ts`'s `alert.delivery_failed`
      // makes for "an identifier of what failed", not a free-text message.
      // Never the subject or the recipient: both are personal data (DB§18)
      // `logger.ts`'s closed `LogFields` allowlist has no field for.
      logger.error('email.send_failed', { errorCode: result.error.name });
      return { ok: false };
    }
    return { ok: true };
  } catch {
    logger.error('email.send_failed', { errorCode: 'timeout_or_network' });
    return { ok: false };
  }
}
