// The route's four rendered states, plus the proof that a `GET` spends
// nothing (`guardian-consent/05`'s Approach step 2 and its second
// acceptance criterion).
//
// Rendered with `react-dom/server`, the same way apps/api tests its React
// Email templates — no DOM, no jsdom, no testing-library.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AlreadyConfirmed, Confirmed, Intro, Invalid, Shell, Unavailable } from './states';

const CONFIRM_BUTTON = <button className="gc-button">I confirm</button>;

function render(node: ReactElement): string {
  return renderToStaticMarkup(<Shell>{node}</Shell>);
}

function source(file: string): string {
  return readFileSync(join(__dirname, file), 'utf8');
}

describe('a GET leaves the token unconsumed', () => {
  // The structural half. `page.tsx` is what a GET runs; if it cannot reach
  // `./confirm`, it cannot spend the token however the render path changes.
  it('page.tsx has no import path to the module that spends the token', () => {
    const page = source('page.tsx');

    expect(page).not.toMatch(/from '\.\/confirm'/);
    expect(page).not.toMatch(/confirmGuardianConsent/);
  });

  it('only the server action reaches ./confirm, and it is a POST-only module', () => {
    const actions = source('actions.ts');

    expect(actions.trimStart().startsWith("'use server';")).toBe(true);
    expect(actions).toMatch(/from '\.\/confirm'/);
  });

  // The runtime half. Rendering the state a GET produces must not touch the
  // network at all.
  it('rendering the pre-confirmation page performs no request', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<Intro action={CONFIRM_BUTTON} />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the pre-confirmation page', () => {
  const html = render(<Intro action={CONFIRM_BUTTON} />);

  it('offers a real focusable button rather than a link that acts', () => {
    expect(html).toContain('<button');
  });

  it('says nothing is confirmed yet', () => {
    expect(html).toContain('Nothing has been confirmed yet');
  });

  it('states what consent covers', () => {
    expect(html).toContain('What CoachOS is');
    expect(html).toContain('Who can see their information');
    expect(html).toContain('Progress photos are not part of an under-18 account');
    expect(html).toContain('export or delete their data at any time');
  });

  it('links to the Privacy Policy', () => {
    expect(html).toContain('>Privacy Policy</a>');
  });

  // The whole reason the pre-confirmation copy is generic: an
  // unauthenticated GET that named a real child turns the URL into a
  // name-disclosure oracle.
  it('names nobody, and says so only in the abstract', () => {
    expect(html).toContain('Someone under 18');
    expect(html).toContain('names them and names their coach');
  });

  // COPY.md §CO1 — never diagnose, prescribe, or promise an outcome.
  it.each([
    'healthy',
    'unhealthy',
    'transform',
    'results',
    'guarantee',
    'best shape',
    'should eat',
  ])('contains no outcome promise or health claim (%s)', (forbidden) => {
    expect(html.toLowerCase()).not.toContain(forbidden);
  });

  it('loads no third-party font, script or image', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('the confirmed page', () => {
  const html = render(<Confirmed clientName="Riya" />);

  it('names the client, which is only known after the token is spent', () => {
    expect(html).toContain('Riya');
    expect(html).toContain('Consent confirmed');
  });

  it('asks nothing further of the guardian', () => {
    expect(html).toContain('nothing else for you to do');
    expect(html).not.toContain('<button');
  });
});

describe('the already-confirmed page', () => {
  const html = render(<AlreadyConfirmed />);

  // A parent forwarding the email to the other parent is the normal case,
  // not an attack. A red error page here produces a call to the coach.
  it('reads as a success, not an error', () => {
    expect(html).toContain('Already confirmed');
    expect(html).toContain('Nothing more is needed');
    expect(html.toLowerCase()).not.toContain('expired');
    expect(html.toLowerCase()).not.toContain('error');
    expect(html.toLowerCase()).not.toContain('sorry');
  });

  it('renders no name — task 02 returns none for this outcome', () => {
    expect(html).toContain('this account');
  });

  it('is visibly a different page from the confirmed one', () => {
    expect(html).not.toBe(render(<Confirmed clientName="Riya" />));
  });
});

describe('the invalid page', () => {
  const html = render(<Invalid />);

  it('sends the guardian to the client’s own Resend, per ERRORS.md ER§1.2', () => {
    expect(html).toContain('Resend');
    expect(html).toContain('open CoachOS');
  });

  // There is no authenticated caller here, so a resend control on this page
  // would be an unauthenticated email trigger.
  it('offers no resend control of its own', () => {
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<form');
  });

  it('discloses no personal data', () => {
    expect(html).not.toContain('@');
  });

  it('is visibly a different page from already-confirmed', () => {
    expect(html).not.toBe(render(<AlreadyConfirmed />));
  });
});

describe('the unavailable page', () => {
  const html = render(<Unavailable action={CONFIRM_BUTTON} />);

  // Our own outage must never read as an expired link — that sends a parent
  // holding a live, still-single-use token to a resend they do not need.
  it('says the link is still good and keeps the button', () => {
    expect(html).toContain('has not been used');
    expect(html).toContain('<button');
    expect(html.toLowerCase()).not.toContain('expired');
  });
});
