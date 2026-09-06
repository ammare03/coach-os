// The four things this route can show, as pure components with no data
// fetching, no hooks and no server-only imports — which is what lets
// `page.test.tsx` render each one and read the result.
//
// Copy rules that are load-bearing here, not stylistic:
//   - COPY.md §CO1 — nothing diagnoses, prescribes, or promises an outcome.
//     The guardian is being told what the product does, never what it will
//     do for their child.
//   - `already_confirmed` is a SUCCESS page. Parents forward these emails to
//     each other; a red error page produces a phone call to the coach.
//   - `invalid` offers no resend. There is no authenticated caller here, so
//     a resend button would be an unauthenticated email trigger. The
//     recovery is the client's own `Resend`, which is ERRORS.md ER§1.2's
//     action for `GUARDIAN_CONSENT_PENDING`.
//   - Nothing before `Confirmed` names anybody. An unauthenticated GET that
//     rendered a real child's name would make the URL a name-disclosure
//     oracle (`05` Risks).

import type { ReactNode } from 'react';

// Relative, same origin: `apps/web` is what serves `APP_PUBLIC_URL`, and
// CLAUDE.md §3.2 makes it the marketing site too, so the policy is a
// sibling page rather than a cross-origin link.
//
// ⚠️ `/privacy` is a placeholder, not a policy. CLAUDE.md §21.3's "get a
// lawyer before launch" is still unresolved; the page says so in its own
// first sentence rather than pretending otherwise. The link no longer 404s,
// which is what matters on a page whose whole purpose is obtaining informed
// consent.
const PRIVACY_POLICY_HREF = '/privacy';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="gc-page">
      <div className="gc-ambient" aria-hidden="true">
        <div className="gc-bloom gc-bloom-a" />
        <div className="gc-bloom gc-bloom-b" />
      </div>
      <div className="gc-wrap">
        <div className="gc-mark">
          <span className="gc-mark-badge" aria-hidden="true">
            <span />
          </span>
          <span className="gc-mark-name">CoachOS</span>
        </div>
        {children}
      </div>
    </main>
  );
}

