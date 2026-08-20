# UI-UX.md — CoachOS

> **How a page is composed, how data reaches it, how it fails safely, and how it stays fast.**
>
> `DESIGN-SYSTEM.md` owns what things look like. `ui-conventions` owns component-level rules.
> `docs/screens/` owns individual layouts. **This file owns the layer between them:** the
> navigation model, the six page patterns every screen belongs to, the data-fetching
> contract, error isolation, and the performance playbook.
>
> If you are about to build a screen, read this first, then your screen's file in
> `docs/screens/`, then the pattern it belongs to.

---

## UX§0. The three commitments

Everything below serves one of these.

**1. Nothing blocks on the network.** The client logs in a basement; the coach reviews on
hotel wifi. Every write is optimistic, every read is cache-first, and the word "loading" is a
last resort. (`ARCHITECTURE.md` A§5.3)

**2. A screen is a composition of independently-failing parts.** One widget's failure
degrades that widget, never the page. A coach whose adherence chart is broken can still read
their client's session. (UX§4)

**3. Density is a prop.** Coach and client see different spacing, type, and row heights from
the *same* components. A forked component is a bug (`ui-conventions` §1).

---

## UX§1. Navigation model

Four layers. A screen belongs to exactly one and the choice is not a preference.

```
┌─ Root layout ────────────────────────────────────────────┐
│  providers · theme · auth gate · offline banner          │
│                                                           │
│  ┌─ Tabs ─────────────────────────────────────────────┐  │
│  │  persistent · state preserved · never a spinner    │  │
│  │  after first load                                  │  │
│  │                                                     │  │
│  │  ┌─ Stack ─────────────────────────────────────┐   │  │
│  │  │  pushed detail screens · back always works  │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ Modal / Sheet ────────────────────────────────────┐  │
│  │  a task, dismissible, returns you where you were   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ Focus mode ───────────────────────────────────────┐  │
│  │  OUTSIDE the tab layout · no tab bar · keep-awake  │  │
│  │  logger · annotator · live call · camera            │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### UX§1.1 Which layer

| The screen is… | Layer | Examples |
|---|---|---|
| A top-level destination | **Tab** | Dashboard, Clients, Programs, Inbox · Today, Nutrition, Progress, Coach |
| A thing you drilled into | **Stack** | Client detail, session review, program day |
| A short task with a clear end | **Sheet** | Log food, add set note, invite client, comment composer |
| A task needing full attention with unsaved state | **Modal** | Check-in submission, paywall |
| An immersive activity | **Focus mode** | Workout logger, video annotator, live session, camera |

**The focus-mode rule is load-bearing.** A tab bar visible during a set is 88px of the most
valuable screen space in the product spent on navigation nobody wants mid-lift. Focus modes
live outside the tab layout, hold `expo-keep-awake`, and have exactly one exit.

### UX§1.2 Tab bars

**Coach — 5 tabs.** Dashboard · Clients · Programs · Inbox · More
**Client — 4 tabs.** Today · Nutrition · Progress · Coach

**The tab bar is a `<GlassSurface>`** — Liquid Glass on iOS 26+, opaque elevation everywhere
else (`DESIGN-SYSTEM.md` DS§12). Content scrolls beneath it rather than stopping at it, so
lists need bottom padding equal to the bar's height plus the safe-area inset. A list whose last
row sits under the tab bar is the standard bug this introduces — reserve the space.

Four to five is the ceiling. A sixth tab means something belongs in More, or the information
architecture is wrong. Badges appear on Inbox and Coach only, count unread **actionable**
items, and never show a bare dot for something informational.

### UX§1.3 Back, always

Every pushed screen has a working back. Every sheet has a drag-dismiss and a visible close.
Every modal has a cancel that discards safely, or an explicit "save draft" if there is
unsaved work (`phase-06-onboarding/onboarding-infrastructure/01`).

**Never trap a user in a flow.** The one exception is a blocking state they cannot act
around — suspended account, guardian consent pending — and each of those has a route out
(appeal, resend).

---

## UX§2. The six page patterns

Every one of the ~45 routes is one of these. A new screen picks a pattern; it does not invent
a seventh.

### Pattern A — Scan list

*Dashboard, Clients, Inbox, Exercise library, Blocked people*

A vertically scrolling list optimised for finding one item fast.

```
┌──────────────────────────────┐
│ Title              ⌕   ⋯     │  header: title + at most 2 actions
├──────────────────────────────┤
│ [ All ][ Needs me ][ Paused ]│  filter chips — horizontal, optional
├──────────────────────────────┤
│ ● Priya S.    4/5    2d   ›  │  FlashList
│ ● Arjun M.    5/5    1d   ›  │  fixed-height rows
│ ◐ Nikhil R.   2/5    6d   ›  │  one status glyph, left
│ ◌ Sara K.     —      inv  ›  │
└──────────────────────────────┘
```

**Rules.** Fixed row height (`estimatedItemSize` accurate to the pixel). Status on the left
where the eye lands first. At most three data points per row. Keyset pagination. A filter
chip row is optional but never more than five chips. **Search filters the loaded list
locally first**, then queries — instant feedback beats complete results.

### Pattern B — Entity hub

*Client detail, Program detail*

One entity, several facets, a persistent header.

```
┌──────────────────────────────┐
│ ‹  Priya Sharma          ⋯   │
│    Week 6 · 4/5 · last 2d    │  identity + the 3 facts you always need
├──────────────────────────────┤
│ Overview │Train│Food│Video│⋯ │  scrollable segmented control
├──────────────────────────────┤
│                              │
│   facet content              │  each facet is independently loaded
│                              │
└──────────────────────────────┘
```

**Rules.** The header loads from one cheap query and renders before any facet. **Facets are
lazily mounted and independently error-bounded** — Nutrition failing must not take Training
with it. The active facet is a URL param so a deep link lands on the right one and back
behaves. Switching facets never shows a full-screen spinner after the first visit.

### Pattern C — Focus mode

*Workout logger, video annotator, live session, camera*

```
┌──────────────────────────────┐
│ ✕                    3 of 8  │  minimal chrome: exit + position
├──────────────────────────────┤
│                              │
│                              │
│         THE THING            │  ~70% of the screen
│                              │
│                              │
├──────────────────────────────┤
│      [ primary action ]      │  one thumb-reachable action
└──────────────────────────────┘
```

**Rules.** No tab bar. Keep-awake on. One primary action, in the bottom third where a thumb
reaches. Chrome auto-hides where it can. State survives app kill
(`phase-09-workout-logger/session-runtime/06`). **Every interaction works offline.**

### Pattern D — Compose sheet

*Log food, add comment, quick-add, invite client*

```
┌──────────────────────────────┐
│                              │  ← tap scrim to dismiss
├══════════════════════════════┤
│ ═══                          │  grab handle
│ Add meal              Cancel │
├──────────────────────────────┤
│ ⌕ Search foods               │  input focused on open
│ ──────────────────────────── │
│ Recent · Chicken breast   +  │  results / recents
│ Recent · Basmati rice     +  │
├──────────────────────────────┤
│      [ Add 2 items ]         │  action reflects current state
└──────────────────────────────┘
```

**Rules.** Opens with the primary input focused. Keyboard-aware — this is where Android
`adjustResize` pain lives (`CLAUDE.md` §25.9); budget real device time. Drag-dismiss confirms
only if there is unsaved input. The action label states what will happen ("Add 2 items"), never
"Done".

### Pattern E — Form flow

*Onboarding, check-in submission, program builder day*

```
┌──────────────────────────────┐
│ ‹  Step 2 of 5               │
│ ████████░░░░░░░░░░░░         │  progress, honest
├──────────────────────────────┤
│ What are your goals?         │  one question per screen
│                              │
│ [ Fat loss        ]          │
│ [ Muscle gain     ] ✓        │
│ [ Performance     ]          │
├──────────────────────────────┤
│           [ Continue ]       │
└──────────────────────────────┘
```

**Rules.** One decision per screen. Progress is real, not decorative. **Every step persists
immediately** — a partial check-in survives Sunday→Monday (P17's exit gate). Back never loses
an answer. Validation is inline and on blur, never a summary at submit.

### Pattern F — Detail read

*Session review, video review, check-in review, weekly report*

```
┌──────────────────────────────┐
│ ‹  Tuesday · Upper A     ⋯   │
├──────────────────────────────┤
│ ┌──────────┐ ┌──────────┐    │  the summary you came for
│ │ 12,450kg │ │  62 min  │    │
│ └──────────┘ └──────────┘    │
│                              │
│ Bench Press                  │  the detail, grouped
│  1  60kg × 8   RPE 8    💬   │  ← inline affordance to act
│  2  60kg × 8   RPE 8         │
├──────────────────────────────┤
│  [ 💬 Comment ]  [ ✓ Done ]  │  persistent action bar
└──────────────────────────────┘
```

**Rules.** Summary first, detail below — a coach decides whether to engage in two seconds.
Actions are reachable **inline** at the thing they act on, not only in a bottom bar. The
bottom bar is persistent for the primary action so a coach never scrolls back up to comment.

---

## UX§3. Data fetching

The rules that decide whether a screen feels instant or merely correct.

### UX§3.1 Query key convention

Hierarchical, so invalidation is surgical:

```
['client', clientId]                          entity header
['client', clientId, 'sessions', { week }]    a facet, parameterised
['client', clientId, 'nutrition', { date }]
['dashboard', { filter }]
['session', sessionId]
['exercises', { q }]
```

Invalidating `['client', clientId]` refetches that client and every facet beneath it.
Invalidating `['client']` refetches all clients. **Never a flat string key** — `'clientData'`
cannot be partially invalidated and forces refetching everything.

### UX§3.2 The waterfall rule

**A screen issues its queries in parallel, at mount, from the top.** The failure mode to avoid
is a parent fetching, rendering, then a child fetching — two sequential round trips before
anything useful appears.

| ✗ Waterfall | ✓ Parallel |
|---|---|
| Screen fetches client → renders → tab fetches sessions | Screen fetches client **and** sessions together |
| List fetches ids → each row fetches its own detail | List endpoint returns rows complete |
| Header fetches user → then fetches entitlements | Both at mount, both cached |

**The row-level query is the one that bites.** A list of 30 clients where each row issues its
own adherence query is 30 requests and a scroll that stutters. **List endpoints return
render-complete rows.** If a row needs a field, it belongs in the list payload, not in a
per-row hook.

### UX§3.3 Prefetch on intent

The device knows where the user is going before they arrive:

- **On list render**, prefetch the detail for the first ~5 visible rows.
- **On press-in** (not press-out), prefetch that row's detail. The 80–150ms between finger
  down and navigation is free latency.
- **On tab focus**, prefetch the adjacent tab's primary query.
- **Nightly / on app foreground**, prefetch today's session and the top-200 foods
  (`phase-08-offline-core/prefetch/`).

Prefetching writes into the same cache the destination reads, so arrival is a cache hit.

### UX§3.4 Stale-while-revalidate everywhere

Cached data renders **immediately**; the refetch happens behind it. A subtle inline indicator
may show the refresh; a spinner replacing content may not.

| Data | `staleTime` | Reasoning |
|---|---|---|
| Exercise library | 24h | Effectively static |
| Programs, templates | 5m | Coach-authored, changes rarely |
| Client list / dashboard | 60s | Matches the Redis `dash:` TTL |
| Session detail | 30s | |
| Comments, messages | 0 + realtime | The socket pushes; the query is the fallback |
| Entitlements | 5m | Matches the server cache; **UI only** (`CLAUDE.md` §15.8) |

### UX§3.5 Narrow subscriptions

Use `select` so a component re-renders only when *its* slice changes. A header showing a
client's name must not re-render when a set is logged.

```
useQuery({ queryKey: ['client', id], select: (c) => c.name })
```

This is the cheapest render optimisation available and the most commonly skipped.

### UX§3.6 Mutations

Every mutation that a user watches is optimistic:

1. `onMutate` — cancel in-flight queries for the key, snapshot, apply the optimistic update.
2. `onError` — roll back from the snapshot and surface the error inline (`ERRORS.md`).
3. `onSettled` — invalidate the narrowest key that could have changed.

**Offline-capable mutations do not go through this path directly** — they enqueue to the
outbox with a `clientLocalId` and the optimistic update is applied to the local SQLite mirror
(`offline-sync` skill). The Query cache reads from that mirror, so both paths converge.

---

## UX§4. Error isolation

> **No screen may fail as a whole because one part of it failed.**

This is the rule the user asked for by name and it is enforced structurally, not by care.

### UX§4.1 The boundary map

Every screen declares its boundaries. A boundary wraps a **section**, not a component and not
a page.

```
┌─ Screen ─────────────────────────────────┐
│  ┌─ Header ──────────────────────────┐   │  boundary 1
│  │  Priya Sharma · Week 6 · 4/5      │   │  fails → name only, no stats
│  └───────────────────────────────────┘   │
│  ┌─ Stats ───────────────────────────┐   │  boundary 2
│  │  [12,450 kg]  [4/5]  [62 min]     │   │  fails → tiles show "—"
│  └───────────────────────────────────┘   │
│  ┌─ Chart ───────────────────────────┐   │  boundary 3
│  │  ╱╲    ╱╲                          │   │  fails → "Chart unavailable · Retry"
│  └───────────────────────────────────┘   │
│  ┌─ Sessions ────────────────────────┐   │  boundary 4
│  │  Tue · Upper A · 12,450 kg     ›  │   │  fails → inline error + retry
│  └───────────────────────────────────┘   │  THE PRIMARY CONTENT
└──────────────────────────────────────────┘
```

**Rules**

1. **Each boundary has a designed fallback**, and the fallback is the section's own shape —
   a stat tile shows `—`, a chart shows a short message with retry, a list shows an inline
   error row. Never a red box, never a stack trace, never a blank gap that shifts layout.
2. **The primary content boundary is the one that may show a full-screen error.** If the
   session list itself cannot load, the screen has nothing to say. Everything else degrades
   quietly.
3. **A boundary logs to Sentry with its section name and the request ID** (`OBSERVABILITY.md`
   OB§2), so a silent degradation is still visible to us.
4. **Boundaries reset on navigation.** A user returning to a screen gets a fresh attempt, not
   a cached failure.
5. **A failing optional section never blocks the primary action.** A broken adherence chart
   must not prevent commenting on a set.

### UX§4.2 What each state looks like

| State | Treatment |
|---|---|
| **Loading, first time** | Skeleton matching the real layout — same heights, same rhythm. Not a spinner. |
| **Loading, cached** | Render the cache instantly; refresh indicator only if it takes >800ms |
| **Empty** | Designed, one primary action (`COPY.md` §CO4.1) |
| **Error, section** | One line + retry, sized like the content it replaces |
| **Error, page** | Full state with retry; only for primary content |
| **Forbidden** | Explain, offer the path (upgrade, request access). Never a bare 403 |
| **Offline** | Cached content + a persistent, calm banner. **Never an error.** |

### UX§4.3 The three you will forget

- **Forbidden.** Every route taking an `id` needs it (`ui-conventions` §4).
- **Partial.** Some sections loaded, one failed. This is the normal case and it needs to look
  intentional.
- **Stale-offline.** Cached data from three days ago. Say when it is from; do not pretend it
  is live.

---

## UX§5. Performance playbook

`CLAUDE.md` §19 sets the budgets. This is how they are met.

### UX§5.1 Perceived speed beats measured speed

In priority order:

1. **Render from cache immediately.** The fastest screen is one that does not wait.
2. **Optimistic writes.** The set appears before the server knows about it.
3. **Prefetch on intent** (UX§3.3). Arrival is a cache hit.
4. **Skeletons that match the layout**, so nothing shifts when data lands.
5. **Reserve space for everything** — images, charts, avatars. Layout shift reads as slowness
   even when it is fast.
6. **Press feedback within 120ms**, always. Even if the action takes a second.

### UX§5.2 Render discipline

| Rule | Why |
|---|---|
| `select` in queries (UX§3.5) | Narrow subscriptions, fewer re-renders |
| `React.memo` on list rows, **always** | A 400-row list re-rendering wholesale drops frames |
| Stable callbacks into rows — `useCallback`, or better, pass the id and look up in the handler | An inline arrow function invalidates every memoised row on every render |
| Zustand selectors, never the whole store | `useStore()` subscribes to everything |
| Derive in `useMemo` only when the computation is real | Memoising a string concat costs more than it saves |
| Context holds **stable** values only | A context whose value is a new object each render re-renders every consumer |

### UX§5.3 Lists

- **FlashList v2** everywhere, `estimatedItemSize` accurate — measure it, do not guess.
- **Fixed row heights** wherever possible. Variable heights force measurement passes.
- `keyExtractor` returns a **stable server or local id**, never an index.
- No inline styles or inline functions in `renderItem`.
- `expo-image` with `recyclingKey` for every image in a row.
- Keyset pagination via `useInfiniteQuery`; prefetch the next page at ~70% scroll.

### UX§5.4 Images and media

- Every remote image has explicit dimensions and a blurhash placeholder.
- Request the size you display. A 4000px progress photo in a 96px thumbnail is a decode cost
  and a memory cost on the device that can least afford it.
- Video posters are separate small images — never a paused first frame of an HLS stream.
- `expo-image` memory-disk cache policy; never a bare `<Image source={{uri}}>`.

### UX§5.5 Startup

Budget: **< 2.0s to first meaningful paint on a Pixel 6a**, bundle **< 3.5MB**
(`CLAUDE.md` §19).

- Lazy-load every route outside the first tab.
- No heavy work in a provider's render — hydrate SQLite and the query cache asynchronously
  behind a skeleton.
- Fonts preloaded via `expo-font` with `SplashScreen.preventAutoHideAsync` — a font swap
  after paint is a visible flash.
- Inspect the bundle with **Expo Atlas** before every release. A dependency that grew is
  easier to find at 3.4MB than at 5.
- Hermes on, engine defaults unchanged.

### UX§5.6 Battery

A 90-minute logged session must cost **< 25% on a 4000mAh device** (`CLAUDE.md` §19).

- Keep-awake **only** during an active session, released on exit — including on crash
  recovery.
- No polling while a screen is idle. Realtime uses the socket; everything else refetches on
  focus.
- Rest timers are a single scheduled notification plus a lightweight tick, not a 1Hz re-render
  of the screen.
- Animations pause when the app backgrounds.

---

## UX§6. Anti-patterns — do not do these

The list the user asked for. Each has cost someone a day, in this product or one like it.

### UX§6.1 Structural

1. **Do not fork a component per role.** `CoachClientRow` and `ClientClientRow` diverge within
   two sprints. Density is a prop.
2. **Do not put business logic in a route file.** Routes resolve params and render a feature
   screen (`code-conventions`).
3. **Do not fetch inside a list row.** UX§3.2. This is the single most common cause of a
   janky list.
4. **Do not use a `<Modal>` where a sheet belongs.** Modals block; sheets are dismissible and
   feel native.
5. **Do not build a seventh page pattern** without adding it to UX§2 and saying why.

### UX§6.2 Data

6. **Do not use flat query keys.** They cannot be partially invalidated.
7. **Do not `invalidateQueries()` with no key.** It refetches the world and looks like a
   network problem.
8. **Do not read entitlements to *decide* access** — only to render UI (`CLAUDE.md` §15.8).
9. **Do not await an analytics call.** Fire and forget, always (`ANALYTICS.md`).
10. **Do not refetch on every focus by default.** Set `staleTime` deliberately (UX§3.4).
11. **Do not store server data in Zustand.** Server state is TanStack Query. Zustand is the
    rest timer and the logger draft.

### UX§6.3 Rendering

12. **Do not ship a `FlatList` on a long list**, or a `FlashList` without
    `estimatedItemSize`.
13. **Do not use array index as a key.** Reordering corrupts state.
14. **Do not animate on the JS thread.** Worklets.
15. **Do not render a spinner where a skeleton belongs**, and never a full-screen spinner on
    a tab switch after first load.
16. **Do not let layout shift when data arrives.** Reserve the space.

### UX§6.4 React Native specifics

17. **No `localStorage`, `sessionStorage`, or any browser storage API.** They do not exist
    here (`ui-conventions` §10).
18. **No native `Alert`** except an OS permission rationale.
19. **Do not edit `ios/` or `android/`.** They are regenerated (`CLAUDE.md` §25.3).
20. **Do not use `expo-av`.** Deprecated — `expo-video` and `expo-audio`.
20b. **Do not import `expo-glass-effect` outside `packages/ui/src/surfaces/`.** One primitive
    owns the platform and accessibility branching (`DESIGN-SYSTEM.md` DS§12.3).
20c. **Do not put glass on content** — cards, rows, stat tiles, charts, the workout logger,
    progress photos. Chrome only, and never on Android.
21. **Do not assume `Dimensions` is static.** Rotation, foldables, and split-view all change
    it. Use `useWindowDimensions`.
22. **Do not hardcode safe-area insets.** `useSafeAreaInsets`, every time.
23. **Do not put a `ScrollView` inside a `ScrollView`** in the same direction.
24. **Do not test the logger only on a simulator.** Haptics, keyboard, and background
    behaviour are all wrong there.

### UX§6.5 Product

25. **Do not gate anything the client experiences** behind the coach's tier
    (`CLAUDE.md` §15.4).
26. **Do not use green/amber/red decoratively** (`DESIGN-SYSTEM.md` DS§2.5).
27. **Do not render a new client as red.** Grey means no data.
28. **Do not show a score about a person** (DS§1).
29. **Do not interrupt a set.** No modals, no toasts, no upsell inside a focus mode.
30. **Do not put a price in a string** — read it from StoreKit (`COPY.md` §CO4.4).

---

## UX§7. What we take from other products

The references, and specifically what is worth stealing from each.

### Fitness

| Product | Take | Reject |
|---|---|---|
| **Hevy** | The best set logger in the market. Study the row: previous performance inline, one-tap-to-repeat, a stepper that works with a thumb, rest timer starting automatically on set completion. This is the closest thing to a reference implementation for our highest-risk screen. | Its social feed |
| **Whoop** | Presentation of dense data: large numerals, arcs, restrained palette, dark canvas. The information density per screen without clutter. | **The score.** A single number judging a person is exactly what DS§1 forbids. |
| **Apple Fitness** | Ring mechanics, motion restraint, typography at large sizes, and the discipline of showing three metrics rather than nine. | Closing-ring pressure — our equivalent would shame a client (`COPY.md` §CO2) |
| **Strava** | Segment/PR moments done well; a celebration that is specific and brief. | The feed and the comparison-to-others framing. We are not a social network (`CLAUDE.md` §1.2). |

### Pro tools

| Product | Take | Reject |
|---|---|---|
| **Linear** | Perceived speed as a design value. Optimistic everything, instant navigation, no spinners, keyboard-first thinking. The coach's review block should feel like this. Their empty states and skeletons are worth copying almost directly. | Keyboard-only affordances — we are touch-first |
| **Superhuman** | Triage as a first-class flow: a queue, a decision per item, and a clear end. The coach's Inbox is a triage surface and should feel like one — including the satisfaction of reaching the end. | The onboarding-call model |
| **Raycast** | Command-palette-grade responsiveness and the idea that the fastest path is fewer screens, not faster screens. | The palette itself — wrong input model on a phone |

### Coaching incumbents

| Product | Take | Where they fail — our opening |
|---|---|---|
| **Trainerize** | Comprehensive program builder; coaches expect its vocabulary (blocks, weeks, supersets). Match the mental model. | Feels like a desktop CRM on a phone. Feedback is disconnected from the thing it is about. |
| **TrueCoach** | Clean client-detail hub, straightforward video review. | Feedback is still a text box next to a video, not attached to a moment in it. Our annotation is the wedge. |
| **Everfit** | Broad feature coverage, decent habit tracking. | Density without hierarchy — everything is equally emphasised, so nothing is. |

**The synthesis:** incumbents have the *features* and lose on *feel*; fitness apps have the
*feel* and lose on *coaching depth*; pro tools have the *speed* nobody in this category has.
CoachOS is the coaching depth of Trainerize, presented like Whoop, at Linear's speed.

---

## UX§8. Screen checklist

Merge criteria, in addition to `ui-conventions` §11:

- [ ] Belongs to one of UX§2's six patterns, or the pattern list was extended with a reason
- [ ] All queries issued in parallel at mount — no waterfall (UX§3.2)
- [ ] No query inside a list row
- [ ] Query keys hierarchical; invalidation is narrow
- [ ] Error boundary per section, each with a designed fallback (UX§4)
- [ ] The primary action still works when every optional section fails
- [ ] Skeleton matches the real layout; no layout shift on data arrival
- [ ] Prefetch on press-in for anything navigable
- [ ] Rows memoised, callbacks stable, keys are ids
- [ ] Works offline if it is in the client's core loop
- [ ] Verified on a physical device (`testing` skill §11.1)

---

*Companions: `DESIGN-SYSTEM.md` (visual system) · `docs/screens/` (layouts) ·
`ui-conventions` skill (component rules) · `COPY.md` (words) · `ERRORS.md` (failure copy) ·
`ARCHITECTURE.md` A§5 (the mobile layer) · Owner: Ammar · Last updated: 16 August 2026*
