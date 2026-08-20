# Workout logger

| | |
|---|---|
| **Route** | `(client)/workout/[sessionId]` |
| **Pattern** | C · Focus mode (`UI-UX.md` §UX2) |
| **Density** | Client — spacious |
| **Built in** | `phase-09-workout-logger/` (7 features, the largest in the plan) |

---

## Job

**Log a set in under two taps, one-handed, with chalky hands, in a basement with no signal.**

The most important screen in CoachOS. Every architectural decision in the product —
offline-first, the outbox, optimistic writes, the local SQLite mirror — exists so that this
screen never waits.

---

## Wireframe

### Set entry — the default state

```
┌────────────────────────────────────────────┐
│ ✕                            2 of 6        │  exit + position. Nothing else.
├────────────────────────────────────────────┤
│                                            │
│  BENCH PRESS                               │  title 20 · 600
│  3 × 8–10 @ RPE 8                          │  target line · muted
│  last time: 60 kg × 9                      │  ← the single most useful line
│                                            │     on the screen
├────────────────────────────────────────────┤
│  SET 3 OF 4                                │  label 13 · uppercase
│                                            │
│   ┌──────┐                    ┌──────┐     │
│   │  −   │     60.0  kg       │  +   │     │  NumberStepper
│   └──────┘      display 48    └──────┘     │  56×56 hit areas
│                                            │
│   ┌──────┐                    ┌──────┐     │
│   │  −   │       8  reps      │  +   │     │
│   └──────┘                    └──────┘     │
│                                            │
│   RPE   [6] [7] [8] [9] [10]               │  optional · chips · 48 tall
│                                            │
├────────────────────────────────────────────┤
│         ┌────────────────────────┐         │
│         │      LOG SET           │         │  primary · bottom third
│         └────────────────────────┘         │  thumb-reachable
│  ⟨ prev exercise        next exercise ⟩    │
└────────────────────────────────────────────┘
```

### Rest timer — after logging

```
┌────────────────────────────────────────────┐
│ ✕                            2 of 6        │
├────────────────────────────────────────────┤
│                                            │
│              ╭───────────╮                 │  ring = time remaining
│              │           │                 │  arc, not a countdown number
│              │   1:47    │                 │  hero 48 · tabular
│              │           │                 │
│              ╰───────────╯                 │
│                  REST                      │
│                                            │
│         Next: Bench Press · Set 4          │  what's coming
│                                            │
│      [ −15s ]  [ Skip ]  [ +15s ]          │
├────────────────────────────────────────────┤
│         ┌────────────────────────┐         │
│         │      LOG NEXT SET      │         │  always available —
│         └────────────────────────┘         │  never gated behind the timer
└────────────────────────────────────────────┘
```

**Completed sets appear as a compact list** above the stepper once there are any — `1  60kg × 8
RPE 8 ✓` — tappable to edit, swipe to delete with undo.

---

## Data contract

**This screen reads from local SQLite, not from the network.** That is the defining property.

| Source | Key | When |
|---|---|---|
| Session + prescription | Local `local_workout_sessions.payload_json` | Hydrated at session start from the `program_snapshot` |
| Previous performance | Local `local_set_logs`, prefetched | `phase-08-offline-core/prefetch/01` fetches it *before* the session starts |
| Exercise details | Local `local_exercises_cache` | Prefetched |

**No query fires during a session.** Everything the logger needs is on the device before the
client taps Start. If any of it is missing at start time, the session start is what blocks —
never a set entry.

**Writes** go to SQLite, then the outbox (`ARCHITECTURE.md` A§8.2). `clientLocalId` is
generated once, at the tap, and never regenerated.

---

## Boundaries

Deliberately different from every other screen: **the logger has one boundary and it wraps the
whole screen.**

Section-level degradation is wrong here. A logger showing three of four inputs is not a
degraded logger, it is a data-loss risk. If the local state cannot be read, the correct
behaviour is a full error with a recovery path — not a partially functional set entry.

