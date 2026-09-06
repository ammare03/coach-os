// `/privacy` is a placeholder standing in for a document counsel has not
// written (CLAUDE.md §21.3, COMPLIANCE.md CO§7 gap 9). Almost everything
// worth testing about it is therefore a *restraint*: what it must keep
// saying about itself, and what it must never start claiming.
//
// Rendered with `react-dom/server`, matching `guardian-consent/page.test.tsx`
// — no DOM, no jsdom, no testing-library.

import { renderToStaticMarkup } from 'react-dom/server';

import { PrivacyContent } from './content';

const html = renderToStaticMarkup(<PrivacyContent />);
const text = html.toLowerCase();

describe('the page says what it is, first', () => {
  it('calls itself a placeholder and says the policy is unfinished', () => {
    expect(html).toContain('This page is a placeholder');
    expect(html).toContain('has not been reviewed by a lawyer');
    expect(html).toContain('Read this as a summary, not as the policy');
  });

  it('never presents itself as a complete or binding policy', () => {
    expect(html).toContain('it is not complete');
    expect(text).not.toContain('privacy policy last updated');
    expect(text).not.toContain('effective date');
    expect(text).not.toContain('by using coachos you agree');
  });
});

// The claim-by-claim guard. Each of these is written down elsewhere in the
// repo; an edit that deletes one is deleting something a guardian was told.
describe('the sourced claims', () => {
  it.each([
    ['CLAUDE.md §21.1 — personal', 'date of birth'],
    ['CLAUDE.md §21.1 — sensitive', 'body measurements'],
    ['CLAUDE.md §21.1 — operational', 'App version'],
    ['COMPLIANCE.md CO§1 — never sold', 'We do not sell personal data'],
    ['CLAUDE.md §20 — no session recording', 'do not record anyone'],
    ['CLAUDE.md §21.5 — photos absent, not gated', 'Progress photos are absent'],
    ['CLAUDE.md §21.5 — analytics and AI forced off', 'cannot be turned on from inside the app'],
    ['CLAUDE.md §21.5 — guardian export/delete', 'export or delete'],
    ['CLAUDE.md §21.3 — the data is the client’s', 'belongs to the client'],
    ['CLAUDE.md §21.3 — not a medical service', 'not a medical service'],
  ])('states %s', (_source, claim) => {
    expect(html).toContain(claim);
  });
});

// The other half: things no document in this repo supports, which a
// well-meaning edit would otherwise add.
describe('the unsourced claims it must not make', () => {
  it.each([
    'we comply',
    'fully compliant',
    'gdpr-compliant',
    'dpdp-compliant',
    'data protection officer',
    'grievance officer',
    'encrypted end-to-end',
    'iso 27001',
    'soc 2',
  ])('claims no %s', (forbidden) => {
    expect(text).not.toContain(forbidden);
  });

  // COMPLIANCE.md CO§7 gaps 5 and 10 — no officer is designated and no
  // retention schedule is published, so neither may be implied here.
  it('publishes no contact address it does not have', () => {
    expect(html).toContain('no published contact address yet');
    expect(html).not.toMatch(/[\w.]+@[\w.]+/);
  });

  it('invents no retention period', () => {
    expect(text).not.toMatch(/\b\d+\s*(day|days|month|months|year|years)\b/);
  });
});

// COPY.md §CO1, the same list the consent page is held to.
describe('copy law', () => {
  it.each([
    'healthy',
    'unhealthy',
    'transform',
    'results',
    'guarantee',
    'best shape',
    'should eat',
  ])('contains no outcome promise or health claim (%s)', (forbidden) => {
    expect(text).not.toContain(forbidden);
  });
});

describe('the same posture as the consent page', () => {
  it('loads no third-party font, script or image', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('is static — no form, no button, nothing to submit', () => {
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
  });

  it('renders real landmarks and a real heading order', () => {
    expect(html).toContain('<main');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect((html.match(/<section/g) ?? []).length).toBeGreaterThan(1);
    expect((html.match(/<h2/g) ?? []).length).toBeGreaterThan(1);
  });

  it('hides every decorative glyph from a screen reader', () => {
    const svgs = html.match(/<svg/g) ?? [];
    const hidden = html.match(/aria-hidden="true"/g) ?? [];

    expect(svgs.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThanOrEqual(svgs.length);
  });
});
