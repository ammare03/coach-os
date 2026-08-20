# Food logger

| | |
|---|---|
| **Route** | `(client)/log-food` (sheet) · `(client)/scan` (focus mode) |
| **Pattern** | D · Compose sheet (`UI-UX.md` §UX2) |
| **Density** | Client — spacious |
| **Built in** | `phase-13-nutrition/food-search-and-scan/` · `.../diary/` |

---

## Job

**Barcode scan → logged in ≤4 taps** (`CLAUDE.md` §23, P13's exit gate).

Food logging is the highest-friction, highest-abandonment activity in any fitness product. A
client logs 3–5 times a day, every day; every extra tap is multiplied by a thousand. The tap
count *is* the design.

---

## Wireframe

### The sheet

```
┌────────────────────────────────────────────┐
│                                            │  ← scrim, tap to dismiss
├════════════════════════════════════════════┤
│ ═══                                        │
│ Add to Lunch                        Cancel │  meal inferred from time of day
├────────────────────────────────────────────┤
│ ⌕ Search foods                      📷     │  input auto-focused
│                                     scan   │  camera is ONE tap away
├────────────────────────────────────────────┤
│ RECENT                                     │  recents FIRST — most logging
│  Chicken breast · 100g          165 kcal + │  is repeat logging
│  Basmati rice · 150g            195 kcal + │
│  Whey protein · 1 scoop         120 kcal + │
│                                            │
│ YOUR MEALS                                 │  saved combos
│  ⊞ Post-workout                 340 kcal + │
│                                            │
├────────────────────────────────────────────┤
│  ● 2 items · 285 kcal                      │  running total
│  ┌──────────────────────────────────────┐  │
│  │            ADD 2 ITEMS               │  │  states what will happen
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### Scan — focus mode

```
┌────────────────────────────────────────────┐
│ ✕                              🔦          │
├────────────────────────────────────────────┤
│                                            │
│         ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐                │
│         │                 │                │  viewfinder
│         │   ▌▌▌ ▌ ▌▌▌     │                │  continuous scan,
│         │                 │                │  no shutter button
│         └ ─ ─ ─ ─ ─ ─ ─ ─ ┘                │
│                                            │
│         Point at a barcode                 │
├════════════════════════════════════════════┤
│ ┌────────────────────────────────────────┐ │  ← result slides up
│ │ Amul Masala Chaas · 200ml              │ │     WITHOUT closing the camera
│ │ 72 kcal · P 3g · C 5g · F 4g           │ │
│ │  ┌──────┐  200 ml  ┌──────┐            │ │
│ │  │  −   │          │  +   │            │ │
│ │  └──────┘          └──────┘            │ │
│ │      ┌────────────────────┐            │ │
│ │      │     ADD TO LUNCH   │            │ │  ← tap 4. Done.
│ │      └────────────────────┘            │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

**The four taps:** ① Log food · ② Scan · ③ *(scan resolves automatically)* · ④ Add to Lunch.
The scan itself is not a tap — continuous detection, no shutter. **Adding a shutter button
would break the gate.**

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Recents + saved meals | **Local SQLite** | Sheet open — instant | — |
| Food search | `['foods', { q }]` | 300ms after typing stops | 24h |
| Barcode lookup | `['food', 'barcode', code]` | On detection | Permanent |
| Today's diary | `['nutrition', { date }]` | Background | 30s |

**Search is local-first.** The top ~200 foods are mirrored on device
(`phase-08-offline-core/prefetch/02`). Typing filters the local set **on every keystroke**,
instantly, then merges server results when they arrive. The client sees results before the
network is consulted.

**Barcode lookup order:** local cache → our `foods` table → Open Food Facts → USDA. A resolved
barcode is written to `foods` permanently, so the second client to scan that product gets it
instantly.

**Writes** are optimistic and offline-capable via the outbox. The `daily_nutrition_summary`
recomputes in the same server transaction (P13's exit gate).

---

## Boundaries

```
┌─ Sheet header ──────────┐  no data dependency
├─ Search input ──────────┤  no data dependency — ALWAYS usable
├─ Recents ───────────────┤  local — fails → section omitted
├─ Search results ────────┤  fails → "Search unavailable. Recents still work."
├─ Barcode result ────────┤  fails → "We don't have that barcode yet." → Add manually
└─ Add action ────────────┘  no data dependency — ALWAYS works
```

**Manual entry is the universal fallback.** Every failure path in this screen ends at "add it
manually" rather than a dead end. A client must always be able to log something.

---

## States

| State | Treatment |
|---|---|
| **Sheet open** | Input focused, recents visible. Zero wait. |
| **Typing** | Local matches instantly; server results merge in. No spinner. |
| **No results** | "No match. Add it manually and we'll remember it." → *Add food* |
| **Barcode unknown** | Same, pre-filled with the barcode |
| **Camera permission denied** | Explain once, offer search. Never re-prompt. |
| **Offline** | Recents and local search work. Scanning works for cached barcodes. New lookups say so honestly. |
| **Just logged** | Sheet closes, a toast confirms with undo, the diary updates optimistically |

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| `+` on a food | Adds to the pending list, running total updates. **Sheet stays open** — multi-item logging is one flow. | `Light` |
| Barcode detected | Result card slides up. Camera stays live. | `Light` |
| Quantity stepper | Native increments (100g, 1 serving); macros update live | `Light` |
| Add | Optimistic write, sheet closes, undo toast | `Success` |
| Save as meal | Long-press the pending list → saves the combo for one-tap reuse | — |

**Meal type is inferred from the time of day** and changeable with one tap. A client logging
at 13:00 should not have to tell us it is lunch.

---

## Performance

**Budget: keystroke → results < 400ms** (`CLAUDE.md` §19).

- Local search is a synchronous SQLite query over ~200 rows — sub-millisecond.
- Server search debounced 300ms, cached 24h under a query hash (`food:q:{hash}` in Redis).
- Barcode detection runs on the native thread via `expo-camera`; no JS in the detection loop.
- Recents list is short and unvirtualised — a FlashList for 10 rows is overhead.

---

## Risks

**Adding a shutter button.** Breaks the ≤4-tap gate and makes scanning feel like photography
rather than detection.

**Closing the camera on each scan.** A client logging three items should scan three times
without the camera dismounting — remounting the camera costs ~600ms each time.

**A network-first search.** On gym wifi, a 2-second search makes food logging intolerable.
Local first, always.

**Losing the pending list on dismiss.** A drag-dismiss with items pending must confirm
(`UI-UX.md` §UX2 Pattern D).

**Showing food names in analytics or logs.** A food diary is health data and, in several
markets, religious and cultural data (`ANALYTICS.md` §AN2.1). Counts and IDs only.

**Judging the food.** No colour-coding foods as good or bad, no warnings, no "you're over
your target" framing. Targets are the coach's; the app reports the number
(`COPY.md` §CO1).
