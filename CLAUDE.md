# CLAUDE.md — CoachOS

> **Single source of truth for what this repository _is_ and _why_.**
> `DATABASE.md` owns every byte of persisted state. `.claude/plan/` owns _when_ each
> thing gets built and what "done" means for it, down to PR-sized tasks. This file
> owns the product, the stack, the money, and the decisions nothing else should own.
> If code and this file disagree, this file is wrong — fix it in the same PR that
> changed the code.

---

## 0. How to use this file

**If you are an AI agent working in this repo:**

1. Read this entire file before writing code.
2. Work from **`.claude/plan/`**. Every feature in this product is already
   decomposed into phase → feature → task documents there — find the lowest-numbered
   task whose dependencies are done, read it end to end, load the skills it names,
   then build. This file no longer carries feature-level detail; the plan tree does.
3. Check §3 (Stack) before adding any dependency; check the `code-conventions` skill
   before writing any code.
4. Check `DATABASE.md` before touching the DB. Never invent a column.
5. Check `ARCHITECTURE.md` before adding a container, a queue, a cache, or a flow that
   crosses three or more of them — and `ARCHITECTURE-ESSENTIALS.md` before cutting
   anything under time pressure. The invariants in `ARCHITECTURE.md` §A14 are binding.
6. Run `pnpm check` before declaring work complete. It must exit 0.
7. If a requirement is ambiguous, **ask** — do not guess and do not silently invent a
   product decision. Product decisions belong to Ammar.
   7a. **Before writing any code for a screen a trainer or client will see, stop and load the
   `design-gate` skill.** Alert Ammar, wait for him to run `/design`, and build to his
   inputs. Design decisions belong to Ammar exactly as product decisions do.
8. Do not refactor unrelated code "while you're in there." One PR, one concern.

**Hard rules that override everything else:**

- No `any` in committed TypeScript. Use `unknown` + a narrowing guard.
- **Every weight is stored in kilograms.** `users.weight_unit` is display only; conversion
  happens at the edges in `packages/utils` and nowhere else (`DATABASE.md` DB§5.1.1).
- No secrets in the repo. Ever. See the `configuration` skill.
- No direct DB access from the mobile app. All reads/writes go through the API.
- No new third-party service without an entry in §3 and a cost note in §22.
- **Free over paid, always.** If a free or open-source option covers the scope, use
  it. If none exists, justify the cheapest adequate paid option in §3.4 first.
- Do not write to `main`. Feature branches + PR only.
- **No user-facing screen is built before it is designed.** See rule 7a and the
  `design-gate` skill.

### 0.1 Where things live

