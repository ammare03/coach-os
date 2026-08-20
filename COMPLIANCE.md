# COMPLIANCE.md — CoachOS

> **What three privacy regimes actually require us to *build*, as distinct from what they
> require us to *write*.**
>
> `CLAUDE.md` §21.3 names India's **DPDP Act 2023**, the EU's **GDPR**, and California's
> **CCPA/CPRA** as applicable, and says to treat health-adjacent data as special-category by
> default. This file turns that posture into a checklist with owners.
>
> ⚠️ **Nothing here is legal advice.** §21.3 says get a lawyer before launch and that is
> load-bearing. The purpose of this document is to make that conversation cheap: bring
> counsel a working system and a gap list, not a blank page.

---

## CO§0. The short answer

**No, it is not just a privacy policy.** Roughly two-thirds of the obligations are
operational or product work:

| Kind | Count | Examples |
|---|---|---|
| **Build** | 4 | Granular consent capture, data export, consent withdrawal, minor handling |
| **Designate** | 1 | A named Grievance Officer, published, reachable |
| **Write and rehearse** | 2 | The breach process, the records of processing |
| **Publish** | 3 | Privacy policy, consent notices, retention schedule |

**Three of the four build items are now owned by the plan tree** — minor handling
(`phase-03-.../auth-server/07`), deletion (`.../account-lifecycle/04`), and data export
(`.../account-lifecycle/09`–`/12`). The one that remains unowned is **granular consent
capture**, which is now the single largest gap in this document.

---

## CO§1. What applies, and why all three

| Regime | Applies because | Sharpest requirement |
|---|---|---|
| **DPDP Act 2023** (India) | India is a primary market with its own currency track (§15.6) | Itemised consent; Grievance Officer; the nomination right |
| **GDPR** (EU/UK) | Any EU coach or client | Lawful basis; Article 9 special-category data; DPIA |
| **CCPA/CPRA** (California) | US market | Right to know, delete, and opt out of "sale/sharing" |

**Health data is the reason all three bite harder than they otherwise would.** Body metrics,
injuries, progress photos, and food logs are special-category under GDPR Article 9 and
sensitive under DPDP. Our own classification (`DATABASE.md` DB§18) already treats them that
way — the compliance work is largely about *proving* it, not changing it.

> **We do not sell or share personal data**, and we never will (`CLAUDE.md` §1.2 — not a
> marketplace, not an ad product). That single fact removes most of CCPA's hardest
> obligations. It must remain true and must be stated plainly in the policy.

---

## CO§2. Consent — the biggest build item

DPDP requires consent that is **free, specific, informed, unconditional, and unambiguous**,
with a notice **itemised by purpose**. One "I agree to the Privacy Policy" checkbox does not
satisfy it.

### CO§2.1 The purposes, separated

Each is consented to independently. Refusing an optional one must not degrade the core
service — that is what "unconditional" means.

| Purpose | Required? | Existing mechanism |
|---|---|---|
| Account and coaching delivery | Required — refusing means not using the product | — |
| **Health and body data** (metrics, injuries) | Required for coaching, itemised separately | — |
| **Progress photos** | **Optional.** Coaching works without them. | Absent entirely for minors (§21.5) |
| **Nutrition logging** | Optional | — |
| Push notifications | Optional | `notification_preferences` |
| Product analytics | Optional | `users.analytics_opt_out` |
| **AI processing** | Optional | `users.ai_processing_opt_out` |
| Health-store export | Optional, device-level | `phase-24-health-sync/` |

**Four of the eight already have a mechanism.** The gap is the notice, the record, and
separating the first four.

### CO§2.2 What must be recorded

Consent is only defensible if you can show what was agreed, to what wording, and when. That
means a `consent_records` table: user, purpose, granted/withdrawn, timestamp, the **version
of the notice text** shown, and locale.

> **Versioning the notice text is the part that gets skipped.** If the notice changes, prior
> consents were given to different words. Without a version reference you cannot show what
> anyone actually agreed to — which is precisely what a regulator asks for.

### CO§2.3 Withdrawal must be as easy as granting

DPDP is explicit. If it is one tap to grant, it is one tap to withdraw, in the same place, at
the same weight — not buried, not behind a support email, not with a guilt-trip confirmation
(`COPY.md` CO§2).

And withdrawal must **actually stop the processing**. Withdrawing AI consent means prompts
stop being built (already the design in `phase-23-ai-assistant/ai-infrastructure/03`).
Withdrawing photo consent means no new photos and existing ones become deletable.

### CO§2.4 Language

DPDP requires the notice to be available in **English and the 8th Schedule languages**.
Realistically: English at launch, Hindi before meaningful Indian volume. This is the concrete
reason `CLAUDE.md` §27's localisation question has a deadline attached to it rather than being
open-ended, and why `COPY.md` CO§5 requires string extraction from day one.

