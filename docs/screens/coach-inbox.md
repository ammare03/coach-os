# Inbox

| | |
|---|---|
| **Route** | `(coach)/(tabs)/inbox` |
| **Pattern** | A · Scan list, **triage variant** (`UI-UX.md` §UX2) |
| **Density** | Coach — informative |
| **Built in** | `phase-12-feedback-comments/feedback-inbox/` |

---

## Job

**Give a coach a queue they can finish.**

Not a notification list — a **triage surface**. Every item has one decision and leaves the
queue when it is made. The Superhuman lesson: the value is in *reaching the end*, and a queue
that can never be emptied stops being opened.

---

## Wireframe

```
┌────────────────────────────────────────────┐
│ Inbox                        7      ⋯      │  count = remaining, not total
├────────────────────────────────────────────┤
│ [ All ][ Videos ][ Check-ins ][ Messages ] │
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐ │
│ │ 📹  Priya · Squat form check           │ │  item type icon, left
│ │     2d ago · 12s                       │ │
│ │     ┌──────────────┐                   │ │
│ │     │  [ poster ]  │  ← inline preview │ │  see it without opening it
│ │     └──────────────┘                   │ │
│ │     [ Review ]           [ Skip ]      │ │  the decision, inline
│ └────────────────────────────────────────┘ │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │ 📋  Nikhil · Weekly check-in           │ │
│ │     1d ago                             │ │
│ │     "Energy low, sleep poor"           │ │  first line of the answer
│ │     [ Review ]           [ Skip ]      │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ ┌────────────────────────────────────────┐ │
│ │ 💬  Arjun                              │ │
│ │     "Should I go up on bench?"         │ │
│ │     4h ago                             │ │
│ │     [ Reply ]            [ Skip ]      │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### Empty — the reward state

```
┌────────────────────────────────────────────┐
│ Inbox                                      │
├────────────────────────────────────────────┤
│                                            │
│                    ✓                       │  understated. One glyph.
│                                            │
│            You're all caught up            │
│         Last item cleared 12m ago          │
│                                            │
│           [ Review this week ]             │  an onward action, not a void
│                                            │
└────────────────────────────────────────────┘
```

**Cards, not rows.** Unlike the dashboard, each item needs enough context to decide *without
opening it* — a video poster, the first line of a check-in, the message itself. A coach should
clear several items without leaving this screen.

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Inbox items | `['inbox', { filter }]` | Mount | 30s |
| — | — | Realtime push via WebSocket | — |

**One query, render-complete items** — poster URLs, preview text, and client names all in the
payload. No per-item fetch.

**Realtime.** New items arrive over the socket and are inserted at the top **without
re-rendering the list** — a coach mid-triage must not have items shift under their thumb. New
items below the fold show as a "3 new" pill at the top, tappable to scroll.

**Prefetch** the destination of the first 3 visible items on mount — the annotator's asset,
the check-in payload, the conversation.

---

## Boundaries

```
┌─ Header + count ────────┐  fails → "Inbox", no count
├─ Filter chips ──────────┤  no data dependency
├─ Item list ─────────────┤  PRIMARY — full error + retry
└─ Per-item preview ──────┘  EACH ITEM independently bounded:
                             a failed poster → icon placeholder,
                             the item still actionable
```

**Per-item boundaries are the unusual part.** One item with a broken preview must not break
the queue. The item renders with its type icon and its actions still work.

---

## States

| State | Treatment |
|---|---|
| **Loading** | Three card skeletons at real height |
| **Empty — caught up** | The reward state above. **Design this properly** — it is the screen's goal and coaches will see it daily. |
| **Empty — never had items** | "Nothing here yet. Items appear when your clients send videos, check-ins, or messages." |
| **Error** | Full state + retry |
| **Offline** | Cached items; actions queue. Replies send on reconnect. |

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| Review | Push the destination, prefetched. Item clears on return **only if acted on**. | — |
| Skip | Removes from queue immediately + 5s undo. Does **not** delete anything. | `Light` |
| Swipe left | Skip | `Light` |
| Reply (inline, messages) | Expands a composer in place — no navigation for a one-line reply | — |
| Tap poster | Inline playback, muted, in the card. **Watch without leaving the queue.** | — |
| Filter | Instant, client-side | — |

**Skip is not dismiss.** The item leaves the *queue*; the video, check-in, and message all
still exist on the client's detail screen. Copy must not imply deletion.

---

## Performance

**Budget: < 800ms p75. ≥55fps with inline video posters.**

- FlashList with `estimatedItemSize` — cards vary by type, so provide a per-type estimate and
  keep each type's height fixed.
- Posters via `expo-image` with blurhash and `recyclingKey`. **Never autoplay** more than one
  inline video; pause on scroll-out.
- Realtime inserts are batched — never one re-render per arriving item.
- Optimistic skip: the item animates out before the server confirms.

---

## Risks

**Making it a notification feed.** If items accumulate and cannot be cleared, the coach stops
opening it and the feedback loop dies. Every item must have a terminal decision.

**A count that never reaches zero.** The badge counts *actionable* items only. Informational
events do not belong here.

**Items shifting under a thumb.** Realtime insertion at the top while a coach is reading item
four is how a coach taps the wrong thing. Pill, then scroll on tap.

**Autoplaying several videos.** Battery, data, and frames — all three, on the screen a coach
uses most.

**Skip reading as delete.** A coach who thinks Skip destroys a client's video will never use
it, and the queue never empties.