This file used to carry the full feature spec, API shape, navigation map, and every
coding convention inline. It no longer does — each moved to the one place that owns
it, so it can be kept current without dragging the other 1,200 lines along. If a
section number below is missing from this file, this is where it went. (Gaps in the
numbering are intentional — a moved section's number is retired, not reused.)

| Was                                                      | Now lives in                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| §5 Data model                                            | `DATABASE.md` — the authoritative DDL, always was                                                     |
| §6.1, 6.3–6.5 API shape, errors, validation, rate limits | `api-conventions` skill                                                                               |
| §7 Design system                                         | `DESIGN-SYSTEM.md` (values) + `ui-conventions` skill (rules) + `.claude/plan/phase-04-design-system/` |
| §8 Feature specifications                                | `.claude/plan/` — every AC preserved verbatim in its task document                                    |
| §9 Navigation map                                        | `UI-UX.md` §UX1 + `.claude/plan/phase-05-app-shell/`                                                  |
| §10 State management                                     | `code-conventions` skill                                                                              |
| §11 Offline strategy                                     | `offline-sync` skill                                                                                  |
| §12 Media pipeline                                       | `.claude/plan/phase-11-media-pipeline/`                                                               |
| §13 Realtime                                             | `.claude/plan/phase-14-messaging-and-realtime/`                                                       |
| §14 Notifications                                        | `.claude/plan/phase-15-notifications/`                                                                |
| §16 Environment & configuration                          | `configuration` skill                                                                                 |
| §17 Coding conventions                                   | `code-conventions` + `git-workflow` skills                                                            |
| §18 Testing                                              | `testing` skill                                                                                       |
| §23 phase-by-phase feature lists                         | `.claude/plan/README.md` (ship gates still live here, below)                                          |

**The two architecture documents** are new companions rather than extractions from this
file:

| Document                     | Owns                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARCHITECTURE.md`            | The _shape_ of the system — containers, topology, the seven critical flows, caching, failure modes, and the binding architecture invariants (§A14)                                                                                                                                          |
| `ARCHITECTURE-ESSENTIALS.md` | The load-bearing subset of that architecture — what breaks, and how badly, if a given mechanism is missing. Read it before deciding what to defer.                                                                                                                                          |
| `ANALYTICS.md`               | The event dictionary — every event, its properties, and the type-level privacy guardrail. §20 here owns the policy; that file owns the contract.                                                                                                                                            |
| `ERRORS.md`                  | The closed error catalogue — machine code, transport code, user-facing copy, and recovery action for every failure a user can reach                                                                                                                                                         |
| `SUPPORT.md`                 | How we help a user whose data we are not permitted to read — the four access tiers, the closed list of safe operations, and the trust & safety escalation path                                                                                                                              |
| `OBSERVABILITY.md`           | What we record, what has a threshold, the five things that page, and the runbook for each                                                                                                                                                                                                   |
| `COPY.md`                    | Every word the product says — the never-diagnose/prescribe/promise rules (§21.3 in operational form) and the no-shame rule                                                                                                                                                                  |
| `COMPLIANCE.md`              | DPDP / GDPR / CCPA turned into a build-vs-write gap list with owners                                                                                                                                                                                                                        |
| `DESIGN.md`                  | **The visual system, and the authority.** Palette, type, density, the five-level elevation ladder, the three glass tiers, motion, the semantic warmth ramp, and the RN port notes — every value a literal from the thirteen built prototype screens (`DESIGN.dc.html`, `CoachOS-*.dc.html`) |
| `DESIGN-SYSTEM.md`           | **Superseded on palette and type by `DESIGN.md`.** Its _structure_ rules — page patterns, density intent, copy law — still hold and are restated in `DESIGN.md` §10                                                                                                                         |
| `UI-UX.md`                   | Page composition — the navigation model, the six page patterns, the data-fetching contract, error isolation, and the performance playbook                                                                                                                                                   |
| `docs/screens/`              | Ten hero screens specified with wireframes and data contracts; every other route assigned to a pattern                                                                                                                                                                                      |
| `docs/PILOT-PLAYBOOK.md`     | How the §23 ship-gate-1 pilot actually gets run — recruiting, onboarding, the weekly questions, and the go/no-go                                                                                                                                                                            |

#### 0.1.1 Retired-section redirect — read this if a `§N` reference dead-ends

The `.claude/plan/` tree was written while sections 5, 7–14, and 16–18 still lived in this
file. **It contains ~1,950 references to those numbers**, and they no longer resolve here.
They were not rewritten because the reference is almost always accompanied by the requirement
restated inline, and 1,950 context-sensitive edits would introduce more errors than they fix.

**So: when a task says `§8.4` and this file has no §8, resolve it here.**

| Retired ref                         | Read instead                                                     |
| ----------------------------------- | ---------------------------------------------------------------- |
| `§5`, `§5.1`–`§5.8`                 | `DATABASE.md` — the same subsection numbers, prefixed `DB§`      |
| `§7`, `§7.1`–`§7.5`                 | `DESIGN-SYSTEM.md` for values · `ui-conventions` skill for rules |
| `§8.1` Dashboard · `§8.2` Adherence | `.claude/plan/phase-10-coach-review-surfaces/`                   |
| `§8.3` Programs                     | `.claude/plan/phase-07-exercise-and-program-authoring/`          |
| `§8.4` Workout logger               | `.claude/plan/phase-09-workout-logger/`                          |
| `§8.5` Onboarding / clients         | `.claude/plan/phase-06-onboarding/`                              |
| `§8.6` Media · `§8.7` Check-ins     | `phase-11-media-pipeline/` · `phase-17-structured-checkins/`     |
| `§8.8` Messaging · `§8.9` Live      | `phase-14-messaging-and-realtime/` · `phase-19-live-sessions/`   |
| `§8.10` Habits/metrics · `§8.11` AI | `phase-18-habits-metrics-photos/` · `phase-23-ai-assistant/`     |
| `§8.12` (was wearables)             | **Superseded.** `phase-24-health-sync/` — write-only export, §27 |
| `§8.x` anything else                | The phase that owns that feature (`.claude/plan/README.md` §5)   |
| `§9`, `§9.1`–`§9.3`                 | `UI-UX.md` §UX1 (navigation model) + `phase-05-app-shell/`       |
| `§10` State management              | `code-conventions` skill                                         |
| `§11` Offline strategy              | `offline-sync` skill + `DATABASE.md` DB§13–14                    |
| `§12` Media pipeline                | `phase-11-media-pipeline/`                                       |
| `§13` Realtime                      | `phase-14-messaging-and-realtime/`                               |
| `§14`, `§14.1`–`§14.2`              | `phase-15-notifications/`                                        |
| `§16`, `§16.1`                      | `configuration` skill                                            |
| `§17`, `§17.1`–`§17.5`              | `code-conventions` + `git-workflow` skills                       |
| `§18`, `§18.3`                      | `testing` skill (§18.3 = the authorisation enumeration test)     |

**Sections that DO still live here** and mean what a task expects: §1–§4, §6, §15, §19–§27.
A `DB§`, `A§`, `E§`, `UX§`, `DS§`, `CO§`, `ER§`, `AN§`, `SU§`, or `OB§` prefix always points
at another document, never at this one.

**When you edit a task that carries a dead `§N`**, replace it with the correct pointer from
the table above in that same PR. The count goes down over time without a risky bulk rewrite.

---

**Full skill list (18):**
`design-gate` · `git-workflow` · `code-conventions` · `screen-composition` · `ui-conventions` ·
`api-conventions` · `db-migrations` · `offline-sync` · `configuration` · `testing` ·
`frontend-performance` · `accessibility` · `security-and-privacy` · `product-copy` ·
`release-ops` · `observability-ops` · `analytics-events` · `trust-and-safety` —
all installed at `.claude/skills/<name>/SKILL.md`. Roster by role:
`.claude/skills/README.md`.

**Plugins (use as and when required, alongside the skills above):** `bug-echo` and
`prompter` are installed globally and are fair game in this repo whenever the task
at hand calls for what they do — debugging/bug-report capture for `bug-echo`,
prompt drafting/refinement for `prompter`. Neither replaces a project skill above;
reach for one only when it's actually the tool for the moment, not by default.

---

## 1. Product overview

**CoachOS** is a mobile-first SaaS platform for online fitness coaches and their
clients. It replaces the fragmented stack (WhatsApp + Google Meet + spreadsheets +
Google Drive) that online coaches currently use.

**The core problem:** an online coach cannot see, in one place, whether a client
trained, what they ate, how their form looked, and how they feel — so feedback is
slow, generic, and delivered over WhatsApp where it gets lost.

**The core promise:** everything a coach needs to review a client's week lives on
one screen, and every piece of feedback the coach gives is attached to the exact
thing it is about (this set, this meal, this video, at this timestamp).

### 1.1 Two apps, one codebase

|                    | Coach app                      | Client app                     |
| ------------------ | ------------------------------ | ------------------------------ |
| Primary job        | Review, program, give feedback | Log, upload, receive feedback  |
| Session length     | Long (10–30 min review blocks) | Short (30s–3 min, mid-workout) |
| Design bias        | Information density            | One-thumb, gym-floor legible   |
| Network assumption | Wi-Fi / good signal            | Gym basement, bad signal       |

Both ship from **one Expo project** with role-based routing
(`.claude/plan/phase-05-app-shell/`). We do **not** maintain two apps. Divergence is
handled by route groups and a `role` check, never by forking components.

### 1.2 Non-goals (v1)

Write these down so nobody rebuilds them by accident:

- ❌ Not a marketplace. We do not match clients to coaches.
- ❌ Not a social network. No public feed, no follower graph.
- ❌ Not a gym management system. No door access, no class booking, no POS.
- ❌ Not a medical device. We never diagnose, never give medical advice.
- ❌ No web client app in v1. Coaches get a thin web dashboard in Phase 3 only.
- ❌ No Android TV / tvOS / watchOS.

---

## 2. Personas & jobs-to-be-done

**Coach (primary buyer, primary user).** 5–60 online clients. Earns $1.5k–$15k/mo.
Currently spends 2–4 hrs/day on admin. Jobs:

- "Show me who is off-track this week, before my Sunday check-in block."
- "Let me watch this squat video and tell them exactly what to fix."
- "Let me change Tuesday's session for 12 clients without opening 12 chats."

**Client (user, not buyer).** Trains 3–6×/week. Jobs:

- "Tell me what to do today, in the gym, without reading a PDF."
- "Log this set in under 5 seconds while my hands are chalked."
- "Did my coach see my video? What did they say?"

**Assistant coach (Phase 3, Studio+).** A main ("root") trainer delegates a subset of
their clients to one or more assistant coaches — real, semi-independent coaches who
program, review, and message their assigned clients day to day, exactly as if those
clients were their own. The root retains full visibility into everything every
assistant does and reassigns clients between themself and their assistants at will;
an assistant sees only the clients directly assigned to them, never the root's own
clients or a sibling assistant's. Assistants have no billing access and cannot
themselves take on assistants (one level of delegation only). Full spec:
`.claude/plan/phase-25-white-label-and-teams/team-seats-and-roles/`. Jobs:

- "Run my own clients day to day, the way I would if I were the primary coach."
- (For the root) "See what my team is doing with my clients without asking them for
  a screenshot."

**Gym admin (Phase 3, organisation plan).** A gym — a business, not a person — subscribes
so that the coaches who work there use CoachOS under the gym's name. The admin is a new
`user_role` (`'org_admin'`), never a coach or client: they hold the gym's billing, generate
single-use join codes that attach a root coach to the organisation, and see a roster of
attached coaches with their active-client **counts** — never a client's name, log, media,
or message. Attached coaches keep their own client books and their P25 hierarchy; the gym
is an umbrella that carries entitlements and a brand, not an ownership edge into client
data. Full spec: `.claude/plan/phase-28-gym-organisations/`. Jobs:

- "Put my whole floor on one app, on one invoice, under my gym's name."
- "Know how many clients each of my coaches is carrying, without reading anyone's file."
- (For the coach) "Show my clients I'm with this gym, and stop paying for my own plan."

---

## 3. Tech stack — pinned decisions

> **Adding a dependency requires updating this table.** If it isn't here, it isn't
> in the project.

### 3.1 Mobile app

| Concern                 | Choice                                                                                                                                                                                         | Why / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework               | **Expo SDK 57** (managed, with CNG)                                                                                                                                                            | Current stable as of Aug 2026. Pin via `npx expo install --fix`; never hand-edit RN/React versions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Language                | **TypeScript 6.x**, `strict: true`                                                                                                                                                             | The repo ships TS 6 with Expo SDK 57. Pinned to what is installed, not to 5.x. See `code-conventions` skill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Router                  | **expo-router** (file-based, typed routes on)                                                                                                                                                  | Deep links + push routing come free                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Native tooling          | **CNG (Continuous Native Generation)**                                                                                                                                                         | `ios/` and `android/` are gitignored and regenerated by `npx expo prebuild`. All native config via config plugins in `app.config.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Dev builds              | **expo-dev-client**                                                                                                                                                                            | Expo Go is **not** sufficient — LiveKit and RevenueCat need custom native code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Styling                 | **NativeWind v4** (Tailwind for RN)                                                                                                                                                            | Shared token vocabulary with the future web dashboard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Animation               | **react-native-reanimated 4.x** + `react-native-worklets` + `react-native-gesture-handler`                                                                                                     | Required by bottom sheets, video scrubber. **v4 is a breaking change from v3** — worklets are a separate package and most tutorials online are v3. Check the version before trusting an example.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Bottom sheets           | `@gorhom/bottom-sheet`                                                                                                                                                                         | The workout logger and the comment composer are sheets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lists                   | **FlashList v2**                                                                                                                                                                               | Long workout histories, food diaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Server state            | **TanStack Query v5**                                                                                                                                                                          | Cache, retry, optimistic updates, offline persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Query persistence       | **@tanstack/query-persist-client-core** (5.102.0, pinned to the same line as `@tanstack/react-query`)                                                                                          | The read cache survives an app restart (`offline-sync` skill; 24h `maxAge`). The core package, not `@tanstack/react-query-persist-client`: the React wrapper only adds `PersistQueryClientProvider`, and `providers-and-gates/02` starts the restore at module scope so it races the first render rather than waiting on a provider. Free, MIT, TanStack Query's own package — no second cache library (§3.4.1 step 2). Added `providers-and-gates/02`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Client state            | **Zustand**                                                                                                                                                                                    | Only for UI state: active rest timer, draft logger state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Forms                   | **react-hook-form** + **Zod** resolver                                                                                                                                                         | Zod schemas are shared with the API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Video playback          | **expo-video**                                                                                                                                                                                 | `expo-av` is deprecated; do not use it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audio (voice notes)     | **expo-audio**                                                                                                                                                                                 | Same reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Camera                  | **expo-camera**                                                                                                                                                                                | Form-check capture + barcode scanning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Media picker            | **expo-image-picker**                                                                                                                                                                          | Gallery uploads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Haptics                 | **expo-haptics**                                                                                                                                                                               | Exactly three sanctioned triggers — `Light` on set logged, `Success` on session complete, `Warning` on validation failure — and nowhere else (`ui-conventions` §5). Imported in exactly one file: `packages/ui/src/haptics/index.ts`, which exposes those three by name and no generic `triggerHaptic`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Files/uploads           | **expo-file-system** (new object API)                                                                                                                                                          | Resumable uploads, progress, `AbortSignal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Images                  | **expo-image**                                                                                                                                                                                 | Built-in caching, blurhash placeholders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Liquid Glass            | **expo-glass-effect** + **expo-blur**                                                                                                                                                          | The hybrid: real Liquid Glass on iOS 26+; `expo-blur` with the tier gradient overlaid on Android and iOS < 26; the fully opaque elevation model under Reduce Transparency or Increase Contrast. `DESIGN.md` §4 defines the three tiers and §12 the port. Both packages are imported in exactly one file — `packages/ui/src/surfaces/GlassSurface.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Gradients               | **expo-linear-gradient**                                                                                                                                                                       | `DESIGN.md` §2 makes every card a 180° gradient and §4 makes every glass tier a 158° one. RN has no CSS gradient; this is the only way to render either.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Icons                   | **lucide-react-native**                                                                                                                                                                        | Cross-platform parity — SF Symbols are iOS-only. `DESIGN.md` §13: an icon never travels alone in navigation, always icon plus label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Canvas drawing / charts | **@shopify/react-native-skia** (2.6.2, what `npx expo install` resolves for SDK 57) — **and no charting library**                                                                              | Arcs and paths: `ProgressRing`, `MacroBar`'s siblings, and `LineChart`/`Sparkline`, all hand-drawn. §7.4 originally pinned **victory-native**; `ui-primitives-data/04` did not install it and the row now records why. victory-native ≥41 renders through Skia anyway, and the parts of it we would use — the y-domain and the gap rule — are exactly the parts `chartDomain.ts` has to own, because both are product decisions with tests, not defaults. What was left was axis layout and a `CartesianChart` wrapper too heavy for a 100-row list. §3.4.1 step 2 and step 3: adopting it adds a dependency for less code than it removes. **Revisit only** if a later phase needs stacked areas, brushing, or a shared-y multi-panel chart. §3.4.1: Skia is free, MIT, no bill at any volume. **Native: dev-client rebuild, never an OTA (§25.11).** ⚠️ `react-native-svg` stays for four icon sites; `MacroBar` uses neither. |
| Local DB                | **expo-sqlite** + **Drizzle ORM**                                                                                                                                                              | Offline workout logging (`offline-sync` skill). Installed ahead of P08 by `providers-and-gates/02`, which opens its own `coachos-query-cache.db` for the TanStack Query persister; `phase-08-offline-core/local-database` consolidates the two connections. Drizzle arrives with P08 — the persister uses one hand-written key/value table and needs no ORM. **Native: dev-client rebuild, never an OTA (§25.11).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Secure storage          | **expo-secure-store**                                                                                                                                                                          | Tokens only. Never PII.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Apple Sign In           | **expo-apple-authentication**                                                                                                                                                                  | `social-sign-in/01`. Apple's own native button component; `ios.usesAppleSignIn: true` in `app.config.ts` adds the entitlement — the package ships no config plugin of its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Google Sign In          | **expo-auth-session** (`providers/google`)                                                                                                                                                     | `social-sign-in/02`. OIDC authorization-code + PKCE flow, exchanged on-device — reuses `expo-web-browser` and needs no separate native SDK/config plugin, unlike `@react-native-google-signin/google-signin` (rejected, §3.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CSPRNG (Apple nonce)    | **expo-crypto**                                                                                                                                                                                | `social-sign-in/01`'s per-attempt nonce (`randomUUID()`) — Apple echoes it back unhashed in the identity token, matching the server verifier's direct comparison.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Request correlation IDs | **uuidv7** (pinned 1.2.1)                                                                                                                                                                      | Device-generated `X-Request-Id` (`observability/05-request-correlation.md`). Same package `apps/api`/`packages/db` already use for row ids (DB§21) — one ID scheme, not a second one. No Node builtin dependency, so it bundles through Metro unmodified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Notifications           | **expo-notifications**                                                                                                                                                                         | Push via EAS + APNs/FCM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Health export           | **expo-health** (HealthKit) / `react-native-health-connect`                                                                                                                                    | Phase 3 only. **Write scopes only** — CoachOS writes completed workouts out to Apple Health / Health Connect and never reads health data back (`.claude/plan/phase-24-health-sync/`). Requesting a read scope is a §27 decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Live video              | **LiveKit React Native SDK**                                                                                                                                                                   | WebRTC SFU                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Payments                | **RevenueCat**                                                                                                                                                                                 | StoreKit + Play Billing + entitlements + webhooks. Coach subscriptions are IAP (§15.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Analytics               | **PostHog**                                                                                                                                                                                    | Product analytics + feature flags in one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Crash/errors            | **Sentry** (`@sentry/react-native`)                                                                                                                                                            | Source maps uploaded in EAS build hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Testing                 | **Jest** + **@testing-library/react-native**; **Maestro** for E2E; **Testcontainers** (`testcontainers` npm pkg) for real-Postgres tests in `packages/db`/`apps/api` — added `derived-data/03` | See `testing` skill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Seed data               | **@faker-js/faker** (`packages/db` devDependency) — deterministic (`faker.seed(42)`) realistic data for `pnpm db:seed` — added `seed-and-fixtures/01`                                          | Free, OSS, MIT. Row ids use a hand-rolled UUIDv5 (Node's built-in `crypto`, no new dependency) keyed on stable strings, never the schema's own uuidv7 default, so `pnpm db:seed` is byte-identical across machines (DB§21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lint/format             | **ESLint** (`eslint-config-expo`) + **Prettier**                                                                                                                                               | Enforced in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 3.1.1 Template leftovers to remove

