# Today

| | |
|---|---|
| **Route** | `(client)/(tabs)/index` |
| **Pattern** | F · Detail read (`UI-UX.md` §UX2) |
| **Density** | Client — spacious |
| **Built in** | `phase-09-workout-logger/today-card/` |

---

## Job

**Tell the client what to do today, and get them into it in one tap.**

The client app's home. A client opens it in a locker room with 40 seconds of attention. The
screen has exactly one decision to offer: *start, or don't.* Everything else is secondary.

---

## Wireframe

### Session scheduled

```
┌────────────────────────────────────────────┐
│  Tuesday, 16 Aug                      👤   │  no title — the date is the title
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │                                      │  │  the card is the screen
│  │  UPPER A                             │  │  title 20
│  │  6 exercises · ~55 min               │  │  muted
│  │                                      │  │
│  │  Bench Press · Row · Overhead Press  │  │  a preview, not a list
│  │  + 3 more                            │  │
│  │                                      │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │        START WORKOUT           │  │  │  one tap into focus mode
│  │  └────────────────────────────────┘  │  │  full-width · 56 tall
│  └──────────────────────────────────────┘  │
│                                            │
│  THIS WEEK                                 │
│  ● ● ● ○ ○ ○ ○      3 of 5 logged          │  facts, not judgement
│                                            │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ 🍽 Log food   │  │ 📹 Form check│        │  secondary actions
│  └──────────────┘  └──────────────┘        │
│                                            │
│  FROM YOUR COACH                           │
│  💬 "Great depth on those squats —         │  latest feedback, inline
│      let's add 2.5kg next session"         │  tap → the thing it's about
│      Priya · 2h ago                    ›   │
│                                            │
├────────────────────────────────────────────┤
│   🏠      🍽      📈      💬              │  GlassSurface (DS§12)
└────────────────────────────────────────────┘
```

### Rest day

```
│  ┌──────────────────────────────────────┐  │
│  │  REST DAY                            │  │
│  │  Nothing scheduled today.            │  │  factual, not congratulatory
│  │                                      │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │      LOG SOMETHING ANYWAY      │  │  │  never a dead end
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
```

### Session in progress

```
│  ┌──────────────────────────────────────┐  │
│  │  UPPER A · IN PROGRESS               │  │
│  │  Set 8 of 22 · started 18 min ago    │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │           CONTINUE             │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
```

---

## Data contract

| Source | Key | When | Notes |
|---|---|---|---|
| Today's session | **Local SQLite** | Instant | Prefetched by `phase-08-.../prefetch/01`. **Never a network read on this screen.** |
| Week adherence | Local, derived | Instant | Computed from local session rows |
| Latest coach feedback | `['feedback', 'latest']` | Mount, network | Falls back to the local comment mirror |

**Today is offline-complete.** A client with no signal opens the app, sees today's session,
and starts it. That is the whole point of `phase-08-offline-core/prefetch/`.

**Prefetch on mount:** the session detail for the logger, so START is instant.

---

## Boundaries

```
┌─ Date header ───────────┐  no data dependency
├─ Session card ──────────┤  PRIMARY — local read; if it fails, full error + retry
├─ Week strip ────────────┤  fails → omitted
├─ Quick actions ─────────┤  no data dependency — ALWAYS work
└─ Coach feedback ────────┘  fails → section omitted silently
```

**Quick actions never depend on a query.** A client whose session card failed can still log
food and record a form check.

---

## States

| State | Treatment |
|---|---|
| **Session scheduled** | The default. One tap to start. |
| **Rest day** | Factual + an optional action. Never "Enjoy your rest!" (`COPY.md` §CO2). |
| **In progress** | Continue, with position and elapsed time |
| **Completed today** | Summary card + "Log another" |
| **No program assigned** | "No program yet." → *Message your coach*. Not an error. |
| **Missed yesterday** | **Nothing.** Today is about today. Missed sessions are not surfaced here. |
| **Offline** | Identical. No banner. |

> **The missed-session rule is deliberate.** Surfacing "you missed Monday" on the home screen
> is the loss-framing `COPY.md` §CO2 forbids, and it is the reason people delete fitness apps.
> The coach sees it; the client sees today.

---

## Interactions

| Action | Behaviour | Haptic |
|---|---|---|
| START WORKOUT | Push focus mode, claim the session, keep-awake on. Instant — everything is local. | — |
| CONTINUE | Same, resuming position | — |
| Log food | Sheet (Pattern D) | — |
| Form check | Camera focus mode | — |
| Tap feedback | Deep-links to the exact object — the set, the video, the meal | — |

---

## Performance

**Budget: this screen is part of the cold-start path — < 2.0s to first meaningful paint.**

- Renders entirely from local SQLite. The only network call is the feedback line, and it
  degrades to the local mirror.
- The session card is the first thing painted; the rest fills in.
- No images above the fold except the avatar — nothing to wait on.
- Prefetch the logger's data at mount so START never waits.

---

## Risks

**Making this screen a dashboard.** Every additional widget costs a client attention they do
not have. Streaks, badges, macro rings, and motivational quotes have all been proposed for
screens like this and all of them dilute the one decision.

**Any network dependency in the start path.** START must work in a basement.

**Surfacing missed sessions.** See above. It is the most common well-intentioned change that
would break `COPY.md` §CO2.

**A "0 of 5" empty week.** A client on day one of a program has logged nothing and that is
correct. `◌ ◌ ◌ ◌ ◌` with "Nothing logged yet" — never `0%`, never red.
