# COPY.md — CoachOS

> **Every word the product says, and the two hard constraints behind them.**
>
> This is not a style preference document. Two of its rules are compliance requirements
> (`CLAUDE.md` §21.3) and one of them is the difference between a product a discouraged
> client keeps opening and one they delete.
>
> It exists because copy is written in **twenty-seven phases by whoever is building that
> screen**, and one slip in a push notification is the one that gets screenshotted.
>
> `ERRORS.md` ER§0.1 owns error copy specifically and defers to this file for everything
> else.

---

## CO§0. The one-sentence rule

> **CoachOS reports facts and relays the coach's judgement. It never has a judgement of its
> own.**

Almost every rule below is a corollary. When you are unsure whether a line is acceptable, ask
which of three things it is doing:

| The line… | Verdict |
|---|---|
| Describes what happened | ✓ Always fine |
| Attributes a judgement to the coach | ✓ Fine — the coach is the qualified party |
| Asks the user something | ✓ Fine |
| Makes a judgement of its own | ✗ Rewrite |

---

## CO§1. The medical constraint

`CLAUDE.md` §21.3: *"We are not a medical service. Copy must never diagnose, prescribe, or
promise outcomes."*

This sounds obvious and is violated constantly, because the natural phrasing for a fitness app
is the forbidden one. These are not hypotheticals — every left-hand column is a sentence
someone would write without thinking.

### CO§1.1 Never diagnose

Do not tell a user what their data means about their body or health.

| ✗ Never | ✓ Instead | Why |
|---|---|---|
| "Your recovery is poor this week" | "You logged 2 of 5 sessions this week" | The first is a clinical assessment |
| "You're overtraining" | "Your volume is up 40% from last week" | Overtraining is a diagnosis |
| "This weight is unhealthy for your height" | *(say nothing — we do not compute BMI or comment on it)* | Diagnosis **and** harm |
| "Your sleep is affecting your performance" | *(say nothing — we have no sleep data and no causal claim)* | Invented causation |
| "You may be under-eating" | "You logged 1,200 kcal against a 2,000 target" | The number is a fact; the conclusion is not ours |

### CO§1.2 Never prescribe

Do not tell a user what to do with their body. Their coach does that.

| ✗ Never | ✓ Instead |
|---|---|
| "You should deload this week" | "Your coach suggested a deload" *(only if they did)* |
| "Take a rest day" | "No session scheduled today" |
| "Increase your protein" | "Protein: 90g of your 140g target" |
| "Train through it" / "Stop if it hurts" | *(never — injury guidance is out of scope entirely)* |
| "Try 3 sets of 10" *(AI-generated)* | "Your coach's draft: 3×10. Review before sending." |

> **The AI assistant is the highest-risk surface in the product for this rule.** An LLM asked
> to summarise a client's week produces prescriptive, diagnostic language *by default*. P23's
> guardrail prompt must be derived from this section, every output must be labelled
> AI-generated, and the coach must approve before the client sees it — which is already the
> design (`phase-23-ai-assistant/`). This file is where the language rules that prompt
> encodes actually live.

### CO§1.3 Never promise an outcome

| ✗ Never | ✓ Instead |
|---|---|
| "Lose 5kg in 6 weeks" | "Track your weight over time" |
| "Get stronger fast" | "Log every set. Your coach sees it all." |
| "Transform your body" | "Coaching that actually reaches your phone" |
| "Guaranteed results" | *(never, anywhere, including marketing)* |

**This applies to the marketing site and store listings too**, not just in-app copy. A promise
on the App Store page is a promise from the product.

### CO§1.4 The standing disclaimer

`CLAUDE.md` §21.3 requires it at onboarding and in settings. It is one short paragraph, in
plain language, and it is **not** a wall of legal text nobody reads:

> CoachOS is a tool for you and your coach. It isn't medical advice, and it can't diagnose or
> treat anything. If something hurts or doesn't feel right, talk to a doctor.

Third sentence included deliberately. A disclaimer that only protects us is worse than one
that also tells the user something useful.

---

## CO§2. The no-shame rule