The repository was bootstrapped from the stock Expo template, and two of its dependencies
conflict with decisions made elsewhere in this file. **`phase-00-repository-foundation/workspace-scaffold/03-strip-template.md`
removes them**; they are listed here so the conflict is on the record rather than discovered
mid-build.

| Installed      | Conflict                                                                                                   | Action |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| `@expo/ui`     | §3.1 builds primitives in `packages/ui`; a second component library guarantees two ways to render a button | Remove |
| `expo-symbols` | SF Symbols are iOS-only; `DESIGN-SYSTEM.md` DS§7 pins **Lucide** for cross-platform parity                 | Remove |

`expo-web-browser`, `expo-linking`, and `react-native-web` **stay** — the first two are used
by auth and deep linking, and `react-native-web` is what lets the component gallery
(`phase-04-design-system/component-gallery/`) run in a browser.

**`expo-glass-effect` also stays**, and is now a pinned dependency (§3.1) alongside
`expo-blur`. It was on this removal list until Liquid Glass was adopted; `DESIGN.md` §4 now
defines the three tiers and where each may be used, and §12 defines the React Native port —
including the faked inset hairlines, without which the effect collapses. `DESIGN-SYSTEM.md`
DS§10's rejection of emulated glassmorphism is superseded: `DESIGN.md` is a glass-forward
system, and the blur path is a designed tier, not an approximation. The rules that survive are
the two in §4: never nest glass inside glass, and never put glass over a chart.

### 3.2 Backend

| Concern              | Choice                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | **Node 22 LTS**                                                  |                                                                                                                                                                                                                                                                                                                                                                                 |
| Framework            | **Hono** on Node adapter                                         | Small, fast, runs on Node and edge                                                                                                                                                                                                                                                                                                                                              |
| API layer            | **tRPC v11**                                                     | End-to-end types; no OpenAPI codegen needed for our own client                                                                                                                                                                                                                                                                                                                  |
| Wire transformer     | **superjson** (pinned to 1.x, not the current 2.x)               | Lets `Date` cross the wire as a real `Date`, not an ISO string every call site re-parses (`api-conventions` §10). 2.x is ESM-only with no CJS build, which ts-jest's CommonJS transpile (`jest.node.js`) can't load — 1.x still ships one. Added `api-scaffold/01`.                                                                                                             |
| DB                   | **PostgreSQL 16**                                                | Managed: Neon (dev) → AWS RDS (prod)                                                                                                                                                                                                                                                                                                                                            |
| ORM                  | **Drizzle ORM**                                                  | Same ORM on server and device — one mental model                                                                                                                                                                                                                                                                                                                                |
| Migrations           | **drizzle-kit**                                                  | Migrations are committed. Never edit an applied migration. See `db-migrations` skill.                                                                                                                                                                                                                                                                                           |
| Cache / queues       | **Redis** (Upstash) + **BullMQ**, client: **ioredis** 5.11.1     | Video transcode jobs, digest emails, notification fanout. One request-path client (`apps/api/src/lib/redis.ts`); BullMQ gets its own connection — see `rate-limiting/01`.                                                                                                                                                                                                       |
| Object storage       | **Cloudflare R2**                                                | S3-compatible, zero egress fees — critical for video (§22). `@aws-sdk/client-s3` is the one client (`apps/api/src/lib/storage/r2-client.ts`); `@aws-sdk/lib-storage` (streamed multipart upload) and `@aws-sdk/s3-request-presigner` (signed GET URLs) are the same official SDK family, added for the data-export archive (`account-lifecycle/09`) — never a second S3 client. |
| Video transcode      | **`ffmpeg` worker** (BullMQ)                                     | Free. Runs on the API host until CPU forces a split. Cloudflare Stream only if §3.4 gate is hit.                                                                                                                                                                                                                                                                                |
| Export archive (zip) | **`archiver`**                                                   | Free, OSS (MIT), streams a zip to a file rather than buffering it in memory — the account-data-export job's entire "don't OOM on a 2GB export" requirement (`account-lifecycle/09`). No lighter alternative covers streaming multi-file zip creation.                                                                                                                           |
| Auth                 | **`jose`** + our own Drizzle queries (self-hosted, no framework) | Email+password (Argon2id), Apple, Google. JWT access + rotating refresh. Reversed from Better Auth — see §3.3 and `apps/api/src/lib/auth/adoption.md` (`phase-03-identity-and-auth/auth-server/01`).                                                                                                                                                                            |
| Password hashing     | **`@node-rs/argon2`**                                            | Argon2id via Rust/napi-rs, prebuilt binaries for every platform this repo builds on — no node-gyp toolchain, no pure-JS fallback slow enough to tempt lowering the cost parameters. OWASP-minimum params (`auth-server/02`).                                                                                                                                                    |
| Email                | **Resend** + React Email templates                               |                                                                                                                                                                                                                                                                                                                                                                                 |
| Billing (coach subs) | **RevenueCat** → App Store / Play IAP                            | Stripe retained for the Phase-3 web dashboard and Agency invoicing only. See §15.7.                                                                                                                                                                                                                                                                                             |
| Realtime             | LiveKit (video) + WebSocket via Hono (presence, live comments)   |                                                                                                                                                                                                                                                                                                                                                                                 |
| Search               | Postgres full-text (`tsvector`)                                  | No Elasticsearch until it hurts                                                                                                                                                                                                                                                                                                                                                 |
| Error tracking       | **Sentry** (`@sentry/node` 10.70.0)                              | Server counterpart to mobile's `@sentry/react-native` — same free tier, §3.4.3. `observability/02-sentry-integration.md`.                                                                                                                                                                                                                                                       |
| Hosting              | **Fly.io** (API) + **Vercel** (marketing/web)                    |                                                                                                                                                                                                                                                                                                                                                                                 |
| CI                   | **GitHub Actions** + **EAS Build**                               |                                                                                                                                                                                                                                                                                                                                                                                 |

### 3.3 Explicitly rejected

Recorded so we don't relitigate:

- **Firebase** — vendor lock-in, painful relational modelling, expensive at video scale.
- **Supabase** — good, but we want Drizzle + our own auth session semantics; also RLS gets awkward with the coach↔client permission model.
- **Agora / Twilio Video** — LiveKit is cheaper and self-hostable if costs spike.
- **Redux Toolkit** — TanStack Query covers 90% of it; Zustand covers the rest.
- **Bare React Native CLI** — we lose EAS, OTA updates, and config plugins for no gain.
- **`@react-native-google-signin/google-signin`** — a second native module and config
  plugin for what `expo-auth-session`'s OIDC provider already does with packages already
  in the stack (`expo-web-browser`). Costs a system-browser hop instead of the native
  account picker; worth revisiting only if that UX gap earns a native module later
  (`social-sign-in/02`).
