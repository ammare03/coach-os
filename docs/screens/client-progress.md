# Progress

| | |
|---|---|
| **Route** | `(client)/(tabs)/progress` |
| **Pattern** | F · Detail read (`UI-UX.md` §UX2) |
| **Density** | Client — spacious |
| **Built in** | `phase-18-habits-metrics-photos/` · `phase-21-progress-reports/` |

---

## Job

**Show a client what has actually changed, without telling them what it means.**

The screen where `COPY.md` §CO2's no-shame rule is easiest to break and most damaging when
broken. A client opens Progress on a bad week as often as a good one.

---

## Wireframe

```
┌────────────────────────────────────────────┐
│  Progress                            👤    │
├────────────────────────────────────────────┤
│ [ Training ][ Body ][ Habits ][ Photos ]   │  segmented · Training default
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────────────┐ ┌──────────────────┐ │
│  │ SESSIONS         │ │ TOTAL VOLUME     │ │
│  │ 42               │ │ 486,200 kg       │ │  facts. no targets,
│  │ last 12 weeks    │ │ last 12 weeks    │ │  no judgement, no %
│  └──────────────────┘ └──────────────────┘ │
│                                            │
│  VOLUME PER WEEK                           │
│  ┌────────────────────────────────────┐    │
│  │              ╱╲      ╱‾╲           │    │  line chart
│  │       ╱‾╲___╱  ╲____╱   ╲__        │    │  no goal line unless the
│  │  ____╱                             │    │  coach set one
│  └────────────────────────────────────┘    │
│   8w                              now      │
│                                            │
│  PERSONAL RECORDS                          │
│  ▲ Bench Press    62.5 kg × 8    2d ago    │  gold · the one celebration
│  ▲ Squat          100 kg × 5     1w ago    │
│                                            │
│  BY EXERCISE                               │
│  Bench Press      60 → 62.5 kg        ›    │  factual delta
│  Squat            95 → 100 kg         ›    │
│  Barbell Row      70 → 70 kg          ›    │  ← no arrow, no colour.
│                                            │     flat is not failure.
└────────────────────────────────────────────┘
```

### Body facet — the sensitive one

```
│  WEIGHT                                    │
│  ┌────────────────────────────────────┐    │
│  │  ●   ●                             │    │  scatter + trend, NOT
│  │    ●   ● ●   ●                     │    │  a line implying certainty
│  │ ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾ trend           │    │
│  └────────────────────────────────────┘    │
│  72.4 kg          last logged 2d ago       │  no goal, no "to go",
│                                            │  no BMI, ever
│  [ + Log weight ]                          │
```

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Training progress | `['progress', 'training', { range }]` | Mount | 5m |
| Body metrics | `['progress', 'body', { range }]` | On facet visit | 5m |
| Habits | `['progress', 'habits', { range }]` | On facet visit | 5m |
| Photos | `['progress', 'photos']` | On facet visit | 5m |

**Facets lazy** (Pattern B rules apply even inside a tab). Charts are **downsampled
server-side** to ~50 points — a phone must never receive 12 weeks of raw sets to draw a line.

**Range changes refetch** with a new key and keep the previous data visible while loading
(`placeholderData: keepPreviousData`) — the chart must not blank out when switching 8w → 12w.

---

## Boundaries

```
┌─ Facet control ────────┐  no data dependency
├─ Stat tiles ───────────┤  fails → "—"
├─ Chart ────────────────┤  fails → "Chart unavailable · Retry", same height
├─ PRs ──────────────────┤  fails → section omitted
└─ By exercise ──────────┘  PRIMARY for this facet — inline error + retry
```

The Photos facet gets an extra rule: **if photos fail to load, show nothing rather than broken
image frames.** A grid of grey rectangles where a client's body photos should be is a worse
experience than an absent section.

---

## States

| State | Treatment |
|---|---|
| **Loading** | Chart skeleton at exact height. No shift. |
| **Empty — new client** | "Your progress will appear here once you've logged a few sessions." **No zeros, no empty chart axes, no 0%.** |
| **Empty — body** | "No measurements yet." → *Log weight*. Optional and clearly so. |
| **Empty — photos** | "No photos yet." → *Add photo*. Never encouraging. |
| **Single data point** | Show the number, not a chart. A two-point line implies a trend that does not exist. |
| **Offline** | Cached charts with a "last updated" line |

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| Facet switch | Instant if visited | — |
| Range chips (8w / 12w / 6m / all) | Refetch, keep previous data visible | — |
| Tap chart point | Popover with the exact value and date. No navigation. | — |
| Tap exercise row | Push that exercise's full history | — |
| Log weight | Sheet (Pattern D) | `Light` |
| Photos | Comparison slider (`phase-18-.../progress-photos/`). **Screenshot protection on.** | — |

---

## Performance

**Budget: < 800ms p75. Charts must not block the tiles.**

- Server-side downsampling. `victory-native` on ~50 points renders in one frame; on 800 it
  does not.
- Charts render **after** tiles — the numbers a client came for should not wait on a graph.
- Photo grid uses `expo-image` with blurhash, thumbnails only. Full resolution loads on tap.
- `expo-screen-capture` active on the Photos facet (`CLAUDE.md` §21.2), released on leave.

---

## Risks

**This is the screen where the no-shame rule breaks.** Every one of these is a natural
implementation choice and every one is forbidden:

| ✗ | Why |
|---|---|
| "You're 3 kg from your goal" | A prescription and a judgement (`COPY.md` §CO1) |
| A red down-arrow on a flat lift | Flat is not failure. No colour, no arrow. |
| "0% complete" on a new client | Loss framing on day one |
| A goal line the client did not set | Only if the coach set a target |
| BMI, body-fat categories, or any health classification | Diagnosis. Never. |
| A streak that breaks visibly | `COPY.md` §CO2 — streaks may show, breaks are never announced |
| Comparison to other clients | We are not a social network (`CLAUDE.md` §1.2) |

**Adherence colour used decoratively on charts.** Green/amber/red mean adherence state only
(`DESIGN-SYSTEM.md` §DS2.5). A volume chart is neutral.

**A two-point trend line.** With one or two data points, show numbers. A trend drawn through
two dots is a claim we cannot support.
