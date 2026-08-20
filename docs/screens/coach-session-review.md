# Session review

| | |
|---|---|
| **Route** | `(coach)/session/[id]` |
| **Pattern** | F · Detail read (`UI-UX.md` §UX2) |
| **Density** | Coach — informative |
| **Built in** | `phase-10-coach-review-surfaces/session-review/` · `phase-12-feedback-comments/` |

---

## Job

**Let a coach read a logged session and attach feedback to the exact set it is about.**

The coach half of the core loop. `CLAUDE.md` §1's promise — *every piece of feedback is
attached to the exact thing it is about* — is delivered or lost here.

---

## Wireframe

```
┌────────────────────────────────────────────┐
│ ‹  Tuesday · Upper A                 ⋯     │
│    Priya · 62 min · 2d ago                 │
├────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌─────────┐ │
│  │ VOLUME     │ │ SETS       │ │ RPE avg │ │  summary first — a coach
│  │ 12,450 kg  │ │ 22         │ │ 8.2     │ │  decides in 2 seconds
│  └────────────┘ └────────────┘ └─────────┘ │  whether to engage
│  ▲ 8% vs last                              │
├────────────────────────────────────────────┤
│                                            │
│  BENCH PRESS                    3×8–10 @8  │  prescription on the right
│   1   60 kg × 8    RPE 8              💬   │  ← per-set comment affordance
│   2   60 kg × 8    RPE 8                   │
│   3   60 kg × 7    RPE 9   ▲PR        💬   │  PR badge · gold
│                                            │
│   💬 "Depth looked great on 3"             │  existing comment, inline
│      you · 1d ago                          │
│                                            │
│  BARBELL ROW                    3×10 @7    │
│   1   70 kg × 10   RPE 7                   │
│   2   70 kg × 10   RPE 8              💬   │
│   ⚠ swapped from Pull-up                   │  client modification, flagged
│                                            │
│  📹 Form check · Squat              ›      │  media inline where it belongs
│                                            │
│  CLIENT NOTES                              │
│  "Shoulder felt tight on press"            │  ← the thing coaches actually
│                                            │     want to see
├────────────────────────────────────────────┤
│  [ 💬 Comment on session ]      [ ✓ Done ] │  persistent
└────────────────────────────────────────────┘
```

**The `💬` on a set row is the whole product.** It appears on hover-equivalent (always visible
at 32×32, expanding to a 48 target) and opens the composer bound to that `set_log`. A coach
must never have to scroll to a bottom bar to comment on a specific set.

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Session detail | `['session', id]` | Mount | 30s |
| Comments | `['comments', 'workout_session', id]` | Mount, **parallel** | 0 + realtime |
| Previous session (for deltas) | Included in the session payload | — | — |

**One session query returns everything renderable**: sets, exercises, PRs, modifications,
client notes, and attached media metadata. **No per-set or per-exercise query**
(`UI-UX.md` §UX3.2) — a 22-set session would otherwise issue 22 requests.

The "▲ 8% vs last" delta is computed server-side and included. The device never fetches a
previous session to subtract it.

**Prefetch** from client detail and the dashboard on press-in.

---

## Boundaries

```
┌─ Header ─────────────────┐  fails → date + client name from cache
├─ Summary tiles ──────────┤  fails → "—", same size
├─ Set list ───────────────┤  PRIMARY — full error + retry
├─ Comments ───────────────┤  fails → inline error; NEW comments still post
├─ Attached media ─────────┤  fails → row shows "unavailable", session intact
└─ Action bar ─────────────┘  no data dependency — always works
```

**The comment boundary matters most.** If loading existing comments fails, the coach must
still be able to leave one. Read and write are separate paths and must fail separately.

---

## States

| State | Treatment |
|---|---|
| **Loading** | Skeleton: three tiles, exercise groups at real height. No shift on arrival. |
| **Session in progress** | Live-updating with a `realtime` chip. Sets appear as they are logged. Read-only until complete. |
| **Skipped session** | Shows the skip reason, no set list, comment still available |
| **Empty (no sets)** | "Started but nothing logged." No blame, no red. |
| **Forbidden** | `NOT_FOUND` treatment |
| **Offline** | Cached session renders; comments queue and send on reconnect |

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| Tap `💬` on a set | Composer sheet bound to that `set_log`. **Two taps from screen to attached feedback.** | — |
| Comment on session | Same composer, session-scoped | — |
| Long-press a set | Quick reactions (👍 🔥 ⚠) — one tap acknowledgement without composing | `Light` |
| Tap media row | Push the annotator, prefetched | — |
| Done | Marks `reviewed_at`, returns to the previous screen | `Success` |
| Tap a PR badge | Shows the previous best. Non-blocking popover. | — |

**Comments are optimistic** — they appear instantly, attributed, and reconcile behind
(`UI-UX.md` §UX3.6).

---

## Performance

**Budget: < 800ms p75 network, < 200ms cached.**

- One query, one payload. A 22-set session is a few KB.
- Exercise groups memoised; set rows are plain views — at ~25 rows a FlashList costs more
  than it saves.
- Media rows show poster thumbnails only; the video is never loaded here.
- Comment composer is lazy — the sheet's code loads on first open.

---

## Risks

**Burying the per-set comment.** If commenting on set 3 requires a menu, a long-press, or a
scroll to a bottom bar, coaches will comment on the session generically — and the product
becomes WhatsApp with extra steps. The affordance is visible, inline, and 48×48.

**Blocking new comments when old ones fail to load.** Separate boundaries, separate paths.

**A per-set query.** 22 requests for one screen.

**Showing modifications as failures.** A client swapping an exercise is information, not
misbehaviour. `⚠` is neutral amber, and the copy is "swapped from Pull-up" — never "did not
follow the program" (`COPY.md` §CO2).