- **GraphQL** — tRPC gives us types without a schema layer we'd have to maintain.
- **Better Auth** — the original §3.2 pick, reversed in `phase-03-identity-and-auth/auth-server/01`.
  Its core schema hard-requires a boolean `user.emailVerified`, a URL `user.image`, and separate
  `account`/`session`/`verification` tables — none of which exist in `DATABASE.md` DB§5.1
  (`email_verified_at timestamptz`, `avatar_asset_id uuid` FK, `password_hash` on the user row,
  and `refresh_tokens` rotation families instead of an opaque session table). Confirmed against
  the library's own `getAuthTables` source, not assumed from docs. Adopting it would have meant
  either a migration DB§5.1 doesn't call for, or running two parallel and disagreeing models of
  "is this email verified" and "what is a session" — worse than not adopting it. Replaced by
  `jose` (JWT signing/verification, JWKS handling for Apple/Google) plus our own Drizzle queries —
  still free, still self-hosted, just not a framework. Full mapping table:
  `apps/api/src/lib/auth/adoption.md`.

### 3.4 Cost-first selection policy

> **This project is pre-revenue and self-funded. Spend is the constraint, not
> convenience.** Every paid line item must be defended. A tool that costs $0 and is
> 80% as good beats a tool that costs $40/mo and is perfect, until revenue says
> otherwise.

#### 3.4.1 The decision procedure

Run this in order, every time you are about to add a dependency or a service:

1. **Can we not do it?** The cheapest feature is the one we cut. Check §1.2 — is this
   actually in scope?
2. **Is it in the standard library / already-installed packages?** Do not add a
   library for something Postgres, Expo, or Node already does. No `lodash`, no
   `axios`, no `moment`, no date library beyond `date-fns`.
3. **Is there a free open-source option that covers our scope?** If yes, use it. Not
   "the best" option — the _adequate_ one. Self-hosting cost counts as cost: if
   running it needs a second server, it is not free.
4. **Is there a free tier that covers us to 500 coaches?** If yes, use it, and record
   the exact limit and the overage price in the table below so we are never surprised
   by a bill.
5. **Only then, paid.** Compare at least two options on: monthly cost at our expected
   Phase-2 volume, cost at 10× that volume, exit cost (how hard to migrate off), and
   whether it can be self-hosted later.
6. **Write the decision down** in the table below with the number that justified it.
   A paid service with no recorded justification gets removed at the next review.

**Never** pick a paid service because it has better docs, a nicer dashboard, or a
faster setup. Those are worth hours, not dollars, at this stage.

#### 3.4.2 Hard spend ceilings

| Phase                                  | Total infra + services ceiling                       |
| -------------------------------------- | ---------------------------------------------------- |
| Phase 1 (pre-launch, 0 paying coaches) | **$0/mo** — everything on free tiers. No exceptions. |
| Phase 2 (1–100 paying coaches)         | **$60/mo**, and only after MRR exceeds 5× that       |
| Phase 3 (100–500 coaches)              | ≤ 15% of MRR                                         |

If a build would breach the ceiling, the correct action is to **gate the feature**,
not to raise the ceiling. Live sessions and AI are the two features designed to be
gated for exactly this reason (§15.4).

#### 3.4.3 Free-tier audit — current stack

Every service we use, what its free tier actually gives us, and what we do when we
outgrow it. **Keep this table accurate.** It is the early-warning system for costs.

| Service                             | Free tier                                | Covers us to    | When exceeded                                                                                          |
| ----------------------------------- | ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| **Expo / React Native**             | Fully free, MIT                          | forever         | —                                                                                                      |
| **EAS Build**                       | ~30 builds/mo, low priority queue        | Phase 1–2       | `eas build --local` in GitHub Actions (free minutes) before paying $19/mo                              |
| **EAS Update (OTA)**                | Free tier of MAU                         | Phase 1–2       | Self-host `expo-updates` against R2 — the protocol is open                                             |
| **PostgreSQL (Neon)**               | 0.5GB, autosuspend                       | ~500 coaches    | Hetzner VPS + self-hosted Postgres (~$5/mo) beats every managed tier                                   |
| **Redis (Upstash)**                 | 500k commands/mo                         | Phase 1–2       | Run Redis in the same container as the API. It is one process.                                         |
| **Cloudflare R2**                   | 10GB storage, **$0 egress**              | ~Phase 1        | $0.015/GB/mo. Egress stays free — this is why R2 and not S3.                                           |
| **Video transcode (ffmpeg)**        | Free, OSS                                | until CPU-bound | Split the worker to its own cheap VPS. Cloudflare Stream only past ~2,000 videos/mo.                   |
| **LiveKit**                         | Cloud free tier ≈ 5k participant-min/mo  | Phase 2 pilot   | **Self-host the OSS SFU** on a VPS. This is the whole reason we chose LiveKit.                         |
| **`jose`**                          | Free, OSS (MIT)                          | forever         | — self-hosted JWT/JWKS, no per-MAU billing to outgrow (this is still why we rejected Auth0/Clerk)      |
| **Sentry**                          | 5k errors/mo, 1 user                     | Phase 1–2       | Self-hostable, but realistically stay on free and sample aggressively                                  |
| **PostHog**                         | 1M events/mo, cloud                      | Phase 1–3       | Event volume is controllable — cut low-value events before paying                                      |
| **Resend**                          | 3k emails/mo, 100/day                    | Phase 1–2       | Brevo (300/day free) or Amazon SES ($0.10/1k)                                                          |
| **Open Food Facts**                 | Free, open data, no key                  | forever         | — (this is why we rejected Nutritionix, which is $$$ per call)                                         |
| **USDA FoodData Central**           | Free, key required, 1k req/hr            | forever         | —                                                                                                      |
| **Maestro / Jest / ESLint**         | Free, OSS                                | forever         | —                                                                                                      |
| **Space Grotesk / Instrument Sans** | SIL Open Font License                    | forever         | — (never use a licensed font here). `DESIGN.md` §1.2: Space Grotesk counts, Instrument Sans speaks.    |
| **GitHub Actions**                  | 2,000 min/mo private                     | Phase 1–2       | Make the repo public, or self-hosted runner                                                            |
| **Fly.io / Railway / Render**       | Small free allowances                    | Phase 1         | **Hetzner CX22 VPS, ~€4/mo**, is cheaper than every PaaS free-tier upgrade                             |
| **RevenueCat**                      | Free under $2.5k monthly tracked revenue | Phase 1–2       | 1% of tracked revenue — only pay once it is earning. Note this is _on top of_ the store's 15% (§15.7). |

#### 3.4.4 Unavoidable costs

These have no free substitute. Budget for them; do not spend engineering time hunting
alternatives.

| Item                            | Cost                                         | Note                                                                                                                       |
| ------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program         | **$99/year**                                 | Required to ship to iOS at all. Non-negotiable.                                                                            |
| Google Play Developer           | **$25 one-time**                             | Non-negotiable.                                                                                                            |
| Domain + email                  | ~$15/year                                    | Cloudflare Registrar sells at cost.                                                                                        |
| **App Store / Play commission** | **15%** (Small Business Program / first $1M) | The largest single cost in the business. Apple's 15% rate requires **applying** — do it before first revenue (§15.7).      |
| Stripe                          | 2.9% + $0.30 per transaction                 | Phase-3 web dashboard and Agency invoices only. For India, compare **Razorpay** (2% domestic).                             |
| Anthropic API (Phase 3 only)    | usage-based, ~$0.01–0.05/summary             | Gated to Pro+ with a hard per-coach generation cap (§15.2), so it is revenue-covered by definition. Cache per client-week. |
| Push notifications              | **$0** via Expo/FCM/APNs                     | Listed here only so nobody "solves" it with OneSignal.                                                                     |

#### 3.4.5 Anti-patterns

Things that look free and are not, or that quietly create a bill:

- **Per-MAU auth** (Auth0, Clerk, Firebase Auth). Costs scale with the exact metric we want to grow. Rejected in §3.3 for this reason.
- **Per-seat dev tooling** where a free alternative exists. No paid Figma seats, no paid Linear, no paid Notion for a solo/two-person team.
- **Managed everything.** A single $5 VPS running Postgres + Redis + the API + the ffmpeg worker will comfortably serve the first 500 coaches. Managed services are worth it when uptime is worth more than cash — that is not yet true.
- **S3 egress.** Video egress on S3 would be the single largest line item in this product. R2 exists to make it $0.
- **Leaving a free trial running.** Every paid trial gets a calendar reminder to cancel 3 days before it converts.
- **AI on the free tier.** Claude API calls are the one cost that scales with usage and cannot be capped by architecture alone. Enforce a per-coach monthly generation cap server-side (Pro 100/mo, Studio 400/mo — §15.2); never expose AI on Starter or Coach.

#### 3.4.6 Review cadence

Audit every paid line item **monthly** against actual usage. Any service under 20%
utilisation of its paid tier gets downgraded or removed. Record the review in
`docs/cost-reviews/YYYY-MM.md`.

---

## 4. Repository structure

Monorepo, **pnpm workspaces** + **Turborepo**.

```
coachos/
├── apps/
│   ├── mobile/                 # Expo app (coach + client)
│   ├── api/                    # Hono + tRPC server
│   └── web/                    # Next.js marketing site + Stripe checkout + Phase-3 dashboard
├── packages/
│   ├── db/                     # Drizzle schema, migrations, seed scripts
│   ├── schemas/                # Zod schemas shared client↔server (SINGLE SOURCE for validation)
│   ├── ui/                     # Shared RN primitives (Button, Card, Sheet, Avatar…)
│   ├── config/                 # eslint, tsconfig, tailwind presets
│   └── utils/                  # Pure functions only. NO React, NO node builtins.
├── turbo.json
├── pnpm-workspace.yaml
└── CLAUDE.md                   # this file
```

