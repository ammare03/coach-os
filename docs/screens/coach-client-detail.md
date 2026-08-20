# Client detail

| | |
|---|---|
| **Route** | `(coach)/client/[id]` + six facet routes |
| **Pattern** | B · Entity hub (`UI-UX.md` §UX2) |
| **Density** | Coach — informative |
| **Built in** | `phase-10-coach-review-surfaces/client-detail/` |

---

## Job

**Everything a coach needs to review one client's week, on one screen.**

This is `CLAUDE.md` §1's core promise made literal. It is also **the error-isolation reference
implementation** — six facets, six independent data sources, six independent failure modes. If
this screen fails as a whole because one chart broke, the pattern is wrong everywhere.

---

## Wireframe

```
┌────────────────────────────────────────────┐
│ ‹                                    ⋯     │
│  ╭──╮  Priya Sharma                        │  header: cheap query, renders first
│  │PS│  Week 6 of 12 · 4/5 · last 2d ago    │  identity + the 3 always-needed facts
│  ╰──╯                                      │
├────────────────────────────────────────────┤
│ Overview │ Training │ Food │ Video │ ⋯     │  scrollable segmented control
│ ─────────                                  │  active facet is a URL param
├────────────────────────────────────────────┤
│                                            │
│  ┌────────────┐  ┌────────────┐            │
│  │ SESSIONS   │  │ VOLUME     │            │  stat tiles · 2-col
│  │   4 / 5    │  │ 12,450 kg  │            │  facts, never scores
│  └────────────┘  └────────────┘            │
│                                            │
│  ADHERENCE · 8 WEEKS                       │
│  ╱╲    ╱‾╲                                 │  line chart · own boundary
│ ╱  ╲__╱   ╲___                             │
│                                            │
│  NEEDS YOUR ATTENTION                      │
│  › New form check · Squat · 2d             │  actionable items, inline
│  › Check-in submitted · 1d                 │
│                                            │
│  RECENT SESSIONS                           │
│  Tue · Upper A · 12,450 kg          ›      │  PRIMARY CONTENT
│  Sun · Lower B · 9,800 kg           ›      │
│                                            │
├────────────────────────────────────────────┤
│  [ 💬 Message ]        [ ✎ Program ]       │  persistent actions
└────────────────────────────────────────────┘
```

**Facets:** Overview · Training · Food · Video · Check-ins · Chat · Notes.
Notes is coach-only and **never returned to a client role** (`.claude/plan/README.md` §4).

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Client header | `['client', id]` | Mount — **first, cheapest** | 60s |
| Overview payload | `['client', id, 'overview']` | Mount, **parallel with header** | 60s |
| Facet: training | `['client', id, 'sessions', { week }]` | On first visit to that facet | 30s |
| Facet: nutrition | `['client', id, 'nutrition', { date }]` | On first visit | 30s |
| Facet: video | `['client', id, 'media']` | On first visit | 60s |
| Facet: check-ins | `['client', id, 'checkins']` | On first visit | 60s |

**Header and overview fire together at mount** — not header-then-overview, which is the
waterfall this pattern exists to avoid (`UI-UX.md` §UX3.2).

**Facets are lazily mounted.** A coach who never opens Food never fetches nutrition. A facet
already visited keeps its cache and re-renders instantly on return.

**Prefetch.** On mount, prefetch the Training facet — it is the most-visited second stop. On
press-in of a session row, prefetch `['session', sessionId]`.

**Invalidation.** After a comment on a session: invalidate `['client', id, 'sessions']` only.
Not `['client', id]` — that would refetch the header and every loaded facet for a change that
touched one row.

---

## Boundaries

**The reference map. Six boundaries, each with a shaped fallback.**

```
┌─ Header ─────────────────────┐  fails → avatar + name from the list cache;
│  Priya Sharma · Week 6 · 4/5 │           the "Week 6 · 4/5" line omitted
├─ Stat tiles ─────────────────┤  fails → tiles render "—", same size
├─ Adherence chart ────────────┤  fails → "Chart unavailable · Retry",
│                              │           same height as the chart
├─ Needs attention ────────────┤  fails → section omitted entirely
├─ Recent sessions ────────────┤  PRIMARY — full error + retry if this fails
└─ Action bar ─────────────────┘  no data dependency — ALWAYS works
```

**Two rules this screen proves:**

1. **The action bar never depends on a query.** A coach whose entire screen failed to load can
   still message their client. The bar's buttons need only the `clientId`, which is in the
   route.
2. **A failed facet does not affect its siblings.** Nutrition erroring leaves Training,
   Video, and Check-ins fully functional. Each facet is its own boundary and its own query.

Every boundary reports to Sentry with its section name and request ID
(`OBSERVABILITY.md` §OB2), so a quiet degradation is still visible to us.

---

## States

| State | Treatment |
|---|---|
| **Loading, first** | Header skeleton + tile skeletons + chart skeleton, all at exact final height. Zero layout shift on arrival. |
| **Loading, from list** | Name and avatar render **instantly** from the dashboard cache; the rest fills in |
| **Empty — brand-new client** | "Priya hasn't logged anything yet." → *Send a message*. **Never red, never "0%"** (`COPY.md` §CO2). |
| **Empty — facet** | Per facet: "No meals logged yet." with no action, since the coach cannot log for them |
| **Forbidden** | `NOT_FOUND` treatment — indistinguishable from a missing client (`ERRORS.md` §ER2.1) |
| **Client is paused** | Header chip "Paused". All content read-only. Actions still available. |
| **Client left you** | 30-day read-only window (`phase-03-.../06`). Header states it; photos and metrics are already gone. |

---

## Interactions

| Action | Behaviour |
|---|---|
| Facet switch | Instant if visited; skeleton if not. **Never a full-screen spinner.** URL param updates. |
| Tap session row | Prefetch on press-in → `session/[id]` |
| Tap "Needs your attention" item | Direct to the exact object — a video opens the annotator, a check-in opens review |
| Message | Push chat facet, keyboard focused |
| Program | Push the client's active program |
| ⋯ menu | Pause · Archive · Release client · Report. Archive and release get typed confirmation. |

---

## Performance

**Budget: < 200ms cached, < 800ms p75 network.**

- Header is a deliberately tiny payload so it paints before anything else resolves.
- Facets lazy — never fetch what is not shown.
- Chart data is downsampled server-side to ~50 points. A phone should never receive 12 weeks
  of raw sets to render a line.
- `select` on the header query so a set logged elsewhere does not re-render the name.
- Session rows memoised; FlashList past 20 rows.

---

## Risks

**One boundary for the whole screen.** The default React instinct. It makes a broken chart
hide a client's entire week and is precisely what `UI-UX.md` §UX4 exists to prevent.

**The header-then-content waterfall.** Two sequential round trips before anything useful.
Fire both at mount.

**Eager-loading all six facets** to make switching instant. It makes *arrival* slow, which is
the moment that matters, and fetches nutrition data for coaches who never open it.

**Leaking `coach_client_notes`.** The Notes facet must never be returned to a client role.
Covered by the authorisation enumeration test — do not add a shortcut around it.

**Over-invalidating.** `invalidateQueries(['client', id])` after a comment refetches
everything. Invalidate the narrowest key.