The second constraint, and the one that decides whether a discouraged client opens the app
tomorrow.

**A client using this product may be tired, injured, behind on their programme, or
embarrassed about a week they'd rather not look at. The product never adds to that.**

| ✗ Never | ✓ Instead |
|---|---|
| "You missed 3 workouts" | "3 of 5 sessions logged" |
| "Streak broken!" | "Back to it — today's session is ready" |
| "You haven't logged food in 3 days — this will slow your progress" | "No meals logged since Tuesday" |
| "Don't give up!" | *(say nothing — cheerleading from software reads as hollow)* |
| "You're falling behind" | *(never — this is the coach's conversation, not ours)* |
| "0% complete" | "Nothing logged yet" |

**Three specific patterns to avoid:**

1. **Loss framing.** "3 of 5 logged" and "you missed 2" are the same fact; only one of them
   is an accusation.
2. **Streaks as pressure.** P18's habits feature already carries a no-shame rule. Streaks may
   be shown; a *broken* streak is never announced, never mourned, never given a sad state.
3. **Motivational voice.** We are not a coach. The coach is the coach. Encouragement from
   software is at best noise and at worst patronising to someone having a hard week.

> **The asymmetry that makes this a design rule and not a preference:** the coach app can be
> blunt, because a coach reviewing 30 clients needs signal density and "off-track" is a
> professional judgement they are qualified to make. The client app cannot, because the client
> is the person the judgement is about. **The same underlying fact gets different words on the
> two sides of the product.**

---

## CO§3. Voice, by role

One product, two audiences with different jobs (`CLAUDE.md` §1.1).

| | Coach app | Client app |
|---|---|---|
| Register | Professional peer | Plain and calm |
| Density | Dense. Abbreviate freely. | Sparse. One idea per line. |
| Jargon | Full vocabulary — RPE, RIR, 1RM, tempo, deload | Only what their coach already uses with them |
| Length | Fits the information | As short as it can be and still be clear |
| Tone toward the other party | Neutral and factual about clients | Never editorialise about the coach |
| Read in | A 20-minute review block | 30 seconds, mid-set, one-handed |

**Client-app copy is read by someone holding a barbell.** Reading level, line length, and
first-word choice all follow from that. Put the noun first: "Set 3 of 4", not "You are now on
set 3 of 4".

---

## CO§4. Surface rules

### CO§4.1 Empty states

Every list has one, with one primary action (`ui-conventions`). The formula: **state the fact,
offer the single next step.** No apology, no exclamation mark, no illustration carrying the
message.

| Surface | ✓ |
|---|---|
| No clients yet | "No clients yet." → *Invite your first client* |
| No session today | "Nothing scheduled today." → *Log something anyway* |
| No food logged | "No meals logged today." → *Add a meal* |
| No messages | "No messages yet." | *(no action — starting a conversation isn't a task)* |
| Nobody blocked | "You haven't blocked anyone." | *(no action — there is nothing desirable to promote)* |

### CO§4.2 Notifications

Read on a lock screen, out of context, possibly hours later.

- **Say who and what.** "Priya commented on your squat" — not "You have a new comment."
- **Never a health value, a food name, or a body metric.** A lock screen is public
  (`CLAUDE.md` §21.1).
- **Never guilt.** "You haven't logged today" is a notification that gets notifications
  disabled — permanently, and then coach feedback never arrives again (`ARCHITECTURE-ESSENTIALS.md`
  E§18).
- One notification per event. Never a digest that reads as nagging.

### CO§4.3 Destructive actions and confirmations

- The undo toast states **what** was undone: "Set deleted" → *Undo*.
- A confirmation sheet states the **consequence**, not the action. "This ends your coaching
  relationship" — not "Are you sure?"
- Never "Are you sure?" alone. It asks the user to guess what happens.
- Blocking, archival, and deletion each get consequence-specific copy — see
  `phase-26-trust-and-safety/blocking-and-filtering/03` for the five-case example.

### CO§4.4 Billing and paywall

- Live prices from StoreKit, never hardcoded (§15.7) — which means **copy must not contain a
  price**. "From $19.99/mo" in a headline breaks in India.
- State the limit factually: "You're at 10 clients on your plan." Not "Upgrade to unlock more
  clients!"
- Never imply the client is affected by the coach's tier. They are not (§15.4), and saying so
  invents a pressure that does not exist.
- A seat-limit banner is persistent and non-modal, and **never nags** (§15.5).

### CO§4.5 Safety and moderation

- Enforcement notices state the action, the reason, the duration, and the appeal route — in
  that order, in plain language.
- Never moralise. "Your account is suspended until 20 August for harassment. You can appeal."
  Not a lecture about community standards.
- **Never confirm a block exists** to the blocked party (`ERRORS.md` ER§2.2).
- Report confirmation makes a specific promise: "We review every report within 24 hours."
  That sentence is a commitment the queue must keep (`reporting/03`).

---

## CO§5. Mechanics

| Rule | Example |
|---|---|
| Sentence case everywhere, including buttons | "Invite client", not "Invite Client" |
| No exclamation marks | Zero. The product is calm. |
| Numerals for all numbers | "3 sets", not "three sets" |
| Units in the user's preference, formatted by `packages/utils` | Never hardcode "kg" in a string (DB§5.1.1) |
| Dates relative within a week, absolute beyond | "Tuesday" · "12 Aug" |
| Second person for the user, first name for the other party | "Your coach" / "Priya" |
| No em-dash-heavy sentences in the client app | Short sentences instead |
| Never "just", "simply", "easy" | They shame the person for whom it wasn't |
| Never "Oops", "Uh oh", "Whoops" | Errors are not cute |
| No placeholder text ever shipped | "Lorem ipsum" in a release is a bug |

**Localisation readiness.** All user-facing strings go through one extraction path from day
one, even while English-only (`CLAUDE.md` §27 defers Hindi). Extraction is cheap now and
expensive at phase 20. Never concatenate sentence fragments — grammar differs — and never
assume text length; Hindi and German both run longer than English.

---

## CO§6. Review checklist

Copy is reviewed like code. For any PR adding user-facing text:

- [ ] Does any line diagnose, prescribe, or promise an outcome? (CO§1)
- [ ] Would a client having a bad week feel judged by it? (CO§2)
- [ ] Right register for the role it appears in? (CO§3)
- [ ] Any health value, food name, or personal name on a lock screen? (CO§4.2)
- [ ] Any hardcoded price, currency symbol, or unit? (CO§4.4, CO§5)
- [ ] Does every error say what to do next? (`ERRORS.md` ER§0.1)
- [ ] Sentence case, no exclamation marks, no "just"/"simply"?
- [ ] Legible at 200% text size without truncating the important line?
- [ ] Extracted for localisation, not concatenated?

---

## CO§7. Where copy lives

| Surface | Owner |
|---|---|
| Error messages | `ERRORS.md` — the catalogue is the source of truth |
| Empty, loading, forbidden states | The `ui-conventions` skill + the owning task |
| Notifications | `phase-15-notifications/notification-types/` |
| Onboarding | `phase-06-onboarding/` |
| Paywall | `phase-20-billing-and-entitlements/paywall/` |
| Moderation notices | `phase-26-trust-and-safety/moderation-operations/02`, `/03` |
| Consent notices | `COMPLIANCE.md` CO§2 — **legally specified, not free-form** |
| Marketing site and store listings | `apps/web` + `phase-22-release-engineering/store-submission/` |
| AI-generated output | `phase-23-ai-assistant/ai-guardrails/` — its prompt encodes CO§1 |

**Consent notices and legal disclaimers are the exception to this file's authority.** Their
wording is constrained by statute (`COMPLIANCE.md`), and "improving" them can invalidate the
consent. Do not edit them for tone.

---

*Companions: `ERRORS.md` (error copy) · `ui-conventions` skill (where copy sits) ·
`CLAUDE.md` §21.3 (the legal posture this enforces) · `COMPLIANCE.md` (the copy this file
does not govern) · Owner: Ammar · Last updated: 16 August 2026*