`apps/mobile`'s internal shape (route tree, `src/features/` vertical slices, the
feature-folder promotion rule) lives in `.claude/plan/phase-00-repository-foundation/`
and `.claude/plan/phase-05-app-shell/` — those tasks build it, this file no longer
duplicates it.

---

## 6. API design

### 6.1 Shape → moved to the `api-conventions` skill.

### 6.2 Authorisation model

Three checks, applied in this order, in a tRPC middleware — **never inline in a
procedure**:

1. `isAuthed` — valid access token.
2. `hasRole(role)` — coach-only or client-only procedures.
3. `ownsResource` — the **critical** one. A coach may only touch resources belonging
   to a client where `client_profiles.coach_id = currentCoach.id`. A client may only
   touch their own.

> **Every procedure that takes a `clientId` MUST go through `ownsResource`.** This is
> the single most likely place for a catastrophic data leak. There is a test for it
> (`testing` skill, the authorisation enumeration test) that enumerates all
> procedures and fails if one is unguarded.

**Assistant coaches (Phase 3, §2) extend rule 3, not replace it.** A root coach's
ownership additionally reaches any client whose direct `coach_id` belongs to one of
_their_ assistants; an assistant's ownership never reaches the root's own clients or
a sibling assistant's. This is resolved by checking `coach_id = me OR coach_id IN
(coaches where parent_coach_id = me)` — one extra indexed lookup, not a walk up the
hierarchy — and it is implemented as an amendment to `ownsResource`'s existing
per-resource conditions, not a fourth check. See `DATABASE.md` DB§6.1 for the exact
resolution and `.claude/plan/phase-25-white-label-and-teams/team-seats-and-roles/`
for where it lands. Until that phase ships, every coach has no assistants and the
condition degrades to exactly rule 3 as stated above — nothing before Phase 3
depends on this extension existing.

### 6.3 Error handling → moved to the `api-conventions` skill.

### 6.4 Validation → moved to the `api-conventions` skill.

### 6.5 Rate limits → moved to the `api-conventions` skill.

---

## 15. Billing & subscriptions

### 15.1 Design principles

Read these before changing a number. The prices are provisional; the principles are not.

1. **The free tier must demonstrate the differentiator, not withhold it.** Video
   annotation and in-context feedback are the _reason_ a coach leaves WhatsApp.
   Gating them behind payment means a trialling coach never feels the thing they'd be
   paying for. **Free is limited by volume, not by capability.**
2. **Price on active clients.** It is the metric that correlates with both the
   coach's revenue and our infrastructure cost. It is legible — a coach can compute
   their bill without a calculator.
3. **No cliffs.** A coach going from 10 to 11 clients must not see their bill double.
   Seat packs (§15.3) fill the gaps between tiers.
4. **Never charge for growth we caused.** A one-time onboarding fee is the wrong
   shape — a client's cost to us (storage, transcode, live minutes) is recurring, not
   one-time. Seats are recurring; onboarding is free.
5. **India is priced in INR, the rest of the world in USD.** $50/mo is trivial for a
   US coach billing $250/client and punitive for an Indian coach billing ₹4,000/client.
   Same product, same limits, two currencies — and the INR number is set against Indian
   coaching income, not converted from the dollar one (§15.6).
6. **Annual is the goal.** It fixes cash flow, halves churn, and after 12 months
   Apple's cut drops. Every paid surface offers annual first.

### 15.2 Tiers

**Two currencies, one product.** CoachOS is priced in **₹ INR for coaches on the India
storefront** and in **$ USD for every other coach in the world**. The tiers, the limits,
and the features are identical in both — only the number changes. Which one a coach sees
is decided by their App Store / Play account country, not by us (§15.6).

All prices are **App Store / Play price points, per month, billed to the coach.**
Annual = **10× monthly** (2 months free).

|                                             | **Starter** | **Coach**  | **Pro**    | **Studio**    | **Agency** |
| ------------------------------------------- | ----------- | ---------- | ---------- | ------------- | ---------- |
| **Monthly — global (USD)**                  | Free        | **$19.99** | **$49.99** | **$99.99**    | Contact us |
| **Monthly — India (INR)**                   | Free        | **₹799**   | **₹1,999** | **₹3,999**    | Contact us |
| **Annual — global (USD)**                   | —           | $199.99    | $499.99    | $999.99       | Custom     |
| **Annual — India (INR)**                    | —           | ₹7,999     | ₹19,999    | ₹39,999       | Custom     |
| **Active clients**                          | 2           | 10         | 30         | 75            | Unlimited  |
| Extra seats                                 | ✗           | +5 seats   | +5 seats   | +5 seats      | included   |
| Storage                                     | 3 GB        | 25 GB      | 100 GB     | 250 GB        | 1 TB       |
| Video retention                             | 30 days     | 12 months  | 12 months  | 24 months     | 24 months  |
| Live minutes/mo                             | 60          | 300        | 1,000      | 3,000         | custom     |
| Programs & logging                          | ✓           | ✓          | ✓          | ✓             | ✓          |
| Nutrition & diary review                    | ✓           | ✓          | ✓          | ✓             | ✓          |
| **Video annotation**                        | **✓**       | ✓          | ✓          | ✓             | ✓          |
| **In-context comments**                     | **✓**       | ✓          | ✓          | ✓             | ✓          |
| Structured check-ins                        | ✓           | ✓          | ✓          | ✓             | ✓          |
| Health sync (Apple Health / Health Connect) | ✓           | ✓          | ✓          | ✓             | ✓          |
| Live 1:1 sessions                           | ✓ (capped)  | ✓          | ✓          | ✓             | ✓          |
| Live Workout Mode                           | ✗           | ✓          | ✓          | ✓             | ✓          |
| Group live rooms                            | ✗           | ✗          | ✓          | ✓             | ✓          |
| AI assistant                                | ✗           | ✗          | 100 gen/mo | 400 gen/mo    | custom     |
| White-label branding                        | ✗           | ✗          | ✗          | ✓             | ✓          |
| Additional coach seats                      | ✗           | ✗          | ✗          | 2             | unlimited  |
| Assistant/junior roles                      | ✗           | ✗          | ✗          | ✓             | ✓          |
| CoachOS badge on client app                 | shown       | shown      | removable  | removed       | removed    |
| Support                                     | community   | email      | email, 48h | priority, 24h | dedicated  |

> **"Additional coach seats" and "Assistant/junior roles" together are one feature**
> (§2's assistant-coach persona, fully specified in
> `.claude/plan/phase-25-white-label-and-teams/team-seats-and-roles/`): each coach
> seat is one assistant-coach account, invited by and delegated from the root. A
> client assigned to an assistant still counts against the **root's** client-seat
> limit above, never the assistant's — assistants have no client-seat limit of their
> own to check, because they have no subscription of their own (§15.7).

**Trial:** 14 days of **Pro**, via StoreKit introductory offer. Card required (the
store handles it), cancellable in one tap, reminder push at day 11. On expiry the
account drops to Starter — it never locks the coach out of their own data.

> **Why the entry tier is $19.99 and not $29.** The first paid tier is a conversion
> instrument, not a profit centre. At 15% store commission we net ~$17, against ~$2–3
> of infrastructure for a 10-client coach. The margin is fine and the lower number
> materially widens the top of the funnel. Extract value at Pro, where the coach is
> demonstrably earning from the product.

> **Why ₹799 and not ₹1,699 (the USD conversion).** An Indian online coach typically
> bills ₹3,000–₹6,000 per client per month. At ₹799 for ten clients, CoachOS costs
> roughly 2–3% of what that coach earns from the clients it manages — the same ratio
> the USD pricing represents for a US coach billing $200–250 per client. **The INR
> prices are not a discount on the USD prices; they are the same decision made against
> a different local income.** Converting the USD number would price the product at a
> fifth of an Indian coach's monthly revenue, which is not a pricing strategy, it is an
> exit.

### 15.3 Seat packs

Any paid tier can add **+5 active clients**, stackable up to 3 packs:

|                              | Global (USD) | India (INR) |
| ---------------------------- | ------------ | ----------- |
| **Seat pack, +5 clients/mo** | **$9.99**    | **₹399**    |

This exists to remove the cliff. A Coach-tier user at 13 clients pays $19.99 + $9.99
= $29.98 rather than jumping to $49.99 — or ₹799 + ₹399 = ₹1,198 rather than jumping
to ₹1,999. At 4 packs the next tier is always cheaper in both currencies, so the
upgrade sells itself and we never have to push it.

Implemented as a **separate auto-renewable subscription in its own subscription
group** so it stacks with the base tier rather than replacing it. The seat pack is one
product with two territory price points, exactly like the base tiers — never two
products.

### 15.4 What we gate, and why

| Gated                   | Reason                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| Active client count     | Correlates with coach revenue and our cost. The primary lever.          |
| Storage & retention     | Direct, unavoidable marginal cost (§22).                                |
| Live minutes            | Direct marginal cost; also the easiest thing to abuse.                  |
| AI generations          | Real per-call cost that architecture alone cannot cap (§3.4.5).         |
| White-label, team seats | Genuine enterprise features; no marginal cost, high willingness to pay. |

| **Never gated**                              | **Reason**                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Video annotation                             | It is the product. Gating it hides the wedge.                                                                  |
| In-context comments                          | Same. This is the core loop.                                                                                   |
| Structured check-ins                         | Cheap to serve, and it is what makes a coach's week work.                                                      |
| Offline logging                              | A client's ability to train is not a billing lever.                                                            |
| Health sync to Apple Health / Health Connect | Purely client-experienced, and it costs us nothing — the export is device-local and never touches our servers. |
| Data export                                  | Ethically non-negotiable (§21.3).                                                                              |

**Rule:** never gate anything the _client_ experiences. The client is not the buyer
and must never have a worse workout because their coach is on a cheaper plan. The
only client-visible tier difference is the CoachOS badge.

### 15.5 What counts as an "active client"

Billing depends on this, so it is defined precisely:

- **Active** = `client_profiles.status = 'active'`. Counted.
- **Invited** (not yet accepted) = counted against the limit, so a coach can't queue
  30 invites on a 10-seat plan.
- **Paused** and **archived** = not counted. A coach can pause a client mid-plan at no
  cost — this is common in real coaching and should never cost money.
- **Anti-gaming:** a client archived and reactivated within 30 days does not release
  their seat during that window.
- **Assigned to an assistant coach** (§2, Studio+) = still counted, against the
  **root's** limit. Delegating day-to-day coaching to an assistant does not move the
  client off the root's book for billing purposes — the root is who's paying.

Seat checks happen at **invite creation** and again at **invite acceptance**.

**Downgrade / overage behaviour:** existing clients are never cut off. A coach over
their limit keeps full access to current clients, cannot invite new ones, and sees a
persistent (non-modal, non-nagging) banner offering a seat pack or an upgrade. We do
not hold client data hostage. Ever.

### 15.6 Two currencies: INR for India, USD everywhere else

**The decision.** CoachOS ships exactly two price tracks:

| Track      | Who gets it                                                 | Currency                      | Set where                                   |
| ---------- | ----------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| **India**  | Coaches whose App Store / Play account country is **India** | **INR (₹)**                   | India territory price point                 |
| **Global** | Every other coach, in every other territory                 | **USD ($)** as the base price | Base price + store conversion per territory |

| Product                         | Global (USD) | India (INR) |
| ------------------------------- | ------------ | ----------- |
| Coach, monthly                  | $19.99       | ₹799        |
| Coach, annual                   | $199.99      | ₹7,999      |
| Pro, monthly                    | $49.99       | ₹1,999      |
| Pro, annual                     | $499.99      | ₹19,999     |
| Studio, monthly                 | $99.99       | ₹3,999      |
| Studio, annual                  | $999.99      | ₹39,999     |
| Seat pack (+5 clients), monthly | $9.99        | ₹399        |

**Why only two.** The previous plan had a third "~50% of USD" band for SEA, LatAm,
Africa, and Eastern Europe. It was dropped: three bands is three sets of price points
to maintain, three sets of screenshots and store copy to keep honest, and three
conversations every time a price moves — for territories that will not produce
meaningful revenue before Phase 3. India earns its own track because it is a primary
target market (§2), not because it is cheap. When a third market earns the same
argument with actual revenue behind it, add a third track then, as a decision entry
(§27) — not speculatively.

**Coaches outside India who bill in a soft currency** are served by the store's own
USD-to-local conversion, which handles the currency, the tax, and the rounding to a
locally-sensible price point. That is a worse fit than a hand-set local price and a
much better fit than nothing.

**Implementation rules — all three are load-bearing:**

1. **Never hardcode a price, a currency symbol, or a formatted amount anywhere in the
   app.** Every number shown on the paywall is read live from StoreKit / Play Billing,
   already localised and already formatted. A hardcoded "$19.99" is both a store review
   risk and simply wrong for half our target market.
2. **Never implement currency conversion, currency detection, or price selection
   ourselves.** The store resolves the storefront and hands us the right price. Our job
   is to render what it returns.
3. **The currency is never an input to a product decision.** A ₹1,999 Pro coach and a
   $49.99 Pro coach get identical seats, storage, live minutes, AI generations, and
   features. `coach_profiles.billing_currency` (`DATABASE.md` DB§5.1) exists for
   reporting and support copy only — any code path where it influences an entitlement
   is a bug.

**Where the prices are actually configured:** App Store Connect and Play Console
territory price points, per §15.7's product IDs. There is one product per tier per
period — `coachos.pro.monthly` is a single product with an INR price point for India
and a USD-derived price point everywhere else. **Never create a separate
`coachos.pro.monthly.in` product.** Two products for one tier permanently breaks the
store's own upgrade/downgrade proration, and product IDs can never be reused or
renamed once shipped.

**Refine with data, in this order:** INR conversion rate at Coach tier first (it is the
tier where price sensitivity is highest and the funnel is widest), then INR at Pro. Do
not touch the USD prices until there are at least 50 paying coaches on them.

### 15.7 App Store billing — implementation

**Decision (Aug 2026): coach subscriptions are sold via in-app purchase**, through
RevenueCat, on both iOS and Android. Stripe remains in the stack only for the
Phase-3 web dashboard and for Agency invoicing.

**Why this is the right call for now:** it removes the single largest compliance risk
in the project (App Store Review Guidelines §3.1), it removes the need to build
checkout, tax, dunning, and currency handling, and it gets to revenue faster. The
commission is the price of that, and it is affordable at this stage.

**Commission — apply for the reduced rates on day one:**

- **Apple Small Business Program:** 15% instead of 30% for developers under $1M/year.
  Enrolment is not automatic — **you must apply**, and it is a real, recurring
  deadline. This is worth roughly $4.50 per Pro coach per month.
- **Google Play:** 15% on the first $1M/year, applied automatically.
- After 12 months of a continuous subscription, Apple's rate drops to 15% regardless —
  another reason annual plans matter (§15.1.6).

**Product configuration**

- One **subscription group** for base tiers (Coach / Pro / Studio) so the store handles
  upgrades, downgrades, and proration natively. Never build proration ourselves.
- A **second group** for seat packs so they stack additively.
- Product IDs: `coachos.coach.monthly`, `coachos.coach.annual`, `coachos.pro.monthly`,
  … `coachos.seatpack5.monthly`. Never reuse or rename a shipped product ID.
- Introductory offer: 14-day free trial, Pro, one per Apple ID per group.
- **Enable billing grace period and billing retry** in both stores. Without them,
  a failed card silently churns a paying coach.

**Client-side requirements (all are review blockers if missing)**

- [ ] A visible **Restore Purchases** action in settings.
- [ ] Price, billing period, and renewal terms shown _on the paywall itself_ before purchase, pulled live from StoreKit — never hardcoded.
- [ ] Links to Terms and Privacy Policy on the paywall.
- [ ] Manage-subscription deep link to the native store UI.
- [ ] No mention of external/web purchasing anywhere in the app while on IAP. Not in copy, not in a support article linked from the app.
- [ ] Paywall must be dismissible. The app must be usable on Starter without ever purchasing.

**Server-side (the source of truth)**

- RevenueCat **webhooks** → our API → update `coach_profiles`. Handle at minimum:
  `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`,
  `PRODUCT_CHANGE`, `REFUND`, `SUBSCRIPTION_PAUSED` (Play only).
- Webhooks are **not** ordered and **not** exactly-once. Make the handler idempotent
  and reconcile against RevenueCat's REST API on every app foreground.
- On `REFUND`, revoke entitlement immediately and write to `audit_log`.
- On `BILLING_ISSUE`, enter a 16-day grace period with full access and an in-app
  banner — do not downgrade on the first failed payment.

**Schema:** see `DATABASE.md` DB§5.1 for the exact `coach_profiles` columns
(`revenuecat_app_user_id`, `billing_platform`, `subscription_tier`,
`subscription_status`, `seat_packs`, `entitlement_expires_at`, `store_transaction_id`,
`trial_used_at`, `billing_country`, `billing_currency`). The last two record which of
§15.6's two price tracks a coach actually purchased on, taken from RevenueCat, and are
for **reporting and support copy only** — never an input to an entitlement decision.
`client_seat_limit` is **derived**, never stored:
`tierSeats[tier] + seat_packs * 5`. Compute it in one place in `packages/utils` and
nowhere else — Agency's unlimited case is the one exception, resolved in the same
function (`.claude/plan/phase-25-white-label-and-teams/agency-tier/`).

⚠️ App Store guidelines change. Re-read them before every submission, and never ship
a billing change without checking the live guidelines that week.

### 15.8 Entitlement enforcement

Entitlements are computed **server-side** and returned by `billing.entitlements`:
tier, seat/storage/live-minute/AI-generation limits and usage, a `features` flag set
(`liveWorkoutMode`, `groupLive`, `ai`, `whiteLabel`, `teamSeats`),
status, and grace-period state.

- The client **caches** entitlements and uses them to render UI. It **never** decides
  access. Every gated procedure re-checks server-side (§6.2). A patched app must not
  unlock anything.
- Counters (`liveMinutesUsed`, `aiGenerationsUsed`) reset on the billing anniversary,
  not the calendar month.
- Approaching a limit → notify at 80% and 100%. Never a hard stop mid-action: a live
  session already in progress finishes even if it crosses the cap.

### 15.9 Clients never pay

Clients pay their coach, outside the app, exactly as they do today. CoachOS does not
process coach↔client payments in v1 — doing so would make us a payment facilitator,
with the KYC, RBI recurring-mandate, and refund-liability burden that implies. This is
tracked as an open decision (§27), not a permanent no.

### 15.10 Organisation plans (gyms)

A gym subscribes as an **organisation** (§2's gym-admin persona) and its attached coaches
are covered by it. This is the second non-IAP billing path after Agency (§15.7), and it
follows the same rules: Stripe-invoiced, operator-onboarded, RevenueCat never involved.

- **What an attached coach gets:** Studio-equivalent features, with client seats, storage,
  and live minutes **pooled** across every coach in the organisation. `billing.entitlements`
  reports `source: 'organisation'`; the paywall and seat-pack upsell are hidden; Restore
  Purchases stays reachable (a review blocker either way).
- **Seat counting:** an attached coach's `SEAT_LIMIT_REACHED` resolves against the pool —
  every active or invited client of every root coach in the organisation, through each
  root's hierarchy (§15.5's definition, applied org-wide). Limit notifications go to the
  organisation's admins, who can act on them, not to the coach, who cannot.
- **Leaving or removal:** the coach keeps every client and every row of history, reverts to
  their own subscription, and §15.5's overage rule applies if they are over it. Removal never
  requires reassigning clients — clients are the client's (§21.3).
- **A coach's own IAP subscription is untouched while attached.** We cannot cancel it and do
  not try; the app tells them once that it is unused.
- **The admin never gates the client experience.** §15.4's rule holds: an attached coach's
  clients see the gym's badge and brand and nothing else changes for them.
- **Pricing is undecided** (§27). Pools are operator-set per organisation; no default in code,
  seed, or copy may look like a price.

Schema: `DATABASE.md` DB§5.1 (`organisations`, `org_admin_profiles`,
`coach_profiles.organisation_id`, `organisation_memberships`, `organisation_join_codes`).
Build: `.claude/plan/phase-28-gym-organisations/`.

---

## 19. Performance budgets

| Metric                              | Budget                                    |
| ----------------------------------- | ----------------------------------------- |
| Cold start → first meaningful paint | < 2.0s (mid-range Android, e.g. Pixel 6a) |
| JS bundle (initial)                 | < 3.5MB                                   |
| Set log → visual confirmation       | < 100ms (optimistic, local)               |
| Dashboard load (cached)             | < 200ms                                   |
| Dashboard load (network)            | < 800ms p75                               |
| Food search keystroke → results     | < 400ms                                   |
| Video first frame                   | < 1.5s                                    |
| Live session join                   | < 3s on 4G                                |
| Scroll fps, all lists               | ≥ 55fps                                   |
| Memory during logger                | < 250MB                                   |

Enforce with: FlashList everywhere, `expo-image` with `recyclingKey`, lazy routes,
Reanimated worklets for anything that animates on scroll, and Expo Atlas to inspect
the bundle before each release.

**Battery:** a 90-minute logged session with the screen on must cost < 25% battery on
a 4000mAh device. Live workout mode is exempt but must warn the client at 20%.

---

## 20. Analytics

PostHog. Event naming: `object_action`, snake_case, past tense.

**Core events:** `workout_started`, `workout_completed`, `set_logged`, `meal_logged`,
`barcode_scanned`, `form_check_uploaded`, `video_annotated`, `comment_created`,
`checkin_submitted`, `checkin_reviewed`, `live_session_joined`, `client_invited`,
`client_activated`, `subscription_started`, `subscription_cancelled`,
`seat_limit_hit`, `paywall_viewed`.

**North star metric:** _weekly reviewed client-weeks_ — the number of client-weeks in
which the coach left at least one piece of feedback. It captures both sides of the
marketplace of attention and predicts retention better than DAU.

**Guardrails**

- Never send PII, health values, food names, body metrics, or media URLs to PostHog. IDs and counts only.
- Respect the OS "limit ad tracking" flag and an in-app analytics opt-out.
- No session recording in the mobile app. Ever.

---

## 21. Security, privacy & compliance

### 21.1 Data classification

| Class         | Examples                                                        | Handling                                                                                                    |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Sensitive** | progress photos, body metrics, injuries, food logs, form videos | Encrypted at rest, signed URLs only, never in logs, never in analytics, never in AI prompts without consent |
| Personal      | name, email, DOB, timezone                                      | Standard protection, exportable, deletable                                                                  |
| Operational   | session counts, app version                                     | Freely loggable                                                                                             |

### 21.2 Baseline controls

- TLS 1.3 everywhere; certificate pinning for the API host in release builds.
- Argon2id for password hashing.
- Access token 15 min, refresh token 30 days with rotation + reuse detection.
- R2 bucket: no public access, ever. All reads via signed URLs.
- All auth events, permission changes, exports, and deletions written to `audit_log`.
- Dependency scanning in CI; `pnpm audit` gate on high/critical.
- Screenshot protection (`expo-screen-capture`) on the progress-photos screen.

### 21.3 Legal posture

- **We are not a medical service.** Copy must never diagnose, prescribe, or promise outcomes. A standing disclaimer appears at onboarding and in settings. **`COPY.md` §CO1 is the operational form of this rule** — it carries the specific rewrites, and every phase writing user-facing text follows it.
- India (DPDP Act 2023), EU (GDPR), and California (CCPA) all apply given the target market. Treat health-adjacent data as special-category by default: explicit, granular, revocable consent. **`COMPLIANCE.md` turns all three into a gap list with owners** — note that roughly two-thirds of it is build and process work, not policy text. Data export is owned by `phase-03-identity-and-auth/account-lifecycle/` tasks 09–12.
- Client data belongs to the client, not the coach. If a client leaves a coach, the coach loses access to new data; the client keeps their history.
- ⚠️ **Get a lawyer before launch.** Terms of Service, Privacy Policy, DPA, and the coach↔client data-controller relationship need real legal review. Nothing in this file is legal advice.

### 21.4 Account deletion

Required by both app stores. In-app, no email required, ≤ 3 taps from settings.
Flow: confirm → 7-day grace with recovery email → hard purge of all rows and all R2
objects → confirmation email → `audit_log` entry retained (ID only) for compliance.

> ⚠️ One carve-out, and it is load-bearing: a **ban record** survives the purge with the
> user ID hashed (`DATABASE.md` DB§19.2 step 7). Without it, deleting an account is a
> ban-reset button.

### 21.5 Minors

**A minor may be a client. A minor may never be a coach.**

Teenagers are coached — a 16-year-old on a school sports programme is an ordinary CoachOS
client. But a coach gives health-adjacent advice to other people for money, and that is an
adult responsibility. The constraint is enforced in the schema
(`users_minor_is_client`), not by application politeness.

| Age      | Coach / assistant | Client                                                                   |
| -------- | ----------------- | ------------------------------------------------------------------------ |
| Under 13 | Refused           | Refused                                                                  |
| 13–17    | **Refused**       | Allowed, with **guardian consent required before the account activates** |
| 18+      | Allowed           | Allowed                                                                  |

What differs for a minor client: progress photos are **absent, not gated**; live recording
is disabled regardless of dual consent; analytics and AI processing are forced off and
cannot be enabled in-app; the confirmed guardian can export or delete on the client's
behalf. A daily sweep clears minor status on the 18th birthday.

Age is **self-declared**. We do not collect identity documents — that would be a far worse
privacy outcome than the risk it addresses, and it is the industry norm. This is a
decision, not an omission.

Full spec: `.claude/plan/phase-03-identity-and-auth/auth-server/07-age-gating-and-minors.md`.

### 21.6 User-generated content and safety

CoachOS carries messages, comments, voice notes, and shared video between two people. That
places it under **App Store Review Guideline 1.2** and Google Play's UGC policy, both of
which require four things before the app can ship — including to external TestFlight:

1. A **reporting** mechanism, reachable in ≤2 taps from the content
2. **Blocking**, available to both roles
3. A **content filter** applied before objectionable material is posted
4. A published commitment to **act on reports within 24 hours**, and the capacity to do it

All four are built in `.claude/plan/phase-26-trust-and-safety/`, which is **Product phase 1
despite its phase number** and blocks store submission entirely.

Two rules that follow from §21.1 and are easy to lose under pressure:

- **A report is the consent event.** Absent a report, nobody at CoachOS reads a message.
  Reviewing a report grants sight of the reported item and its immediate context — never the
  relationship around it (`SUPPORT.md` SU§5).
- **Safety ignores the tier table.** A Starter coach's report is triaged in 24 hours exactly
  like an Agency one. Never gate a safety feature (§15.4).

---

## 22. Cost model (watch these)

| Driver                            | Estimate                             | Mitigation                                                                |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Video storage (R2)                | 10GB free, then ~$0.015/GB/mo        | Retention limits (`phase-11-media-pipeline`), tier quotas, 720p default   |
| Video egress                      | **$0** on R2                         | The reason we chose R2 over S3                                            |
| Transcoding                       | **$0** (self-hosted ffmpeg)          | Own worker; only revisit managed transcode past ~2,000 videos/mo (§3.4.3) |
| LiveKit                           | $0 self-hosted (VPS cost only)       | Gate live behind Pro+; hard cap free-tier minutes                         |
| Postgres                          | $0 on Neon free → ~$5/mo self-hosted | Materialised summaries, aggressive indexing (`DATABASE.md` DB§5.8)        |
| Claude API                        | ~$0.01–0.05/summary                  | Cache per client-week; Pro+ only; hard generation cap per §15.2           |
| Push (Expo)                       | free                                 | —                                                                         |
| Apple + Google developer accounts | $99/yr + $25 once                    | Unavoidable (§3.4.4)                                                      |

**Unit economics target:** blended infra cost per paying coach < 12% of _net_ revenue
(i.e. after the 15% store commission). At Coach tier that is ~$2 against ~$17 net; at
Pro, ~$5 against ~$42 net. If video or live pushes past that, gate harder (§15.4)
before raising prices.

---

## 23. Product phases, ship gates & definition of done

Three commercial phases, each ending in a real gate — not a date. The full
feature-by-feature build order that gets each phase there lives in
`.claude/plan/README.md`'s 27-phase dependency-ordered plan tree; this section keeps
only the gate each phase must clear.

| Product phase           | What it covers                                                                                                                                                                                                     | Ship gate                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**             | Auth, coach dashboard, client detail, program builder, offline workout logger, nutrition logging, comments, messaging, basic video upload + playback, **trust & safety (report/block/filter) and support tooling** | 10 real coaches, 3+ real clients each, running 2 weeks with **no WhatsApp fallback** for workout feedback — run per `docs/PILOT-PLAYBOOK.md` |
| **2 — Differentiators** | Video annotation, side-by-side compare, structured check-ins, live 1:1 check-in calls, Live Workout Mode, progress reports, habits, in-person coaching (`phase-27-in-person-coaching/`)                            | 50 paying coaches; annotation used on **>40%** of uploaded videos                                                                            |
| **3 — Scale**           | AI assistant, health sync, white-label, group live, web dashboard, agency/team accounts                                                                                                                            | **$10k MRR**; **< 5%** monthly coach churn                                                                                                   |

### Definition of done (every ticket)

- [ ] All acceptance criteria in the relevant plan task pass on a physical iOS **and** Android device
- [ ] Offline behaviour verified where the `offline-sync` skill applies
- [ ] Loading, empty, error, and forbidden states designed and implemented (`ui-conventions` skill)
- [ ] Optimistic update + rollback where the task calls for it
- [ ] Types are inferred, not hand-written
- [ ] Tests per the `testing` skill
- [ ] Analytics events per §20, declared in `ANALYTICS.md` first (and no PII in them)
- [ ] Any new user-reachable failure has a row in `ERRORS.md` with copy and a recovery action
- [ ] User-facing copy passes `COPY.md` §CO6's checklist — nothing diagnoses, prescribes, promises an outcome, or shames
- [ ] Screen passes `UI-UX.md` §UX8 — one of the six patterns, no query waterfall, an error boundary per section, and the primary action works when every optional section fails
- [ ] Accessibility: labels on all interactive elements, 4.5:1 contrast, works at 200% text size
- [ ] No new dependency without a §3 entry, and no new paid service without passing §3.4.1
- [ ] `pnpm check` exits 0

---

## 24. Commands

```bash
pnpm install
pnpm dev                 # turbo: api + mobile together
pnpm dev:mobile          # expo start --dev-client
pnpm dev:api

