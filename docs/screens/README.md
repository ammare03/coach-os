# Screen specifications

> **Ten screens specified in full. Thirty-five assigned to a pattern.**
>
> `UI-UX.md` §UX2 defines six page patterns. Most routes are a straightforward instance of
> one and need no document of their own — building them means reading the pattern and the
> `ui-conventions` skill. The ten below carry the product, have real complexity, or are where
> a mistake is expensive. Those get a wireframe and a data contract.

---

## The ten

| Screen | Route | Pattern | Why it's specified |
|---|---|---|---|
| [Coach dashboard](coach-dashboard.md) | `(coach)/(tabs)/index` | A · Scan list | The screen a coach opens twenty times a day. Answers "who needs me today?" |
| [Client detail](coach-client-detail.md) | `(coach)/client/[id]` | B · Entity hub | Six facets, six independent failure modes. The error-isolation reference. |
| [Session review](coach-session-review.md) | `(coach)/session/[id]` | F · Detail read | Where feedback actually gets given. The core loop's coach half. |
| [Video annotator](coach-video-annotator.md) | `(coach)/video/[id]` | C · Focus mode | The differentiator. Ship gate 2 measures its use. |
| [Inbox](coach-inbox.md) | `(coach)/(tabs)/inbox` | A · Scan list | A triage queue, not a list. Different rules. |
| [Program day editor](coach-program-day.md) | `(coach)/program/[id]/day/[dayId]` | E · Form flow | The densest authoring surface in the product |
| [Today](client-today.md) | `(client)/(tabs)/index` | F · Detail read | The client's home. One decision: start or don't. |
| [Workout logger](client-workout-logger.md) | `(client)/workout/[sessionId]` | C · Focus mode | **The most important screen in CoachOS.** Offline, one-handed, mid-set. |
| [Food logger](client-food-log.md) | `(client)/log-food` | D · Compose sheet | ≤4 taps from scan to logged. The speed constraint is the design. |
| [Progress](client-progress.md) | `(client)/(tabs)/progress` | F · Detail read | Where the no-shame rule is most easily broken |

---

## Everything else

The remaining routes, by pattern. Build them from the pattern in `UI-UX.md` §UX2.

### Pattern A — Scan list
`(coach)/(tabs)/clients` · `(coach)/(tabs)/programs` · `(coach)/exercise-library` ·
`(coach)/client/[id]/videos` · `(coach)/client/[id]/checkins` · settings blocked-people list

### Pattern B — Entity hub
`(coach)/program/[id]` · `(client)/(tabs)/coach`

### Pattern C — Focus mode
`(coach)/live/[sessionId]` · `(client)/live/[sessionId]` · `(client)/record-form-check` ·
`(client)/scan`

### Pattern D — Compose sheet
`(coach)/invite-client` · comment composer (mounted, not routed) · voice-note recorder ·
quick-add on any list

### Pattern E — Form flow
`(auth)/sign-up` · `(auth)/invite/[code]` · all of `phase-06-onboarding` ·
`(client)/checkin/[id]` · `(coach)/checkin/[id]` (review variant)

### Pattern F — Detail read
`(coach)/client/[id]/training` · `.../nutrition` · `.../chat` · `.../notes` ·
`(client)/workout/[sessionId]/summary` · `(client)/(tabs)/nutrition` · weekly report

### Standalone
`(auth)/welcome` · `(auth)/sign-in` · `(auth)/forgot-password` · both `settings/index` ·
`+not-found` · the paywall (modal)

---

## Document shape

Each screen file has the same sections, in this order:

| Section | Contents |
|---|---|
| **Job** | The one thing this screen exists to do, and for whom |
| **Wireframe** | ASCII layout, annotated. Not pixel-accurate; hierarchy-accurate. |
| **Data contract** | Every query, its key, when it fires, its `staleTime`, and what prefetches it |
| **Boundaries** | The error-isolation map — what fails independently and what it degrades to |
| **States** | Loading, empty, error, forbidden, offline |
| **Interactions** | Every action, its optimistic behaviour, and its haptic |
| **Performance** | The budget this screen must hit and what buys it |
| **Risks** | What goes wrong here specifically |

---

## Reading order for a new engineer

1. `DESIGN-SYSTEM.md` — what things look like
2. `UI-UX.md` — how pages are composed and how data reaches them
3. The `ui-conventions` skill — component-level rules
4. This directory — the screen you are building
5. `COPY.md` — before writing a single string

---

*Companions: `UI-UX.md` · `DESIGN-SYSTEM.md` · `.claude/plan/phase-05-app-shell/router-skeleton/01-route-tree-and-typed-routes.md` (the routes these describe)*
