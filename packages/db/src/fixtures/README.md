# Test fixtures

Minimal, purpose-built rows for automated tests — not the realistic dataset `../seed/` produces.
A tRPC procedure test asserting "a coach cannot read another coach's client notes" needs exactly
two coaches and one client each, not DB§21's full dataset. Running the full seed before every
test file would make the suite slow and would couple every test's assertions to details of a
dataset that might reasonably change — adding a sixth demo client to the seed should never break
an unrelated authorization test.

## Quick start

```ts
import { createDbClient } from '@coachos/db';
import { twoCoachesWithClients } from '@coachos/db/fixtures'; // or the relative path within packages/db

const db = createDbClient({ connectionString, sslMode: false });

const { coachA, clientA, coachB, clientB } = await twoCoachesWithClients(db);

// Assert coach B's session/token cannot read clientA's data:
const result = await caller(coachB.user.id).clients.get({ clientId: clientA.clientProfile.id });
expect(result).toMatchObject({ code: 'FORBIDDEN' }); // or however your test harness asserts this
```

Fixtures run against a **freshly migrated, unseeded** database — never against `pnpm db:seed`'s
output. Use the same Testcontainers pattern `src/aggregates/recompute-daily-summary.test.ts`
established: spin up Postgres 16, run `db:migrate` as a subprocess, then call fixtures directly.

## The two files

| File           | What it has                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builders.ts`  | One function per table-ish concept: `createCoach`, `createClient(coachId)`, `createExercise(coachId?)`, `createProgram(coachId)`, `createWorkoutSession(clientId, coachId)`, `createComment(clientId, authorUserId)`. Each returns the row(s) it created. |
| `scenarios.ts` | Pre-composed arrangements built from the builders above: `twoCoachesWithClients()`, `oneCoachFullSetup()`.                                                                                                                                                |

## Builder conventions

- **First argument is always a `DbClient` or a transaction handle** (`DbOrTx`, exported from
  `builders.ts`) — never opened internally. Pass a plain `db` for an isolated insert, or a `tx`
  if your test wants everything inside one transaction it can roll back at the end.
- **Every column not explicitly passed gets the simplest value that satisfies every `CHECK`,
  unique, and foreign-key constraint** — read back through the relevant schema file
  (`src/schema/*.ts`) if you're adding a new builder, not guessed. Where a column has its own
  Postgres default (`status` on `client_profiles`, most `timestamps`), the builder leaves it
  alone rather than restating it.
- **`overrides` is always the last parameter**, always optional, always a `Partial<New*>` of the
  table's own inferred insert type (`../types.ts`) — never a hand-written shape. Use it for the
  one field your specific test actually cares about:
  ```ts
  const { clientProfile } = await createClient(db, coachId, {
    profile: { status: 'archived' }, // testing seat-counting logic against an archived client
  });
  ```
- **Uniqueness is real, not deterministic.** Unlike `../seed/`, fixtures don't need DB§21's
  byte-identical guarantee — each call generates a fresh `crypto.randomUUID()`-suffixed value, so
  calling `createCoach()` five times in one test file never collides.

## Adding a new builder

Follow `createExercise`'s shape as the template: accept the table's genuinely-required foreign
key(s) as explicit parameters (not buried in `overrides`), default every other required column,
return the created row via `.returning()`. If nothing already needs it and it's not a table the
next few phases' auth/procedure tests will obviously reach for, hold off — an unused builder is a
maintenance cost with no payoff (this file's own Risks in the task doc).

## Adding a new scenario

Only when it's reusable across multiple future test files — `twoCoachesWithClients()` earns its
place because `phase-02-api-foundation/authorization-middleware/04`'s enumeration test needs
exactly this shape for every resource type it checks. A one-off arrangement belongs in the test
file that needs it, built directly from `builders.ts`, not added here.

## CI decision (seed-and-fixtures/01, task 03's own scope)

`phase-01-data-layer/db-package-scaffold/04-migration-ci.md`'s apply → seed → test → re-apply
cycle uses the **full `pnpm db:seed`** (task 01's realistic dataset), not these fixtures — already
implemented in `.github/workflows/migrations.yml` before this task existed. The full seed
completes in a few seconds against a fresh container (well within CI's budget) and exercising the
complete realistic dataset in that job is valuable in its own right: it's the first thing in the
whole pipeline that would catch a `CHECK` constraint subtly too strict for real interrelated data.
These fixtures exist for a different, faster-turnaround job — isolated procedure and unit tests,
starting in `phase-02-api-foundation` — never for the CI migration cycle.
