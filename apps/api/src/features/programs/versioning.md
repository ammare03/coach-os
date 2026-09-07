# Program versioning: live-reference, not snapshot

> `assignment/00-versioning-and-live-assignments.md`. This is that task's real
> deliverable — `assignment/01` onward, and `program-templates/04`'s reservation of
> `programs.version` inside `update-program.ts`, read this as settled, not as a proposal.

## Decision: live-reference. `assignments.program_id` points at the template directly.

An `assignment` row (`assignment/01`) does **not** deep-copy a program at assignment
time. It holds a plain foreign key to `training.programs`, the same row the coach edits
in the builder. A client's session materialisation (`assignment/03`) reads program
content — weeks, days, exercises, targets — live through that reference, every time it
renders an upcoming session's target line. Editing a template a client is currently
assigned to is visible to that client **immediately**, and this is the intended
behaviour, not a bug.

## Why, against the alternative

`DATABASE.md` DB§5.2 defines `training.programs.version` with no stated behaviour, and
neither it nor `CLAUDE.md` states outright which of the two models — live-reference or
snapshot — `assignments` should use. Two shapes were on the table:

1. **Snapshot.** `assignments.create` deep-copies the program (`program-templates/02`'s
   duplication logic) into a client-specific, non-template copy. A template edit
   afterward never reaches an already-assigned client. `version` would exist purely for
   the coach's own change-tracking on the template, disconnected from any client.
2. **Live-reference.** `assignments.program_id` points at the template. A template edit
   is immediately visible to every client currently assigned to it. `version` counts how
   many times the template's content has changed.

