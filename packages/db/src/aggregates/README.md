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
| `recomputePersonalRecords(tx, clientId, exerciseId)` | `training.personal_records`                 | Any `training.set_logs` insert                               |
| `recomputeSessionVolume(tx, workoutSessionId)`       | `training.workout_sessions.total_volume_kg` | Marking a `training.workout_sessions` row completed          |

## Current state: stubs, not real logic

Every function above is a placeholder today. Each does the minimum needed to prove the
transactional shape works — read what it needs, write an obviously-inert value (zero, or nothing
at all), return — and is commented `PLACEHOLDER` at the point a later phase must replace it.
**None of them contains real business logic.** Do not build on top of a stub's current output;
replace the function body entirely.

Owning phases, so there's no ambiguity about who implements the real version:

- `recomputeDailySummary` → `phase-13-nutrition/nutrition-summary/01` (the adherence formula)
- `recomputeStorageUsage` → `phase-11-media-pipeline/retention-and-quota` (byte counting + quota)
- `recomputePersonalRecords` → `phase-09-workout-logger/personal-records/01` (Epley 1RM + PR rules)
- `recomputeSessionVolume` → `phase-09-workout-logger/personal-records/01` (volume formula)

`recomputePersonalRecords` is deliberately the one exception to "write an inert zero": there is
no safe placeholder value for a personal record (a fabricated `(record_type, value)` row would
look like real athlete data, not obviously-fake scaffolding), so its stub only reads, never
writes.

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
item, call a version of the recompute step that throws, and confirm that after rollback **neither
the meal item nor any summary row persisted.** That's the one guarantee this task can actually
prove; the real formulas each owning phase adds get their own tests when they land.
