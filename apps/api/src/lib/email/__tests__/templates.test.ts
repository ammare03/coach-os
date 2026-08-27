// `auth-server/06`'s Verification: "render the email rather than asserting
// on a string" — the rendered HTML and plaintext, not `sendEmail`, which
// never touches Resend in a test.
import { renderEmailHtml, toPlainText } from '../client.ts';
import { PasswordResetEmail } from '../templates/password-reset.tsx';

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