---

## CO§3. Data subject rights

| Right | DPDP | GDPR | CCPA | Deadline | Status |
|---|---|---|---|---|---|
| **Access / know** | ✓ | ✓ | ✓ | 30 days | ✓ `phase-03-.../account-lifecycle/09`–`/12` |
| **Portability** (machine-readable) | — | ✓ | — | 30 days | ✓ Same tasks |
| **Correction** | ✓ | ✓ | ✓ | 30 days | ✓ Users edit their own data |
| **Erasure** | ✓ | ✓ | ✓ | 30 days | ✓ `phase-03-.../04-transactional-purge.md` |
| **Withdraw consent** | ✓ | ✓ | — | Immediate | ⚠️ Partial (CO§2.3) |
| **Opt out of sale/sharing** | — | — | ✓ | — | ✓ N/A — we don't |
| **Grievance redressal** | ✓ | — | — | Defined | ⚠️ **No officer designated** |
| **Nomination** | ✓ | — | — | — | ✓ `.../account-lifecycle/12` — recorded, honoured manually |

### CO§3.1 Data export — now owned

**Owner: `phase-03-identity-and-auth/account-lifecycle/`, tasks 09–12.** Product phase 1,
blocking P22.

| Task | Delivers |
|---|---|
| 09 | The `data-export` job, the archive format, role-aware contents |
| 10 | `me.requestExport`, `export_requests`, rate limits, the 30-day legal floor |
| 11 | Settings → Your data — request, progress, download, history |
| 12 | Guardian, operator, and nominee paths |

Required by DPDP, GDPR (twice — access *and* portability), CCPA, and both app stores; promised
to pilot coaches as the anti-lock-in guarantee (`docs/PILOT-PLAYBOOK.md` PI§2.3); and
depended on by `phase-26-trust-and-safety/moderation-operations/03`'s "a suspended user can
still export" criterion.

**Two rules from those tasks worth restating here**, because both are compliance properties
rather than implementation details:

- **A coach's export contains the coach's data, not their clients'.** Clients are separate
  data subjects with their own rights. A coach exporting 40 clients' photos and food diaries
  would be a disclosure dressed up as a data right.
- **No delegated export accepts a delivery address.** Guardian, operator, and nominee paths
  all deliver to the subject or a verified delegate — never to whoever asked. A destination
  parameter turns this into an exfiltration path with a plausible pretext.

### CO§3.2 Nomination — the uniquely Indian one

DPDP lets a user nominate someone to exercise their rights if they die or become
incapacitated. Nothing in GDPR or CCPA has an equivalent, so it is easy to miss entirely.

**Owned by `.../account-lifecycle/12`:** a nominee name and email on the user record, plus a
documented manual runbook for verifying a claim. **Deliberately not automated** — acting on a
nomination means someone has died or lost capacity, and the verification is a death
certificate or a power of attorney reviewed by a human. Automating that is both impossible to
do safely and a route to a devastating fraud. The right must *exist* and be honoured; it does
not have to be self-service.

---

## CO§4. Children's data

DPDP requires **verifiable parental consent** for under-18s and **prohibits outright**
behavioural monitoring and targeted advertising directed at children. GDPR Article 8 sets its
own age threshold (13–16 by member state).

This is why `CLAUDE.md` §21.5 forces analytics and AI off for minors and makes it
un-enableable in-app. **That is not caution — it is the statute**, and it is the one place
where a "let the user choose" design would be unlawful rather than merely unwise.

| Requirement | Status |
|---|---|
| Verifiable parental consent before processing | ✓ `phase-03-.../auth-server/07` — blocked until consented |
| No behavioural monitoring of children | ✓ Analytics forced off, un-enableable |
| No targeted advertising | ✓ We have no advertising at all |
| Guardian can exercise rights on the child's behalf | ✓ Export and deletion, per §21.5 |
| Under-13 refused | ✓ `AGE_BELOW_MINIMUM` |
| "Verifiable" is genuinely verifiable | ⚠️ Email confirmation is our standard. Document it as a deliberate proportionality decision, as with self-declared age. |

---

## CO§5. Records of processing

GDPR Article 30 requires a record of processing activities. It is a document, not code, and it
is mostly a transcription of things this repo already states.

| Section | Source |
|---|---|
| What we collect and why | `DATABASE.md` DB§18 classification table |
| Lawful basis per purpose | CO§2.1 above |
| Who it is shared with | `ARCHITECTURE.md` A§2.1 — RevenueCat, LiveKit, Expo Push, Resend, PostHog, Sentry, Cloudflare |
| International transfers | Same table, plus each processor's region |
| Retention periods | `DATABASE.md` DB§19 + the tier retention table (§15.2) |
| Security measures | `CLAUDE.md` §21.2 |