pnpm db:generate         # drizzle-kit generate
pnpm db:migrate
pnpm db:studio
pnpm db:seed             # 1 coach, 5 clients, 4 weeks of realistic history

pnpm check               # typecheck + lint + test — MUST pass before any PR
pnpm test
pnpm test:e2e            # maestro

pnpm build:dev           # eas build --profile development
pnpm build:preview
pnpm build:prod
pnpm ota                 # eas update --channel production
```

---

## 25. Known pitfalls

Written down because each of these has cost someone a day:

1. **Expo Go will not run this app.** LiveKit, RevenueCat, and Health Connect need a dev build. Don't debug "module not found" for an hour — build a dev client.
2. **`expo-av` is deprecated.** Use `expo-video` and `expo-audio`. Old tutorials will mislead you.
3. **Never edit `ios/` or `android/`.** They're regenerated. Use a config plugin.
4. **`EXPO_PUBLIC_` is public.** It is in the shipped bundle. This has leaked keys at many companies.
5. **Day boundaries.** A workout at 00:30 IST belongs to the client's local day. Test across a timezone boundary before shipping any date-grouped feature.
6. **Android background uploads** get killed aggressively. Use `expo-task-manager` and always design for resume.
7. **iOS background audio** entitlement is required for the rest timer sound to play when locked.
8. **FlashList needs `estimatedItemSize`** or scroll performance collapses.
9. **Keyboard + bottom sheet** on Android needs `android:windowSoftInputMode="adjustResize"` and `KeyboardAvoidingView` tuning — budget time for it in the logger.
10. **Video orientation metadata** differs between iOS and Android capture. Normalise during transcode or annotations will be rotated 90° on one platform.
11. **OTA updates cannot ship native changes.** Bump the runtime version and build.
12. **Optimistic updates + offline outbox can double-apply.** Always dedupe on `client_local_id`.

---

## 26. Glossary

| Term                | Meaning                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPE**             | Rate of Perceived Exertion, 1–10                                                                                                                                |
| **RIR**             | Reps In Reserve                                                                                                                                                 |
| **1RM**             | One-rep max; estimated via Epley: `w × (1 + r/30)`                                                                                                              |
| **Tempo**           | 4-digit eccentric/pause/concentric/pause, e.g. `3010`                                                                                                           |
| **Superset**        | Two+ exercises performed back to back                                                                                                                           |
| **Check-in**        | Structured periodic client report                                                                                                                               |
| **Form check**      | Client video reviewed by the coach                                                                                                                              |
| **Adherence**       | Computed compliance score, `packages/utils`, `.claude/plan/phase-10-coach-review-surfaces/adherence-engine/`                                                    |
| **Seat**            | One active client slot against a coach's tier limit                                                                                                             |
| **Client-week**     | One client, one week — the unit of the north star metric                                                                                                        |
| **Root coach**      | A coach with `parent_coach_id IS NULL` — bills directly, can hold assistant coaches (§2, Studio+)                                                               |
| **Assistant coach** | A coach with `parent_coach_id` set — delegated by, and billed under, a root; single level of delegation only (§2, §15.2)                                        |
| **Organisation**    | A gym: a non-person tenant with its own Stripe subscription, brand, and pooled seats; attached root coaches carry `coach_profiles.organisation_id` (§2, §15.10) |
| **Gym admin**       | A `role='org_admin'` user who runs an organisation's billing, roster, and join codes — never a coach, never sees client data (§2, §15.10)                       |
| **Join code**       | A single-use, per-coach, 14-day code a gym admin generates; a root coach redeems it to attach to the organisation (`phase-28-gym-organisations/`)               |

---

## 27. Open decisions

Track these here; move them into the body of the file when decided.

- [x] ~~Self-host LiveKit vs LiveKit Cloud~~ → **Cloud free tier for Phase 2 pilot, self-host on exceeding it** (§3.4.3).
- [x] ~~Cloudflare Stream vs self-hosted ffmpeg~~ → **ffmpeg from day one** (§3.4.3).
- [ ] Razorpay vs Stripe for Indian coaches — ~1% saving on domestic cards, but a second integration to maintain. Decide before first paid Indian coach.
- [ ] Hetzner VPS vs staying on PaaS free tiers — decide at the Phase-1 → Phase-2 boundary.
- [ ] Do we build coach↔client payment collection in v2? (High value, high compliance burden in India — RBI rules on recurring mandates.)
- [ ] Web client app — do clients ever need one, or is mobile sufficient forever?
- [ ] Localisation: Hindi first, or English-only through Phase 2?
- [ ] Whether the Starter tier should be 2 seats or 3 — 2 forces the upgrade sooner, 3 lets a coach run a real (if tiny) business free. Test both.
- [ ] Whether seat packs are used at all, or whether coaches simply upgrade. If unused after 100 paying coaches, delete them — they add real billing complexity.
- [ ] Whether to add a $9.99 / ₹399 "Solo" tier at 3–5 seats for very small coaches, or leave that to the seat-pack mechanism (§15.3).
- [ ] Whether a third price track is ever worth it (SEA / LatAm / Africa / E. Europe). Deliberately dropped from §15.6 in favour of two tracks; revisit only with revenue from those territories, never speculatively.
- [ ] Whether to reinstate any _read_ direction on health data — Apple Health / Health Connect metrics, or OAuth wearables (Whoop, Garmin, Fitbit). The wearables phase was removed in favour of write-only export (`.claude/plan/phase-24-health-sync/`). Reinstating a read direction means restoring `wearable_data`, `wearable_connections`, per-metric consent, encrypted token columns, the sensitive-data classification, and the purge-order entries — deliberately, as a decision, never by feature creep.
- [ ] When to revisit web checkout: the 15% commission becomes worth engineering around somewhere north of ~$20k MRR.
- [ ] **Organisation (gym) pricing** — per pooled seat, per coach, or flat; INR and USD tracks; whether a self-serve checkout ever replaces operator onboarding. §15.10 and `phase-28-gym-organisations/` are built so no number lives in code until this is decided.
- [ ] Whether a gym admin should ever see client **names** on the roster (counts only today, §15.10). A privacy decision, not a feature request — revisit only with a concrete, written need from a pilot gym.
- [ ] Whether a reusable "noticeboard" organisation join code is worth the leaked-code risk over single-use codes. Decided against for P28; revisit with pilot feedback.

### 27.1 Deferred to future scope

Known, understood, and deliberately **not** in the current plan tree. Each has a trigger that
should bring it back — none of them is "when we get around to it."

- [ ] **Trial abuse across Apple IDs.** `trial_used_at` is per coach profile, so one Apple ID can seed multiple coach accounts and take the 14-day Pro trial repeatedly. RevenueCat exposes the store's own per-Apple-ID introductory-offer eligibility, which is the correct fix. **Trigger:** any measurable trial-abuse rate, or >5% of trials from repeat devices. Until then the cost is a few free Pro weeks and the fix is not worth the false-positive risk of blocking a legitimate coach.
- [ ] **Coach identity verification.** Anyone can sign up and claim to be a coach on a platform they use to give health-adjacent advice. Options range from certification upload with manual review, to a verified badge, to nothing. **Trigger:** the first `unsafe_advice` report that turns out to involve someone with no qualification at all, or 100 paying coaches — whichever comes first. Note the report category already exists (`report_reason.unsafe_advice`), so the signal will be there.
- [ ] **Media retention expiry versus a live comment thread.** A video can pass its tier's retention window while a coach and client are still discussing it, leaving a thread of comments pointing at nothing (`MEDIA_EXPIRED`). Candidate fixes: extend retention while a thread is active, warn before expiry, or let a coach pin an asset against expiry within quota. **Trigger:** the first support ticket about it, or annotation usage passing ship gate 2's 40%.
- [ ] **App and schema version skew.** A client on an old build after a server migration, and an OTA update landing mid-workout. Today's answer is `STALE_CLIENT_VERSION` (`ERRORS.md` ER§1.4) plus expand-then-contract migrations (`ARCHITECTURE-ESSENTIALS.md` E§9), which is adequate for one app version in the wild. **Trigger:** the first time two app versions are meaningfully live at once — realistically at ship gate 2. Needs a minimum-supported-version policy, a forced-update path, and a rule that OTA never applies while a session is in progress.
- [ ] **Automated content moderation.** The phase-26 filter is a deterministic list and the queue is human. **Trigger:** ~500 coaches, or a report volume Ammar cannot personally triage within 24 hours.

---

_Last updated: 16 August 2026 · Owner: Ammar · Update this file in the same PR as the code it describes._

<!-- unforget:begin — maintained by the unforget skill; do not hand-edit inside these markers -->

## Deferred Work Index

**Ledger home:** `docs/UNFORGET.md` (git posture: split — contents ignored, README/index tracked)

- `UNFORGET.md` — UNFORGET.md (main · standard-10col).

Read the ledgers when the user asks "what's deferred?" / "backlog?" / "prioritize," and before suggesting a release (check 🔴 THIS rows). Log new deferrals via the deferral gate — an item lives in exactly ONE ledger; siblings get a pointer row, not a copy.
<!-- unforget:end -->
