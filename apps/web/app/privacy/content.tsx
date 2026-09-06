// ⚠️ THIS IS A PLACEHOLDER, NOT A PRIVACY POLICY.
//
// CLAUDE.md §21.3: "Get a lawyer before launch. Terms of Service, Privacy
// Policy, DPA, and the coach↔client data-controller relationship need real
// legal review. Nothing in this file is legal advice." COMPLIANCE.md CO§7
// gap 9 owns the real document — "Write + review · Counsel · Launch" — and
// that document replaces this page whole.
//
// The rule that keeps this page honest: **every sentence below is already
// written down somewhere else in the repo**, and cites where. Nothing here
// invents a retention period, a legal commitment, a Grievance Officer
// (COMPLIANCE.md CO§7 gap 5 — none is designated), or a compliance claim
// under DPDP / GDPR / CCPA. If a claim cannot be sourced it is not on the
// page, which is why "how long we keep things" and "who to write to" are
// both absent rather than approximated.
//
// Split from `page.tsx` for the same reason `guardian-consent`'s states
// are: `page.tsx` imports CSS and Jest cannot parse it, so the markup has
// to live where a test can render it.

import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="pv-glyph" aria-hidden="true">
      {children}
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
      <Glyph>{glyph}</Glyph>
      <div>
        <span className="pv-fact-title">{title}</span>
        <p className="pv-fact-body">{children}</p>
      </div>
    </li>
  );
}

export function PrivacyContent() {
  return (
    <main className="pv-page">
      <div className="pv-ambient" aria-hidden="true">
        <div className="pv-bloom pv-bloom-a" />
        <div className="pv-bloom pv-bloom-b" />
      </div>

      <div className="pv-wrap">
        <div className="pv-mark">
          <span className="pv-mark-badge" aria-hidden="true">
            <span />
          </span>
          <span className="pv-mark-name">CoachOS</span>
        </div>

        {/* The first thing the page says is what it is. */}
        <section className="pv-hero">
          <span className="pv-status" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M13 6.6v7.6" stroke="#FF8A9B" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="13" cy="18.6" r="1.4" fill="#FF8A9B" />
            </svg>
          </span>
          <p className="pv-eyebrow">Privacy</p>
          <h1 className="pv-h1">This page is a placeholder</h1>
          <p className="pv-lede">
            The full CoachOS privacy policy is being written and has not been reviewed by a lawyer
            yet. Until it is here, this page says only what is already decided and written down
            &mdash; and nothing more.
          </p>
        </section>

        <div className="pv-card pv-card-tint">
          <p className="pv-fine">
            <span className="pv-strong">Read this as a summary, not as the policy.</span> It is not
            a contract, it is not complete, and it will be replaced before CoachOS launches.
          </p>
        </div>

        {/* CLAUDE.md §21.1's three data classes, in a parent's words. */}
        <section>
          <h2 className="pv-h2">What CoachOS holds</h2>
          <div className="pv-card">
            <ul className="pv-facts">
              <Fact
                title="Account details"
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
                Name, email address, date of birth, and timezone.
              </Fact>

              <Fact
                title="Coaching data"
                glyph={
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 8.4l2.4-3 2 2.2 1.6-2.4L10 8.4"
                      stroke="#FFA586"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              >
                Training plans, logged workouts, food logs, body measurements, and any injuries a
                client records.
              </Fact>

              <Fact
                title="What a client sends their coach"
                glyph={
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect
                      x="1"
                      y="2.4"
                      width="10"
                      height="7.2"
                      rx="2"
                      stroke="#FFA586"
                      strokeWidth="1.2"
                    />
                    <path d="M5 5.2l2.4 1.4L5 8z" fill="#FFA586" />
                  </svg>
                }
              >
                Messages, comments, voice notes, form-check videos, and progress photos on an adult
                account.
              </Fact>

              <Fact
                title="Operational records"
                glyph={
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect
                      x="1.4"
                      y="1.4"
                      width="9.2"
                      height="9.2"
                      rx="2"
                      stroke="#FFA586"
                      strokeWidth="1.2"
                    />
                    <path d="M3.6 6h4.8" stroke="#FFA586" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                }
              >
                App version, device type, and counts of what happened &mdash; the things needed to
                keep the app working.
              </Fact>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="pv-h2">What we don&rsquo;t do</h2>
          <div className="pv-card">
            <ul className="pv-points">
              <li>
                We do not sell personal data, and we do not share it for advertising. CoachOS
                carries no advertising at all.
              </li>
              <li>
                We do not record anyone&rsquo;s screen, and we collect no advertising identifier.
              </li>
              <li>
                A client&rsquo;s coaching data is visible to their coach. It is not visible to other
                coaches or to other clients.
              </li>
              <li>CoachOS is not a medical service and gives no medical advice.</li>
            </ul>
          </div>
        </section>

        {/* CLAUDE.md §21.5. The reason a guardian is reading this at all. */}
        <section>
          <h2 className="pv-h2">If the account belongs to someone under 18</h2>
          <div className="pv-card">
            <ul className="pv-points">
              <li>
                Progress photos are absent from the account. The feature is not there, rather than
                switched off.
              </li>
              <li>
                Product analytics and AI processing are off, and cannot be turned on from inside the
                app.
              </li>
              <li>The account does not start at all until a parent or guardian confirms.</li>
              <li>
                A confirmed parent or guardian can ask us to export or delete the account&rsquo;s
                data at any time.
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="pv-h2">Whose data it is</h2>
          <div className="pv-card">
            <p className="pv-fine">
              A client&rsquo;s data belongs to the client, not to their coach. If a client stops
              working with a coach, the coach loses access to anything new; the client keeps their
              history.
            </p>
          </div>
        </section>

        {/* No address is invented here. COMPLIANCE.md CO§7 gap 5: no
            Grievance Officer is designated and no contact address is
            published, so the page says exactly that. */}
        <section>
          <h2 className="pv-h2">Reaching us</h2>
          <div className="pv-card">
            <p className="pv-fine">
              CoachOS has no published contact address yet &mdash; publishing one, and naming the
              person responsible for privacy questions, is part of the work that produces the full
              policy.
            </p>
            <p className="pv-fine">
              Until then, the coach named in the email or invitation that brought you here is the
              fastest route: they can raise anything with us on your behalf.
            </p>
          </div>
        </section>

        <p className="pv-fine">
          Indian, EU and Californian privacy law all apply to CoachOS. The full policy is being
          written against them, and reviewed by a lawyer, before launch. This page will be replaced
          by it.
        </p>
      </div>
    </main>
  );
}
