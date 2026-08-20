# PILOT-PLAYBOOK.md — the 10-coach ship gate

> **`CLAUDE.md` §23's Phase 1 gate in operational form:**
> *"10 real coaches, 3+ real clients each, running 2 weeks with no WhatsApp fallback for
> workout feedback."*
>
> That is 10 coaches and 30+ clients using the product daily, for two weeks, with their real
> livelihoods attached. It does not happen because the build is ready. It happens because
> somebody recruited them, onboarded them, watched them, and asked the right questions — and
> that work has no phase in the plan tree, which is why it has this document.
>
> **Budget three weeks of your own time.** Not evenings — the pilot is the job for that
> period.

---

## PI§0. What the gate actually measures

Read the wording again: *no WhatsApp fallback for workout feedback.* The gate is not "the app
works". It is **"the app replaced the thing it exists to replace."**

That distinction changes what you measure. A coach can log into CoachOS every day, love the
dashboard, and still send the actual coaching over WhatsApp because the video feedback is
slower there. That is a **failed** pilot with excellent engagement metrics.

| The gate is passed when | Not when |
|---|---|
| Coaches give feedback **in** CoachOS | Coaches open CoachOS daily |
| Clients get feedback **in** CoachOS | Clients log workouts |
| The WhatsApp thread goes quiet for training | The WhatsApp thread mentions the app |

---

## PI§1. Timeline

| Week | Phase | What happens |
|---|---|---|
| **−4** | Recruit | Reach 30 candidates, secure 15 commitments |
| **−2** | Prepare | Onboard the first 3 as a rehearsal. Fix what breaks. |
| **−1** | Onboard | The remaining coaches. Each gets a live call. |
| **1–2** | Run | Daily monitoring, structured check-ins, fast fixes |
| **+1** | Decide | Exit interviews, gate assessment, go / no-go |

**Recruit 15 to run 10.** Attrition is normal and not a signal of failure: people get busy,
a client drops out, someone changes their mind. Ten *finishing* is the gate.

---

## PI§2. Recruiting

### PI§2.1 Who

The pilot coach profile, in priority order:

1. **5–20 online clients.** Fewer and they have no volume to test with; more and they will
   not risk their operation on a beta.
2. **Currently using WhatsApp + spreadsheets.** They must feel the pain the product removes.
   A coach on Trainerize is evaluating a competitor, not living the problem.
3. **Programming and reviewing weekly.** A coach who sends a PDF monthly will not exercise
   the core loop at all.
4. **Reachable directly** — you can message them and they reply. A pilot needs a real
   channel, not a support inbox.
5. **Mixed markets.** Aim for roughly half India, half elsewhere. `CLAUDE.md` §15.6 ships two
   currencies and two markets; a pilot from one of them tests half the product's assumptions.

**Actively avoid:** friends who will be nice about it, coaches with under 3 clients, anyone
who wants to resell or white-label it (they evaluate differently), and anyone whose main
question is pricing.

### PI§2.2 Where

| Channel | Approach |
|---|---|
| Instagram DMs | The main channel. Coaches live there. Personal message, never a template. |
| Existing network | Ammar's own coaching contacts, and their referrals |
| Reddit — r/personaltraining, r/weightroom | Participate first, ask later. A cold pitch gets removed. |
| Local gyms (India) | In person. Highest conversion, lowest volume. |
| Coaching communities / Discords | Ask the moderator before posting. |

### PI§2.3 The ask

Honest and specific. Do not sell a finished product:

> "I'm building something to replace the WhatsApp-plus-spreadsheets stack for online coaches.
> It's early — you'd be one of ten coaches using it for two weeks, and I'd be fixing things
> daily while you do. Free during the pilot and for six months after. I need about 30 minutes
> to set you up, and 10 minutes at the end of each week to tell me what's broken. Interested?"

**What they get, in writing:**
- Free during the pilot, plus **6 months of Pro** afterwards
- Direct access to Ammar, not a support queue
- Their feedback visibly shaping the product
- A guaranteed, working data export whenever they want it — no lock-in

**What they must agree to:**
- 3+ real, active clients on the platform
- Two full weeks
- A 10-minute weekly call
- Reporting bugs when they happen, not at the end
- Trying to **not** use WhatsApp for workout feedback (and telling you honestly when they do)

The last one is the gate. Say it explicitly at recruitment, because it is the behaviour
change being measured.

---

## PI§3. Onboarding

**Every coach gets a live 30-minute call. No exceptions, no self-serve.** You are not
providing white-glove service; you are watching where they get stuck, which is the single
highest-value observation of the entire pilot.

| Minutes | What |
|---|---|
| 0–5 | Their setup today: how they program, how they get videos, where feedback lives |
| 5–15 | **They install and sign up while you watch, in silence.** Do not help. Write down every hesitation. |
| 15–25 | They build one real program and invite one real client, again while you watch |
| 25–30 | The rules, the channel, the weekly call slot |

