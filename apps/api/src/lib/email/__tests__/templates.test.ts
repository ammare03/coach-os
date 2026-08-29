// `auth-server/06`'s Verification: "render the email rather than asserting
// on a string" — the rendered HTML and plaintext, not `sendEmail`, which
// never touches Resend in a test.
import { renderEmailHtml, toPlainText } from '../client.ts';
import { DeletionRecoveryEmail } from '../templates/deletion-recovery.ts';
import { GuardianAccessEndedEmail } from '../templates/guardian-access-ended.ts';
import { GuardianConsentEmail } from '../templates/guardian-consent.ts';
import { InviteEmail } from '../templates/invite.ts';
import { PasswordResetEmail } from '../templates/password-reset.ts';

const RESET_URL = 'https://app.coachos.test/reset-password/abc123';

describe('PasswordResetEmail', () => {
  it('renders to HTML containing the link exactly once as a real href', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    const hrefOccurrences = html.split(`href="${RESET_URL}"`).length - 1;
    expect(hrefOccurrences).toBe(1);
    // Printed again as plain visible text beneath the button ('06' step 8) — two occurrences total.
    expect(html.split(RESET_URL).length - 1).toBe(2);
  });

  it('renders a plaintext alternative containing the link', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    const text = toPlainText(html);
    expect(text).toContain(RESET_URL);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('<');
  });

  it('contains no remotely-loaded image and no tracking pixel', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    expect(html).not.toMatch(/<img/i);
  });

  it('never renders the link as a coachos:// scheme', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    expect(html).not.toContain('coachos://');
  });

  it('leaves no unrendered template variable', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    expect(html).not.toMatch(/\{\{.*?\}\}|\$\{.*?\}/);
  });

  it('starts with a doctype', () => {
    const html = renderEmailHtml(PasswordResetEmail({ resetUrl: RESET_URL }));
    expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true);
  });
});

describe('toPlainText', () => {
  it('converts <br> to a newline and strips tags', () => {
    expect(toPlainText('<p>Hello<br>World</p>')).toBe('Hello\nWorld');
  });

  it('decodes common HTML entities', () => {
    expect(toPlainText('<p>Ben &amp; Jerry&#x27;s</p>')).toBe("Ben & Jerry's");
  });

  it('collapses more than two consecutive blank lines', () => {
    expect(toPlainText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });
});

describe('GuardianConsentEmail', () => {
  const CONSENT_URL = 'https://app.coachos.test/guardian-consent/abc123';

  it('renders the client and coach name and the consent link', () => {
    const html = renderEmailHtml(
      GuardianConsentEmail({ clientName: 'Alex', coachName: 'Coach Sam', consentUrl: CONSENT_URL }),
    );
    expect(html).toContain('Alex');
    expect(html).toContain('Coach Sam');
    expect(html).toContain(CONSENT_URL);
    expect(html).not.toContain('coachos://');
  });
});

describe('InviteEmail', () => {
  const DEEP_LINK_URL = 'coachos://invite/ABCD2345';
  const HTTPS_FALLBACK_URL = 'https://app.coachos.test/invite/ABCD2345';

  it('renders both the coachos:// deep link and the https fallback', () => {
    const html = renderEmailHtml(
      InviteEmail({
        coachName: 'Coach Sam',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toContain(DEEP_LINK_URL);
    expect(html).toContain(HTTPS_FALLBACK_URL);
  });

  it('renders the https fallback as the primary button, not the deep link', () => {
    const html = renderEmailHtml(
      InviteEmail({
        coachName: 'Coach Sam',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toContain(`href="${HTTPS_FALLBACK_URL}"`);
  });

  it('states the 14-day expiry', () => {
    const html = renderEmailHtml(
      InviteEmail({
        coachName: 'Coach Sam',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toMatch(/14 days/);
  });

  it('contains no remotely-loaded image and no tracking pixel', () => {
    const html = renderEmailHtml(
      InviteEmail({
        coachName: 'Coach Sam',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).not.toMatch(/<img/i);
  });
});

describe('DeletionRecoveryEmail', () => {
  const DEEP_LINK_URL = 'coachos://settings';
  const HTTPS_FALLBACK_URL = 'https://app.coachos.test/account';

  it('renders both the coachos:// deep link and the https fallback', () => {
    const html = renderEmailHtml(
      DeletionRecoveryEmail({
        scheduledPurgeDate: 'September 5, 2026',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toContain(DEEP_LINK_URL);
    expect(html).toContain(HTTPS_FALLBACK_URL);
  });

  it('renders the https fallback as the primary button, not the deep link', () => {
    const html = renderEmailHtml(
      DeletionRecoveryEmail({
        scheduledPurgeDate: 'September 5, 2026',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toContain(`href="${HTTPS_FALLBACK_URL}"`);
  });

  it('states the scheduled purge date', () => {
    const html = renderEmailHtml(
      DeletionRecoveryEmail({
        scheduledPurgeDate: 'September 5, 2026',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).toContain('September 5, 2026');
  });

  it('contains no remotely-loaded image and no tracking pixel', () => {
    const html = renderEmailHtml(
      DeletionRecoveryEmail({
        scheduledPurgeDate: 'September 5, 2026',
        deepLinkUrl: DEEP_LINK_URL,
        httpsFallbackUrl: HTTPS_FALLBACK_URL,
      }),
    );
    expect(html).not.toMatch(/<img/i);
  });
});

describe('GuardianAccessEndedEmail', () => {
  it('renders a different body for the client than for the guardian', () => {
    const clientHtml = renderEmailHtml(GuardianAccessEndedEmail({ recipient: 'client' }));
    const guardianHtml = renderEmailHtml(GuardianAccessEndedEmail({ recipient: 'guardian' }));
    expect(clientHtml).not.toBe(guardianHtml);
    expect(guardianHtml).toMatch(/guardian access/i);
  });
});