**Each third party needs a Data Processing Agreement.** All seven publish standard DPAs;
signing them is an afternoon of admin, and doing it before launch is far easier than
retrofitting during a review. Note that DPDP's cross-border rules are permissive by default
(transfers allowed except to countries the government restricts), which is the current
position and worth re-checking before launch.

---

## CO§6. Breach notification

**Build this before you have data, not after a breach.**

DPDP requires notification to the **Data Protection Board *and* every affected user**, with
**no materiality threshold** — small breaches are reportable too. GDPR sets 72 hours to the
supervisory authority. Timelines are tight and the clock starts at *awareness*, not at
diagnosis.

The process, which lives in `docs/runbooks/` alongside the P5 alert
(`OBSERVABILITY.md` OB§5.2):

1. **Preserve first.** Logs, `audit_log`, and the affected records — before touching anything.
   `SUPPORT.md` SU§7 already says treat a "saw someone else's data" report as a live breach
   until disproven.
2. **Assess.** What data, how many people, which jurisdictions.
3. **Contain.** Revoke, patch, rotate.
4. **Notify the authorities** within each regime's window.
5. **Notify users** — in plain language, per `COPY.md` CO§1's honesty standard, without
   minimising.
6. **Record it.** Even a contained near-miss.

> The step that fails in practice is **1**. The instinct on discovering a leak is to fix it
> immediately, which destroys the evidence you need for steps 2 and 4. The runbook exists to
> override that instinct at the moment it is strongest.

---

## CO§7. The gap list

Everything above, as work. **This is the section to act on.**

| # | Gap | Kind | Owner | Before |
|---|---|---|---|---|
| 1 | ~~Data export~~ — **owned**: `phase-03-.../account-lifecycle/` 09–12 | Build | P03 | Launch. Blocks store submission and the pilot promise. |
| 2 | **Granular consent capture** + `consent_records` with notice versioning | Build | New feature in P03 or P06 | Launch |
| 3 | **Consent withdrawal parity** — as easy as granting, and it actually stops processing | Build | P03 `account-lifecycle` | Launch |
| 4 | ~~Nomination right~~ — **owned**: `.../account-lifecycle/12` | Build (small) | P03 | Indian launch |
| 5 | **Grievance Officer** — named, published in-app and on the site, with a response window | Designate | Ammar | Indian launch |
| 6 | **Breach runbook** | Write | `docs/runbooks/P5-*` | Before real user data — i.e. before the pilot |
| 7 | **Records of processing** (Art. 30) | Write | `docs/` | Launch |
| 8 | **DPAs with all seven processors** | Admin | Ammar | Launch |
| 9 | **Privacy policy, ToS, consent notice text** — describing what the code actually does | Write + review | Counsel | Launch |
| 10 | **Retention schedule published** | Write | Derived from DB§19 | Launch |
| 11 | **Hindi consent notice** | Write | — | Meaningful Indian volume |

**Items 2 and 6 still need engineering time; item 1 is now specified and waiting to be built.** The rest are documents,
designations, and admin — real work, but not build work.

`.claude/plan/phase-22-release-engineering/legal-and-compliance/` already covers the policy
documents and the store privacy labels. It does **not** cover items 2–5, which are product
features rather than release artefacts. Item 1 is owned by P03.

---

## CO§8. What we already do well

Worth stating, because it is what makes the gap list short and it should not be regressed:

- **Data minimisation by design.** No location, no contacts, no ad IDs, no session recording,
  no third-party OAuth tokens (the wearables removal deleted the database's only encrypted
  columns).
- **Purpose limitation is architectural.** Health data never enters analytics, logs, or AI
  prompts — enforced by types (`ANALYTICS.md` AN§1) and by classification (DB§18), not by
  policy.
- **Deletion actually deletes.** A transactional purge across five schemas and R2
  (DB§19.2), with one deliberate, documented carve-out.
- **Health integration is write-only** (`ARCHITECTURE.md` AI-15). We cannot leak health data
  we never receive.
- **Support cannot read user content** (`SUPPORT.md`), which is a stronger internal control
  than most companies our size have or claim.
- **Clients own their data**, and it survives leaving a coach
  (`phase-03-.../06-client-leaves-coach.md`).

Several of these are things a regulator would expect to have to ask for. Being able to point
at the mechanism rather than the intention is the whole value of having written them down.

---

*Companions: `CLAUDE.md` §21 · `DATABASE.md` DB§18, DB§19 · `SUPPORT.md` ·
`OBSERVABILITY.md` OB§5 (the breach runbook) · `COPY.md` CO§7 (consent copy is not
tone-editable) · Owner: Ammar · Last updated: 16 August 2026 ·
**Reviewed by counsel: not yet.***