**Silence during minutes 5–25 is the technique.** Every time you jump in to help, you destroy
the data point. Write down where they paused, what they tapped first, what they expected to
happen. That list is worth more than the whole weekly survey.

### PI§3.1 Client onboarding is the coach's job

**Do not onboard the clients yourself.** If a coach cannot get their own clients onto the
platform, the product does not work — that is a finding, not an obstacle to route around.
Give the coach a short message template they can adapt, and watch how many clients actually
activate.

**Client activation rate is the most honest number in the pilot.**

---

## PI§4. Running it

### PI§4.1 Daily

| Check | Threshold for acting |
|---|---|
| Sessions logged, by client | Any client at zero for 3 days → ask the coach why |
| Feedback given, by coach | Any coach at zero for 2 days → call them |
| Crashes (Sentry) | Any crash affecting a pilot user → same-day fix |
| Failed outbox items (`sync_failed`) | Any occurrence → investigate immediately. This is the E§1 class. |
| Support messages | Reply within 2 hours during the pilot |

### PI§4.2 The weekly 10 minutes

Same five questions, every coach, every week. Consistency is what makes the answers
comparable:

1. **"What did you do in WhatsApp this week that you'd rather have done in CoachOS?"**
   *The gate question. Ask it first, every time.*
2. "What took longer than it should have?"
3. "What did a client say about it?"
4. "What did you avoid using because you weren't sure how it worked?"
5. "If I switched it off tomorrow, what would you actually miss?"

Question 4 surfaces discoverability problems that no analytics event can. Question 5
separates the features that matter from the ones that demo well.

### PI§4.3 Capture

One document per coach, updated after every contact: what they said (verbatim where it
matters), what they did (from analytics), and what you changed because of it. **Verbatim
quotes are the most valuable artefact of the pilot** — they become the marketing copy, the
prioritisation argument, and the thing you re-read when you have lost the plot in month
seven.

Ship fixes **during** the pilot, visibly, and tell the coach who reported it. A coach who
sees their complaint fixed in two days becomes an advocate; one who sees nothing move stops
reporting.

---

## PI§5. Deciding

### PI§5.1 The gate

| Criterion | Pass |
|---|---|
| Coaches finishing both weeks | **≥ 10** |
| Clients per coach, active | **≥ 3** |
| **Workout feedback given in CoachOS, not WhatsApp** | **≥ 80% of coaches say yes** |
| Coaches who would keep using it | ≥ 8 of 10 |
| Coaches who would pay | ≥ 5 of 10 |
| Unresolved data-integrity bugs | **0. Non-negotiable.** |

The third row is the gate as `CLAUDE.md` §23 words it. The last row overrides everything: a
single unexplained duplicate workout or lost set blocks the gate regardless of how happy
everyone is, because it is the failure that destroys trust permanently
(`ARCHITECTURE-ESSENTIALS.md` E§1).

### PI§5.2 If it fails

Failing the gate is a normal, useful outcome. **Do not extend the pilot to make it pass** —
an extended pilot measures your persistence, not the product.

| Failure | Read it as |
|---|---|
| Coaches used it, kept WhatsApp for feedback | The core loop is too slow or too hidden. Fix the loop, re-pilot the same coaches. |
| Coaches dropped out in week 1 | Onboarding or first-run. Watch three more onboardings before changing anything. |
| Clients never activated | The invite flow, or the coach could not sell it internally. Watch a real invite land on a real client's phone. |
| Everyone liked it, nobody would pay | A pricing or positioning problem, not a product one. Do not rebuild. |
| Data-integrity bug | Stop. Fix. Re-pilot. Nothing else matters. |

### PI§5.3 Exit interview

30 minutes, every coach, whether they finished or not — especially if they did not.

1. Walk me through your last week, day by day.
2. What did you stop using after the first few days, and why?
3. What did you tell other coaches about it?
4. What would make you pay ₹1,999 / $49.99 a month for this?
5. What should I have asked you that I didn't?

Question 3 is the real word-of-mouth test. Question 5 has produced the most useful answer in
more than one pilot.

---

## PI§6. Before you start

- [ ] `phase-26-trust-and-safety/support-tooling/` shipped — otherwise you support 10 coaches
  by guessing (`SUPPORT.md`)
- [ ] The diagnostic bundle works (`support-tooling/04`) — it is how you debug their phones
- [ ] Sentry alerting on, filtered to pilot user IDs
- [ ] A tested Postgres restore (`ARCHITECTURE-ESSENTIALS.md` E§37e). **You are about to hold
  10 real businesses' data.**
- [ ] Data export works, and you have told coaches it does
- [ ] A direct channel per coach — WhatsApp is fine here, and the irony is fine too
- [ ] Every coach has your phone number
- [ ] Three weeks of your time actually cleared

---

*Companions: `CLAUDE.md` §23 (the gate) · `SUPPORT.md` · `ANALYTICS.md` (the numbers you'll
watch) · Owner: Ammar · Last updated: 16 August 2026*