The one independently-bounded element is the **previous-performance line**: if it is missing,
it renders nothing at all and set entry continues normally.

---

## States

| State | Treatment |
|---|---|
| **Loading** | There is none. Local read is synchronous-fast; the session opens instantly. |
| **Offline** | **The default assumption.** No banner, no indicator, no difference. |
| **Sync pending** | A small, calm marker in the header. Never a warning. |
| **Sync failed permanently** | Non-blocking note after the session, on the summary screen — never mid-set (`ERRORS.md` `SYNC_PERMANENTLY_FAILED`) |
| **Claimed by another device** | Blocking sheet, before entry: "You're logging this on another device. Continue here?" (`phase-09-.../08-device-claim.md`) |
| **Coach edited mid-session** | Inline note, once: "Your coach updated this workout. The changes start from your next session." Prescription does **not** change (`phase-09-.../09-program-snapshot.md`). |
| **Exercise removed by coach** | Inline on that exercise: "Your coach removed this. Your logged sets are safe." → Skip · Swap |

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| Stepper ± | Instant local, no animation of layout | `Light` |
| Stepper long-press | Repeats with acceleration | `Light` per step |
| Tap the number | Numeric keypad only — never the full keyboard | — |
| **Log set** | Writes local, repaints **< 100ms**, enqueues outbox, starts rest timer | `Light` |
| Edit a logged set | Inline, in place. No sheet, no navigation. | — |
| Delete a set | Immediate + 5s undo toast. Never a confirm. | — |
| Swipe / tap next exercise | Local, instant | — |
| Complete session | Confirm sheet showing the summary → summary screen | `Success` |
| Exit (✕) | Session stays in progress. No confirmation — leaving is not destructive. | — |

**Validation failure** — an implausible weight, a negative rep count — is inline and gets
`Warning`. It never blocks the set.

---

## Performance

**Budget: set log → visual confirmation < 100ms. 90-minute session < 25% battery.**

- Everything reads from SQLite. Zero network in the interaction path.
- The stepper does **not** animate layout (`DESIGN-SYSTEM.md` §DS6.3).
- The rest-timer ring is a Reanimated worklet; the screen does not re-render per tick.
- The completed-set list is a FlashList only past ~20 items; below that a plain map is faster.
- `expo-keep-awake` held for the session, released on exit **and on crash recovery**.
- Rest timer completion is a scheduled notification, so it fires with the screen locked
  (needs the iOS background-audio entitlement — `CLAUDE.md` §25.7).

---

## No glass here

**`DESIGN-SYSTEM.md` DS§12.2 forbids Liquid Glass on this screen**, and the reasons are
specific to it rather than general taste:

- Set entry is read one-handed, mid-lift, in bad gym lighting. **Legibility beats beauty**, and
  glass trades contrast for depth.
- The screen runs ~90 minutes holding `expo-keep-awake` against a **<25% battery budget**
  (`CLAUDE.md` §19). Glass is cheap; it is not free, and this is the longest-lived screen in
  the product.
- There is no tab bar here at all — focus mode sits outside the tab layout — so the surface
  glass would normally occupy does not exist.

The stepper, the weight readout, the target line, and the primary action are all opaque tokens.
This is not a gap to fill later.

---

## Risks

**Any network call in the set-entry path.** The single failure that would break this screen's
reason to exist. If a set entry can await anything, the design is wrong.

**Animating the stepper's layout.** A control that reflows under a thumb mid-set is the worst
interaction available in this product.

**Keyboard covering the input on Android.** Budget real device time — `adjustResize` plus
`KeyboardAvoidingView` tuning (`CLAUDE.md` §25.9). This is a named, known cost.

**Losing the session on app kill.** Handled by `phase-09-.../06-kill-recovery.md`; the logger
must not add state that lives only in React.

**Interrupting a set.** No toast, no modal, no upsell, no sync error, no notification banner
may appear during set entry (`UI-UX.md` §UX6.5).

**Testing on a simulator.** Haptics, keyboard behaviour, background timers, and battery are
all wrong there (`testing` skill §11.1).
