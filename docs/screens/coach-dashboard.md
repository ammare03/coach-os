# Coach dashboard

| | |
|---|---|
| **Route** | `(coach)/(tabs)/index` |
| **Pattern** | A · Scan list (`UI-UX.md` §UX2) |
| **Density** | Coach — informative |
| **Built in** | `phase-10-coach-review-surfaces/coach-dashboard/` |

---

## Job

**Answer "who needs me today?" in under ten seconds, for up to 100 clients.**

This is the screen a coach opens twenty times a day and the one their impression of the
product's speed is formed on. It is a triage surface, not a directory — the client list tab
already exists for browsing.

---

## Wireframe

```
┌────────────────────────────────────────────┐
│ Tuesday, 16 Aug                    ⌕   👤  │  no "Dashboard" title — the date
│                                            │  is more useful than the word
├────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐            │
│  │ NEEDS YOU  │  │ THIS WEEK  │            │  two stat tiles, 2-col grid
│  │     7      │  │   34/48    │            │  hero 48 · Inter Tight
│  │ clients    │  │ sessions   │            │  label 13 · uppercase · muted
│  └────────────┘  └────────────┘            │
├────────────────────────────────────────────┤
│ [ Needs you ][ All ][ Paused ]             │  filter chips · default "Needs you"
├────────────────────────────────────────────┤
│ ◐  Priya Sharma                      2d  › │  56px rows
│    2/5 · new video · unread                │  status glyph LEFT — eye lands there
│                                            │
│ ○  Nikhil Rao                        6d  › │
│    0/5 · check-in missed                   │  ≤3 signals per row
│                                            │
│ ●  Arjun Mehta                       4h  › │
│    5/5 · form check waiting                │
│                                            │
│ ◌  Sara Khan                     invited › │  grey = no data, NOT red
│    invite sent 2d ago                      │
├────────────────────────────────────────────┤
│  🏠      👥      📋      💬      ⋯        │  tab bar — GlassSurface (DS§12)
└────────────────────────────────────────────┘
```

**Hierarchy.** Date → the two numbers that frame the day → the triaged list. A coach who reads
only the top 120px still knows whether today is busy.

**The row is the design.** Glyph (adherence, shape+colour), name, then a single line of the
**most actionable** signals — never a fixed set of fields. "new video" outranks "2/5" because
it is a thing to *do*.

---

## Data contract

| Query | Key | Fires | `staleTime` | Notes |
|---|---|---|---|---|
| Dashboard payload | `['dashboard', { filter }]` | Mount, parallel | 60s | **One request.** Returns stat tiles *and* render-complete rows. Matches the Redis `dash:{coachId}` TTL. |
| Entitlements | `['entitlements']` | Mount, parallel | 5m | For the seat banner only |

**One query for the whole list.** Rows arrive complete — adherence, last-activity, and signal
flags are computed server-side against the materialised summaries (`DATABASE.md` DB§22).
**No row issues its own query** (`UI-UX.md` §UX6.3). At 100 clients that rule is the difference
between 1 request and 101.

**Prefetch.** On press-in of any row, prefetch `['client', clientId]`. On mount, prefetch the
first 5 visible rows' client headers.

**Filter changes do not refetch** when the data is already loaded — filtering happens client-
side over the loaded set, and the query key changes only to keep the cache honest.

---

## Boundaries

```
┌─ Header + stat tiles ──────┐  fails → tiles show "—", date still renders
├─ Seat banner (conditional) ┤  fails → omitted entirely, silently
├─ Filter chips ─────────────┤  no data dependency
└─ Client list ──────────────┘  PRIMARY — may show a full-screen error
```

The stat tiles and the list come from one query, so in practice they fail together — but they
are separately bounded because the tiles are derived and a future change may split them. If
the list fails, the screen has nothing to say and a full error with retry is correct.

---

## States

| State | Treatment |
|---|---|
| **Loading, first ever** | Skeleton: two tile shapes, five row shapes at exact height. No spinner. |
| **Loading, cached** | Cached list renders instantly. Refresh indicator in the header only if >800ms. |
| **Empty — no clients** | "No clients yet." → **Invite your first client**. This is a coach's first-run screen; it must feel like a start, not a void. |
| **Empty — filter matches nothing** | "Nobody needs you right now." → *Show all clients*. Deliberately a good message. |
| **Error** | Full state, retry. |
| **Offline** | Cached list + calm persistent banner. Never an error (`UI-UX.md` §UX4.2). |
| **Over seat limit** | Persistent, non-modal banner above the list. Never blocks the list (`CLAUDE.md` §15.5). |

---

## Interactions

| Action | Behaviour |
|---|---|
| Tap row | Prefetch on press-in → push `client/[id]`. Shared element on the avatar. |
| Pull to refresh | Refetch; keep showing current content throughout |
| Filter chip | Instant, client-side. No loading state. |
| Search | Filters loaded rows locally on keystroke; queries the server after 300ms idle |
| Tap stat tile | No-op. **Tiles are information, not navigation** — a tappable-looking tile that does nothing is worse than one that clearly does not. |

No haptics on this screen. Navigation does not warrant one (`ui-conventions` §5).

---

## Performance

**Budget: < 200ms cached, < 800ms p75 network, ≥55fps at 100 rows** (`CLAUDE.md` §19).

- FlashList, `estimatedItemSize: 56`, fixed height, no variable rows.
- Rows `React.memo`'d; the press handler takes an id and looks up in a stable callback.
- Redis `dash:{coachId}` 60s cache serves the network case.
- Denormalised `coach_id` on leaf tables makes the server query a single indexed scan
  (`DATABASE.md` DB§6).
- Avatars: `expo-image` with `recyclingKey`, 96px source for a 40px slot.
- The tab bar is a `<GlassSurface>` and content scrolls **beneath** it — the list needs bottom
  padding of the bar height plus safe-area inset, or the last client row is unreachable. Verify
  ≥55fps scrolling under the glass bar on the primary iOS device (`DESIGN-SYSTEM.md` DS§12.6).

---

## Risks

**The per-row query.** The most likely implementation mistake and the one that destroys this
screen. Every field a row displays must come from the list payload.

**Signal overload.** Three signals per row is the ceiling. A row showing adherence, volume,
last-seen, unread count, video count, and check-in status is a spreadsheet — the thing the
coach is leaving.

**Rendering a new client as red.** `◌` grey, "invited". A coach's first impression of the
product must not be a screen full of failure (`DESIGN-SYSTEM.md` §DS2.5).

**"Needs you" becoming a judgement.** The label describes *our* triage, not the client's
worth. It is derived from adherence and pending items, and the row text says what is pending —
never "struggling" or "at risk" (`COPY.md` §CO1).
