# Server-authored data: no offline write path

> `phase-08-offline-core/sync-engine/03-server-wins.md`. This is that task's deliverable:
> the confirmed architectural boundary behind DB§14.3's second row, and the thing
> `phase-08-offline-core/prefetch` builds its caching strategy against.

## The boundary

DB§14.3 row two — `programs`, targets, `checkin_templates`, assignments — says the
**server** wins, because "coach-authored; the device holds a stale copy."

Coach-authored data flows **one direction only: server → device cache**. It is never
written device → server through the outbox. A coach edits a program online, through the
ordinary `programs.*` / `assignments.*` procedures, and those procedures have no offline
queue involvement at all.

## "Server wins" is not an algorithm here

There is no conflict-resolution code for these tables, and there is nothing to write. The
rule holds **by construction**: these tables never accept an offline-originated write, so
no conflict can occur. Three independent things make that true, and each is asserted in
`../__tests__/server-authored-no-offline-write.test.ts`:

1. **No coach-authored input schema declares `clientLocalId`.** Without an idempotency
   key there is no offline mutation to replay — `api-conventions` §4 makes the key
   mandatory on every offline-writable mutation, and its absence is the same statement
   read the other way.
2. **Every coach-authored input schema rejects one anyway.** They are all built on
   `strictObject` (`packages/schemas/src/strict.ts`), and `flush.ts`'s
   `buildProcedureInput` merges `clientLocalId` into every payload the outbox sends,
   unconditionally. So routing a coach-authored procedure through the outbox does not
   quietly half-work — it fails validation on the first attempt, loudly, in a test.
3. **No coach-authored resolver touches the offline upsert helper** (`./offline-upsert.ts`).
   That helper targets a `UNIQUE (owner, client_local_id)` index; `programs`,
   `program_weeks`, `program_days`, `program_exercises`, and `assignments` have no such
   column and no such index.

None of these depends on anyone remembering the rule. That is the whole design.

## DB§14.6's refinement: `workout_sessions.program_snapshot`

Read literally, "server wins for programs" would rewrite a workout **while the client is
inside it** — prescribed sets changing between set 2 and set 3. They do not.
`workout_sessions.program_snapshot` freezes the prescription at `started_at`; an
in-progress session renders from the snapshot and ignores every later program edit. The
coach's change is real, is saved, and applies to the **next** session generated from that
program day.

This is a **refinement of DB§14.3, not an exception to it.** The server still wins for
programs — the device never authors one, and the snapshot is written server-side, not sent
up from a device. What the snapshot changes is _when_ the client's view of the program is
sampled, not _who_ owns it. A `scheduled` session that has not started has no snapshot and
takes edits normally.

Both sides are told, once and non-blockingly: the client via
`PROGRAM_CHANGED_MID_SESSION` (`ERRORS.md`), the coach at edit time. See
`../features/programs/versioning.md` for the live-reference decision this sits on top of.

## What `prefetch` should assume

- A cached copy of a program, an assignment, a target, or a check-in template is
  **always potentially stale**. It is safe to render from and never safe to reason from.
- It is **always refreshed from the server on next connectivity**. The server copy is the
  only truth; the cache has no merge semantics because it has nothing to merge.
- It is **never written back**. There is no local edit path, no outbox entry, no
  `sync_state` on these rows. If a screen appears to need one, the requirement is wrong,
  not the boundary — a coach editing a program is online by definition.
- Dropping the cache is always safe and never loses work. That is what makes the local
  mirror's "on schema mismatch, drop and re-fetch" rule (`offline-sync` §8) unconditional
  for this data, where it has to wait for an empty outbox for device-authored rows.

## One thing that looks like a counter-example and is not

`./materialise-sessions.ts` writes a `workout_sessions.client_local_id` when an assignment
materialises sessions. That is DB§14.5 mechanism 1 — a _deterministic_ key derived
server-side, from `(client_id, assignment_id, scheduled_date)`, so two devices logging the
same scheduled session converge on one row. It is not an offline-originated write and it
is not on a coach-authored table: `assignments.create`'s own input carries no
`clientLocalId`, and no device supplies one.

## Current state (audited September 2026)

| DB§14.3 table       | Procedures                                            | Verdict                                                          |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `programs`          | `programs.*` incl. `weeks.*`, `days.*`, `exercises.*` | Built (P07). No `clientLocalId`, no outbox path.                 |
| assignments         | `assignments.*`                                       | Built (P07). No `clientLocalId`, no outbox path.                 |
| `checkin_templates` | `checkins.templates.*`                                | **Not built.** P17 is unstarted; the router is registered empty. |
| targets             | `nutrition.plans.*`                                   | **Not built.** P13 is unstarted; the router is registered empty. |

The two unbuilt prefixes are already declared in the guardrail test, so the first
procedure either phase adds is covered without anyone coming back here.
