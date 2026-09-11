# Transactional aggregate helpers

`DATABASE.md` DB§8.2: `daily_nutrition_summary`, `storage_usage`, `personal_records`, and
`workout_sessions.total_volume_kg` are maintained **by the application, inside the same
transaction as the write that changes them** — never by a Postgres trigger. They need business
logic (the adherence formula, PR rules, byte-counting, plate math) that doesn't belong in
`plpgsql`, and keeping it in the application keeps it testable in Jest (`CLAUDE.md` §18.1).

Every function in this directory follows one shared shape:

```ts
(tx: Transaction, ...ids) => Promise<void>;
```

`tx` is always a Drizzle transaction handle **passed in by the caller** — a recompute function
never opens its own transaction. Call it like this, every time:

```ts
await db.transaction(async (tx) => {
  await tx.insert(mealItems).values(items);
  await recomputeDailySummary(tx, clientId, loggedDate); // same tx
});
```

If `recomputeDailySummary` throws, the whole transaction — including the `mealItems` insert —
rolls back. **This is the entire point.** DB§8.2's own words: "it must be impossible to write a
meal and not update the summary." Any code path that writes to `meal_items` outside a paired
call to `recomputeDailySummary`, in the same transaction, is a bug — not a style preference.

## The four functions, and every write path each one pairs with

| Function                                             | Table it maintains                          | MUST be called in the same transaction as                    |
| ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `recomputeDailySummary(tx, clientId, loggedDate)`    | `nutrition.daily_nutrition_summary`         | Any insert, update, or delete against `nutrition.meal_items` |
| `recomputeStorageUsage(tx, userId)`                  | `platform.storage_usage`                    | Any `coaching.media_assets` insert or (soft-)delete          |
| `recomputePersonalRecords(tx, clientId, exerciseId)` | `training.personal_records`                 | Any `training.set_logs` insert, edit, or withdrawal          |
| `recomputeSessionVolume(tx, workoutSessionId)`       | `training.workout_sessions.total_volume_kg` | Marking a `training.workout_sessions` row completed          |

## Current state: two implemented, two still stubs

**`recomputeSessionVolume` is real** as of `phase-09-workout-logger/session-runtime/07-completion`,
which is the task that owns the volume formula and the `workouts.complete` procedure that calls it.
It sums `reps × weight_kg` across non-warm-up, non-deleted sets, in one SQL statement, and stores
`NULL` — never `0` — when no working set carries both. See the file's own header for why the rule
exists in SQL here and in TypeScript in `packages/utils`' `sessionVolumeKg`, and where the two are
pinned against each other (`apps/api/src/routers/__tests__/workouts.complete.test.ts`).

**`recomputePersonalRecords` is real** as of `phase-09-workout-logger/personal-records/02`. It is the
one place in the product that decides what a personal record is: the highest estimated 1RM, weight,
rep count, and volume across a client's performed working sets for one exercise, each credited to the
set that first reached it, with ties keeping the earlier set. It **derives from history rather than
accumulating**, so an edit that lowers a number (`set-entry/05`) or a withdrawal (`set-entry/06`) can
take a record away — which an incremental "is this bigger than the stored record" check never could.
`apps/api/src/lib/pr-detection.ts` is its hot-path caller and deliberately holds no second opinion
about any of those rules: it reads, calls this, reads again, and reports which types the new set took.
Tests: `recompute-personal-records.test.ts` (the rules) and `apps/api/src/lib/pr-detection.test.ts`
(the seam).

The remaining two are placeholders. **Neither contains real business logic**, and neither writes a
fabricated value — both throw. Do not build on top of a stub's current output (there isn't one);
replace the function body entirely.

Owning phases, so there's no ambiguity about who implements the real version:

- `recomputeDailySummary` → `phase-13-nutrition/nutrition-summary/01` (the adherence formula)
- `recomputeStorageUsage` → `phase-11-media-pipeline/retention-and-quota/03` (byte counting + quota)
- ~~`recomputePersonalRecords`~~ → **done**, `personal-records/02`
- ~~`recomputeSessionVolume`~~ → **done**, `session-runtime/07`

### The one pairing `recomputeSessionVolume` still needs

Its row in the table above says "marking a `workout_sessions` row completed", and
`workouts.complete` honours it. But a `set_logs` insert for an **already-completed** session also
changes the total, and the completion has usually long since run by then — the completion mutation
chains to the session's start in the outbox, not to its sets, so a straggler set can land after it
(`apps/api/src/features/workouts/complete.ts` decision (f)). `workouts.complete` narrows the window
by recomputing on replay too; closing it is `phase-09-workout-logger/set-entry`'s job, by pairing
its own insert with this function in the same transaction, exactly as this README's table asks of
every other write path.

### What `pnpm db:seed` produces, and the one record type it does not

The seed's `recomputePersonalRecords` call is live, so a seeded client now holds `max_weight`,
`max_reps`, and `max_volume` records for every exercise they have trained. It holds **no
`1rm_estimated` record**, and that is structural. The recompute reads `set_logs.estimated_1rm_kg`
rather than re-expressing Epley in SQL (its own decision (c)); `seed/training-history.ts` never sets
that column, and setting it would need `@coachos/utils`' `estimateOneRepMax` — the dependency
`recompute-session-volume.ts` decision (a) rules this package out of taking. A demo dataset one record
type short beats a second copy of the formula.

F6 (pre-phase-09 audit): three of the four used to upsert an inert-looking zero (`'0'`, `0/0`, a
zeroed row) — correct scaffolding for proving the transactional shape, but a real _lie_ once a
caller starts depending on the output, since `'0'` reads as a genuine (if unusually low) value
rather than "not computed yet." `phase-09` is the trigger: it's about to wire
`recomputeSessionVolume` into `workouts.complete` for real. All three now **throw** instead —
obviously missing beats silently wrong. `recomputePersonalRecords` was always the one exception
(there is no safe placeholder value for a personal record — a fabricated `(record_type, value)`
row would look like real athlete data, not obviously-fake scaffolding), so it already only read,
never wrote, and needed no change.

**Consequence for `pnpm db:seed`**: `seed/training-history.ts`, `seed/nutrition-history.ts`, and
`seed.ts` itself used to call the then-throwing functions. They no longer do (bar the personal-records
call, restored above) — the seed
leaves `daily_nutrition_summary`, `storage_usage`, and `workout_sessions.total_volume_kg` absent
or `null` rather than computing the real formulas itself (which would duplicate business logic
these owning phases haven't written yet, violating the one-implementation rule in
`code-conventions`). A missing row/`null` is the correct "not computed yet" signal — see each
call site's own comment for the reasoning.

## What this task does not do

- The nightly reconciliation job DB§8.2 mentions (recomputes the last 7 days, alerts on drift) —
  `phase-13-nutrition/nutrition-summary/03`. Not schema, an operational job.
- Enforcement that every future call site actually uses this pattern. That's a code-review
  discipline this README exists to support, not something the pattern can guarantee mechanically
  for code that doesn't exist yet. A direct insert into `meal_items` bypassing
  `recomputeDailySummary` is a visible deviation in review — catch it there.

## Testing

`recompute-daily-summary.test.ts` proves the pattern's core guarantee with a real Postgres
(via Testcontainers, not a mock — see the `testing` skill): start a transaction, insert a meal
item, call `recomputeDailySummary` (which throws — see F6 above), and confirm that after
rollback **neither the meal item nor any summary row persisted.** That's the one guarantee this
task can actually prove while the stub throws; the real formulas each owning phase adds get
their own tests when they land.