function TickGlyph() {
  return (
    <span className="gc-status" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path
          d="M6.5 13.6l4.4 4.3 8.6-9.4"
          stroke="#FFC9B2"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function AlertGlyph() {
  return (
    <span className="gc-status gc-status-bad" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path d="M13 6.6v7.6" stroke="#FF8A9B" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="13" cy="18.6" r="1.4" fill="#FF8A9B" />
      </svg>
    </span>
  );
}

function Fact({
  glyph,
  title,
  children,
}: {
  glyph: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="gc-glyph" aria-hidden="true">
        {glyph}
      </span>
      <div>
        <span className="gc-fact-title">{title}</span>
        <p className="gc-fact-body">{children}</p>
      </div>
    </li>
  );
}

function PrivacyLink() {
  return (
    <a className="gc-link" href={PRIVACY_POLICY_HREF}>
      Privacy Policy
    </a>
  );
}

/**
 * What a `GET` renders. Deliberately generic: the email that brought the
 * guardian here already names the client and the coach, to an address we
 * had reason to send it to. This page does not.
 */
export function Intro({ action }: { action: ReactNode }) {
  return (
    <>
      <section className="gc-hero">
        <p className="gc-eyebrow">Parent or guardian consent</p>
        <h1 className="gc-h1">Someone under 18 has been invited to CoachOS</h1>
        <p className="gc-lede">
          The email that brought you here names them and names their coach. Their account cannot
          start until a parent or guardian confirms.
        </p>
      </section>

      <section>
        <h2 className="gc-h2">What you&rsquo;re confirming</h2>
        <div className="gc-card">
          <ul className="gc-facts">
            <Fact
              title="What CoachOS is"
              glyph={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect
                    x="1"
                    y="1.5"
                    width="10"
                    height="9"
                    rx="2"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M3.4 6.2h5.2M3.4 8.2h3.2"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            >
              An app a coach uses to set training and nutrition plans, see what was logged, and send
              feedback. It is not a medical service and gives no medical advice.
            </Fact>

            <Fact
              title="Who can see their information"
              glyph={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="4.2" r="2.1" stroke="#FFA586" strokeWidth="1.2" />
                  <path
                    d="M2.2 10.3c0-2 1.7-3.2 3.8-3.2s3.8 1.2 3.8 3.2"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            >
              Their coach, and nobody else. The coach is named in the email you received.
            </Fact>

            <Fact
              title="Progress photos are not part of an under-18 account"
              glyph={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect
                    x="1"
                    y="2.6"
                    width="10"
                    height="7.4"
                    rx="2"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                  />
                  <circle cx="6" cy="6.3" r="1.7" stroke="#FFA586" strokeWidth="1.2" />
                  <path
                    d="M1.6 1.6l8.8 8.8"
                    stroke="#FF8A9B"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              }
            >
              The feature is absent, not switched off. Analytics and AI processing are off too, and
              cannot be turned on from inside the app.
            </Fact>

            <Fact
              title="You can change your mind"
              glyph={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M6 1.6v5.9M6 7.5L4 5.6M6 7.5L8 5.6"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M2 8.6v1.2h8V8.6"
                    stroke="#FFA586"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              }
            >
              You can ask us to export or delete their data at any time. Read the <PrivacyLink />.
            </Fact>
          </ul>
        </div>
      </section>

      <div className="gc-foot">
        <p className="gc-fine">
          Nothing has been confirmed yet. Their account starts only when you choose to confirm.
        </p>
        {action}
        <p className="gc-fine">
          If you weren&rsquo;t expecting this, you can close this page. Nothing happens.
        </p>
      </div>
    </>
  );
}

/** The only state that renders a name, and only after the token is spent. */
export function Confirmed({ clientName }: { clientName: string }) {
  return (
    <>
      <section className="gc-hero">
        <TickGlyph />
        <p className="gc-eyebrow gc-eyebrow-warm">Consent confirmed</p>
        <h1 className="gc-h1">Thank you &mdash; {clientName}&rsquo;s account is ready</h1>
        <p className="gc-lede">
          {clientName} can start with their coach now. There is nothing else for you to do, and you
          don&rsquo;t need a CoachOS account.
        </p>
      </section>
      <div className="gc-card">
        <p className="gc-fine">
          You can ask us to export or delete {clientName}&rsquo;s data at any time &mdash; the{' '}
          <PrivacyLink /> explains how. Keep the email that brought you here; it is the record of
          what you confirmed.
        </p>
      </div>
      <p className="gc-fine">You can close this page.</p>
    </>
  );
}

/** Same warmth and the same glyph as `Confirmed`, deliberately. */
export function AlreadyConfirmed() {
  return (
    <>
      <section className="gc-hero">
        <TickGlyph />
        <p className="gc-eyebrow gc-eyebrow-warm">Already confirmed</p>
        <h1 className="gc-h1">This one is already done</h1>
        <p className="gc-lede">
          Consent for this account is already on file. The link may have been used before, or
          forwarded to you by someone who used it. Nothing more is needed.
        </p>
      </section>
      <div className="gc-card">
        <p className="gc-fine">
          You can ask us to export or delete this account&rsquo;s data at any time &mdash; the{' '}
          <PrivacyLink /> explains how.
        </p>
      </div>
      <p className="gc-fine">You can close this page.</p>
    </>
  );
}

/** Unknown, expired and already-spent, collapsed — as task `02` returns them. */
export function Invalid() {
  return (
    <>
      <section className="gc-hero gc-hero-flat">
        <AlertGlyph />
        <p className="gc-eyebrow gc-eyebrow-bad">This link no longer works</p>
        <h1 className="gc-h1">This link has expired or has already been used</h1>
        <p className="gc-lede">
          Consent links work once and don&rsquo;t last long, so we can&rsquo;t confirm anything from
          this one.
        </p>
      </section>
      <div className="gc-card">
        <h2 className="gc-h3">How to get a new link</h2>
        <p className="gc-fine">
          Ask them to open CoachOS and tap <span className="gc-strong">Resend</span> on the screen
          that says it is waiting on a guardian&rsquo;s confirmation. A fresh link comes straight to
          this email address.
        </p>
      </div>
      <p className="gc-fine">
        We can&rsquo;t send a new link from this page &mdash; there is no way for us to know who you
        are here.
      </p>
    </>
  );
}

/**
 * Not one of task `02`'s outcomes — this is "we could not ask". The token
 * is untouched, so the button stays.
 */
export function Unavailable({ action }: { action: ReactNode }) {
  return (
    <>
      <section className="gc-hero gc-hero-flat">
        <AlertGlyph />
        <p className="gc-eyebrow gc-eyebrow-bad">Something went wrong at our end</p>
        <h1 className="gc-h1">We couldn&rsquo;t confirm just now</h1>
        <p className="gc-lede">
          Your link has not been used and is still good. Please try again in a minute.
        </p>
      </section>
      <div className="gc-foot">{action}</div>
    </>
  );
}
