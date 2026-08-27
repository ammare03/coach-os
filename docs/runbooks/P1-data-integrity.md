# P1 — Data integrity

## What this means

The `integrity.duplicate_sessions` metric is non-zero: the collector
(`apps/api/src/jobs/metrics-collector.ts`) found more than one non-deleted
`training.workout_sessions` row for the same client, program day, and
scheduled date. This is DB§14.5's "two-device bug" — the same workout got
created twice, usually because a client logged from two devices (or the same
device retried after a flaky connection) and both requests landed before the
first one's idempotency key was visible to the second.

This is the one class of failure that gets _worse_ the longer it sits: every
hour the duplicate exists is another hour a coach might review the wrong
session, or the client logs a follow-up set against the wrong one.

## First three checks

1. Read the alert email/push — its `summary` names how many duplicates were
   found, not which ones. Query for the actual rows:
   ```sql
   SELECT id, client_id, program_day_id, scheduled_date, client_local_id, created_at
   FROM training.workout_sessions
   WHERE deleted_at IS NULL AND program_day_id IS NOT NULL
   GROUP BY client_id, program_day_id, scheduled_date, id, client_local_id, created_at
   HAVING COUNT(*) OVER (PARTITION BY client_id, program_day_id, scheduled_date) > 1
   ORDER BY client_id, scheduled_date;
   ```
2. Check `GET /internal/metrics` (operator-gated,
   `apps/api/src/routes/internal/metrics.ts`) for how long
   `integrity.duplicate_sessions` has been non-zero — one collection run or
   several. Several means it's still actively happening, not a one-time blip
   already past.
3. For each duplicate pair, compare `client_local_id` and `created_at` —
   are they from the same device (near-identical timestamp, one
   `client_local_id`) or two devices (different `client_local_id`s, both
   deterministic per DB§14.5)?

## Likely causes

Ranked by frequency, most common first:

1. A genuine two-device write race — the client logged the same scheduled
   workout from their phone and a tablet within the idempotency window.
2. A client retried a failed submission and the retry generated a new
   `client_local_id` instead of reusing the original (a bug in the offline
   outbox once it exists — `offline-sync` skill).
3. A backfill or migration script that didn't respect
   `sessions_client_day_unique`'s partial index scope (e.g. inserted with
   `program_day_id IS NULL` to intentionally bypass it, then had it set
   later).

## What to do

1. **Stop writes to the affected path first.** If this is actively
   recurring (check 2 above shows it non-zero across multiple runs), that
   usually means a specific write path is bypassing the idempotency check —
   identify it from the `client_local_id` pattern before doing anything
   else.
2. **Snapshot the duplicate rows** (a plain `SELECT` into a scratch table or
   a copied result set) before touching anything.
3. Determine which row is the "real" one — typically the one with
   `completed_at` set, more `set_logs` attached, or the earlier
   `created_at`.
4. Coordinate with the client/coach if any coach feedback (comments) already
   points at the row you're about to remove — move it to the surviving row
   first.
5. Once you're certain, soft-delete (`deleted_at`) the duplicate, never a
   hard `DELETE` — this keeps the evidence and lets `set_logs` cascade
   correctly.
6. File the root cause: was it a real two-device race (no code fix needed,
   the system worked as designed and this metric is exactly for catching
   the rare case the unique index didn't) or a genuine idempotency bug
   (open a ticket against the write path).

## What NOT to do

**Do not delete the duplicate rows before snapshotting.** You cannot tell
which one was the retry after the fact, and deleting first destroys the
evidence of _how_ it happened — which is the only way to tell a rare,
harmless race from a real bug in the idempotency mechanism. **Stop writes to
the affected path before investigating**, not after: continuing to accept
writes while you're still working out which row is real risks a client
attaching new data to the row you're about to remove.

## Escalation

If the same client/program-day pair produces a _third_ duplicate after you
believed you'd fixed the cause, stop investigating alone — this means the
root cause wasn't what you thought, and continuing to patch one row at a
time while the underlying bug is still live is how this becomes a
data-integrity incident instead of a one-off.

## Last exercised

Not yet exercised against staging (OB§5.3). Schedule the first walk-through
before ship-gate-1's pilot begins (`docs/PILOT-PLAYBOOK.md`).
