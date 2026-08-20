# Program day editor

| | |
|---|---|
| **Route** | `(coach)/program/[id]/day/[dayId]` |
| **Pattern** | E · Form flow, **authoring variant** (`UI-UX.md` §UX2) |
| **Density** | Coach — informative, the densest surface in the product |
| **Built in** | `phase-07-exercise-and-program-authoring/program-builder/` |

---

## Job

**Build a training day — exercises, sets, reps, load, rest, supersets — faster than a
spreadsheet.**

The screen that decides whether a coach migrates. They currently do this in Google Sheets,
which is fast, familiar, and free. **If our version is slower, nothing else matters.**

---

## Wireframe

```
┌────────────────────────────────────────────┐
│ ‹  Week 3 · Day 2                    Save  │  save is explicit here —
│    Upper A                                 │  the ONE place it is
├────────────────────────────────────────────┤
│ ⠿  BENCH PRESS                       ⋯     │  ⠿ = drag handle
│    ┌────┬────────┬────────┬──────┐         │
│    │ SET│  REPS  │  LOAD  │ RPE  │         │  compact grid — the
│    ├────┼────────┼────────┼──────┤         │  spreadsheet feeling,
│    │ 1  │  8–10  │  60 kg │  8   │         │  done properly
│    │ 2  │  8–10  │  60 kg │  8   │         │
│    │ 3  │  8–10  │  60 kg │  8   │         │
│    └────┴────────┴────────┴──────┘         │
│    rest 120s · tempo 3010                  │  secondary, one line
│    [ + Set ]                               │
│                                            │
│ ┌──────────────────────────────────────┐   │
│ │ ⠿  A1  BARBELL ROW              ⋯    │   │  superset bracket
│ │     3 × 10 @ RPE 7                   │   │  collapsed by default
│ │ ⠿  A2  FACE PULL                ⋯    │   │  once configured
│ │     3 × 15 @ RPE 6                   │   │
│ └──────────────────────────────────────┘   │
│                                            │
│  [ + Exercise ]   [ + Superset ]           │
├────────────────────────────────────────────┤
│  ◀ Day 1              Day 3 ▶              │  move between days
│                                    without │  leaving the editor
└────────────────────────────────────────────┘
```

**Expanded when editing, collapsed when configured.** A day with six exercises fully expanded
is unusable; six collapsed summaries with one expanded is exactly right.

---

## Data contract

| Query | Key | Fires | `staleTime` |
|---|---|---|---|
| Program day | `['program', programId, 'day', dayId]` | Mount | 5m |
| Exercise picker | `['exercises', { q }]` | On picker open | 24h |
| Last performance (if assigned) | Included in the day payload | — | — |

**Local draft state.** The whole day is edited in Zustand as a draft, not written per keystroke.
This is one of the few screens where **explicit save is correct**: a coach reordering exercises
and adjusting loads is composing, and autosaving each intermediate state would produce a
version history of nonsense and fire needless invalidations.

**Unsaved changes are persisted locally** so a crash or a backgrounded app does not lose the
work (`phase-06-.../onboarding-infrastructure/01`'s pattern applies here too).

**Prefetch** adjacent days on mount — `◀ Day 1` and `Day 3 ▶` should be instant.

---

## Boundaries

```
┌─ Header + save ─────────┐  no data dependency after load — save ALWAYS available
├─ Exercise list ─────────┤  PRIMARY — full error + retry
├─ Per-exercise block ────┤  EACH independently bounded: one malformed exercise
│                         │  renders an error row, the rest stay editable
└─ Day navigation ────────┘  fails → arrows disabled, editing unaffected
```

**Per-exercise boundaries matter here** more than anywhere except the inbox. A coach with 40
programs will eventually have one row with unexpected data; it must not make the whole day
uneditable.

---

## States

| State | Treatment |
|---|---|
| **Loading** | Skeleton of 3 exercise blocks at real height |
| **Empty day** | "No exercises yet." → **+ Exercise** (large, centred). A rest day is a deliberate choice, not an empty state. |
| **Unsaved changes** | Save button becomes prominent; back prompts to save or discard |
| **Saving** | Button shows progress; the form stays interactive |
| **Save failed** | Inline, non-destructive: "Couldn't save. Your changes are safe." → Retry. **Never lose the draft.** |
| **Assigned to clients** | Banner: "This program is assigned to 4 clients. Changes apply to their next session." Links to `phase-09-.../09-program-snapshot.md`'s behaviour. |
| **Client mid-session** | Additional warning at save: "Priya is training this session now. Your changes apply from her next one." |

> That last state is the coach half of the mid-session edit rule. A coach who thinks they
> fixed a working weight *right now* and did not will make a worse decision than one who
> knows.

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| + Exercise | Picker sheet with search and recents. Multi-select. | — |
| Drag ⠿ | Reorder within the day. Gesture-driven, worklet. | `Light` on drop |
| Tap a cell | Inline edit, numeric keypad. Tab moves to the next cell. | — |
| Long-press an exercise | Duplicate · Convert to superset · Remove | `Light` |
| Remove | Immediate + 5s undo | — |
| Copy day | Duplicates this day into another week. The highest-value shortcut on the screen. | — |
| ◀ / ▶ | Prompts to save if dirty, then navigates | — |
| Save | Writes, invalidates `['program', programId]`, stays on the screen | `Success` |

**Speed shortcuts that earn their place:** copy day, duplicate exercise, apply-to-all-sets
(edit set 1's load, offer to apply to sets 2–3), and paste-from-last-week. Each removes a
multiplied action.

---

## Performance

**Budget: < 800ms load. Reordering at 60fps. No frame drops while typing.**

- Draft state in Zustand with **selectors per exercise block** — editing set 2 of exercise 1
  must not re-render exercises 2–6.
- Reordering via `react-native-reanimated` + gesture handler on the UI thread.
- The set grid is plain views, not a list — a day rarely exceeds ~30 rows and virtualisation
  would break the drag interaction.
- The exercise picker is lazy-loaded and its search is local-first (`phase-07-.../02`).

---

## Risks

**Being slower than a spreadsheet.** The benchmark is Google Sheets, and it is a good one.
Every interaction here should be measured in taps against the equivalent spreadsheet action.

**Re-rendering the whole day per keystroke.** With 30 editable cells, a naive implementation
drops frames on the first device that is not an iPhone 17 Pro.

**Autosaving mid-edit.** Produces junk history, fires invalidations that reload the screen
under the coach, and can push a half-built day to an assigned client.

**Losing a draft.** The highest-severity failure on this screen — a coach who loses twenty
minutes of programming will not build a second one. Persist locally, always.

**Silent effect on assigned clients.** A coach must know their edit reaches four people and
when it takes effect.