**`CLAUDE.md` §8.4's acceptance criterion decides this**: it names "bulk-edit an
exercise across all clients on a program" as a capability the product wants. That
criterion is incoherent under snapshot — if `assignments.create` had already forked the
program into N independent copies, there would be no single shared program left to bulk-
edit _across_ clients; the coach would need to edit N snapshots individually, which is
the exact admin burden §1 of `CLAUDE.md` says CoachOS exists to remove ("Let me change
Tuesday's session for 12 clients without opening 12 chats"). Live-reference is the only
model that makes §8.4's criterion possible at all: one program row, N assignments
pointing at it, one edit visible everywhere at once.

**Rejected: snapshot-at-assignment.** Beyond breaking §8.4, it would also mean a coach
correcting a typo'd rep range, fixing a dangerous target weight, or swapping a
contraindicated exercise would need a separate mechanism to push that fix to every
already-assigned client — precisely the propagation live-reference gives for free.

## What `version` does and does not mean

`version` is a **change-tracking counter on the program row**, incremented once per
structural edit. It answers "how many times has a coach changed this program's actual
content" — a number the coach's own template list or history view can surface later. It
is:

- **NOT a per-session pin.** No `workout_sessions` row stores "the program version this
  session was scheduled against." A session resolves its targets from whatever the
  program contains _at read time_ (until it starts — see below), not from a version it
  was materialised under.
- **NOT a mechanism assignment/session code reads to decide anything.** Nothing branches
  on `version`'s value. It is written and it can be displayed; it does not gate access,
  trigger a notification, or drive materialisation logic. (A "your coach updated your
  plan" notification, if ever built, would be triggered by the same structural-edit call
  site that bumps `version` — not derived from reading `version` after the fact.)
- **Maintained in application code, inside the same transaction as the edit that earns
  it** (`apps/api/src/features/programs/program-version.ts`, `bumpProgramVersion`) —
  never a database trigger, per DB§8.2's rule for business-logic-bearing derived values.
  A crash between the content write and the version bump is impossible by construction:
  both happen inside one `db.transaction`, so either both commit or neither does.

## What counts as structural (bumps `version`) vs. cosmetic (does not)

| Bumps `version`                                                                                                                                                                     | Does not bump `version`                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add / delete / duplicate a program week (`programs.weeks.create/delete/duplicate`)                                                                                                  | Program name, description (`programs.update`)                                                                                                                                                                                                                     |
| Add / update / delete / duplicate a program day, including renaming a day, moving it to another slot, or flipping it to a rest day (`programs.days.create/update/delete/duplicate`) | `programs.isTemplate` toggle (`programs.update`) — stops the program offering itself for assignment; not a content edit                                                                                                                                           |
| Add / update / delete a program exercise block, including every target field (sets, reps, RPE, RIR, weight, %1RM, rest, tempo) (`programs.exercises.create/update/delete`)          | `programs.durationWeeks` changed on its own via `programs.update` — the declared ceiling, not authored content. (Raising it via `weeks.create`/`weeks.duplicate`'s own auto-raise already bumps `version` once, for the week that was actually added — see below) |
| Reorder a day's exercises (`programs.exercises.reorder`)                                                                                                                            | Archiving / unarchiving a program (`programs.archive`/`unarchive`) — a listing-visibility flag; per its own comment, "never disturbs a client already assigned to it"                                                                                             |
| Group / ungroup a superset (`programs.exercises.setSupersetGroup`)                                                                                                                  | Creating a brand-new program (`programs.create`) or a whole-program duplicate (`programs.duplicate`) — a new row starts at the column default (`version = 1`); there is no prior state to count changes against                                                   |
| Set a block's approved alternatives (`programs.exercises.setAlternatives`)                                                                                                          |                                                                                                                                                                                                                                                                   |

**Why `duration_weeks` alone is not structural.** Raising it via `programs.update`
changes only the program's declared length — a bare number a coach can move up or down
before ever writing week 5's content. It has no effect on what any assigned client's
upcoming session actually shows, because there is no new week/day/exercise content
behind it yet. When a coach actually **adds** week 5 (`programs.weeks.create` or
`weeks.duplicate`), that call already bumps `version` once for the content that was
really added — including in the exact case where it also auto-raises `duration_weeks` as
a side effect of appending past the previous end (`createProgramWeek`'s own comment).
Counting the metadata field a second time on top of that would double-book the same
edit.

**Why `programs.days.update`'s cosmetic-looking fields (a day's `name`, `notes`) still
count.** Unlike the program-level name/description on the details sheet, a day's own
`name` ("Push A") and `notes` are part of the authored session content a client sees on
`today-card` (`phase-09-workout-logger`) — the task's own approach section lists
"updating ... days" as structural without carving out a cosmetic subset of a day's
fields, and there is no product signal that a day's notes are meant to be silently
excluded from the counter a coach uses to track "how much have I changed this program."

## The client-facing consequence — expected, not a bug

Because targets resolve live, **a coach's edit to an upcoming session's targets is
visible to the client immediately**, before that session is ever opened. A coach fixing
next Tuesday's targets on Monday is corrected by Tuesday, with nothing to push, sync, or
re-materialise. If this surfaces during QA as "the client's numbers changed and nobody
told them," it is the live-reference model working as designed (`assignment/00`'s
Approach step 4), not a regression to fix.

## Does this contradict `workout_sessions.program_snapshot` (DB§14.6)? No.

`training.workout_sessions.program_snapshot` already exists in the schema, documented as
"the prescription frozen at **start**" (DB§14.6) — frozen the moment the client taps
"Start" on a session that is already in progress, **never** at scheduling or
materialisation time. DB§14.6 states this explicitly: "A session that is `scheduled`
(not started) has no snapshot and takes edits normally."

These two facts compose without conflict:

- **An unstarted, upcoming session always resolves its targets live**, through
  `program_day_id` → the current state of `program_exercises`. This is the live-
  reference model this document decides, and it is what a client's Today card and any
  future-dated session show right up until the moment they press Start.
- **Once a session is `started`, its `program_snapshot` freezes what that one session
  shows for its remaining duration** — so a coach's edit mid-set does not rewrite the
  weight in front of a client who is already mid-lift. That freeze is scoped to the one
  session in progress; every _other_ session generated from that same program day —
  including tomorrow's, and including this same slot next week — still resolves live and
  picks up the edit immediately.

In other words: `program_snapshot` is `assignment/03`'s and DB§14.6's answer to "what
does _this one session, already open_ show," and live-reference (this document) is the
answer to "what does _every session that hasn't been opened yet_ show." The scope of
each is disjoint by construction — one is per-started-session, the other is
per-not-yet-started-session — so there is exactly one model in effect for any given
session at any given time, never two disagreeing ones.

## For `assignment/04`'s bulk-edit task

`assignment/04` builds "bulk edit an exercise across all clients on a program" against
this resolution. Because every assignment for a program shares one `program_id`, a bulk
edit is: edit the template's `program_exercises` row(s) once, inside a transaction that
also calls `bumpProgramVersion`, and every assignment pointing at that program is
already showing the new content on its next read — there is nothing per-assignment left
to fan the edit out to.

## Product-decision flag

Which model `version` supports was not stated outright in `DATABASE.md` or `CLAUDE.md` —
this is a planning-time reading of `CLAUDE.md` §8.4's bulk-edit criterion, not a decision
Ammar made explicitly. Flagged in `CLAUDE.md` §27 for visibility. The reading is
well-supported (§8.4 is incoherent under the alternative), but it is worth a second look
if `assignment/01`'s or `assignment/04`'s real build surfaces a case this document did
not anticipate.
