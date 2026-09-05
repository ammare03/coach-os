// The one test in this task that actually matters (see README.md):
// proving the transactional SHAPE — not the future business logic — makes
// DB§8.2's claim true: "it must be impossible to write a meal and not
// update the summary." A real Postgres via Testcontainers, not a mock —
// mocking Drizzle would test the mock, not the rollback behaviour
// (`testing` skill §4).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createDbClient, type DbClient } from '../client.ts';
import { clientProfiles, coachProfiles, users } from '../schema/identity.ts';
import { dailyNutritionSummary, meals } from '../schema/nutrition.ts';

import { recomputeDailySummary } from './recompute-daily-summary.ts';

let container: StartedTestContainer;
let db: DbClient;
let coachId: string;
let clientId: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential, same as docker-compose.yml/.env

  // Applies the real migration set via the real CLI (a subprocess, not an
  // imported function) — not a hand-built minimal schema, so this test
  // can never drift from what `pnpm db:migrate` actually produces.
  // Spawned rather than imported because `migrate.ts` uses `import.meta
  // .url`, which ts-jest's CommonJS transpile (jest.node.js) can't
  // execute directly. `__dirname` (not `import.meta.url`) here for the
  // same reason — this file is transpiled to CommonJS too.
  const migrateScript = path.join(__dirname, '..', 'migrate.ts');
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });

  const [coachUser] = await db
    .insert(users)
    .values({ email: 'coach@aggregates-test.com', passwordHash: 'x', name: 'Coach', role: 'coach' })
    .returning({ id: users.id });
  if (!coachUser) throw new Error('seed insert into users (coach) did not return a row');
  const [coachProfile] = await db
    .insert(coachProfiles)
    .values({ userId: coachUser.id })
    .returning({ id: coachProfiles.id });
  if (!coachProfile) throw new Error('seed insert into coach_profiles did not return a row');
  coachId = coachProfile.id;

  const [clientUser] = await db
    .insert(users)
    .values({
      email: 'client@aggregates-test.com',
      passwordHash: 'x',
      name: 'Client',
      role: 'client',
    })
    .returning({ id: users.id });
  if (!clientUser) throw new Error('seed insert into users (client) did not return a row');
  const [clientProfile] = await db
    .insert(clientProfiles)
    .values({ userId: clientUser.id, coachId })
    .returning({ id: clientProfiles.id });
  if (!clientProfile) throw new Error('seed insert into client_profiles did not return a row');
  clientId = clientProfile.id;
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

describe('recomputeDailySummary — transactional atomicity', () => {
  it('rolls back both the meal write and the summary row when the transaction fails after the recompute call', async () => {
    const loggedDate = '2026-08-22';

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(meals).values({
          clientId,
          coachId,
          loggedDate,
          mealType: 'breakfast',
          clientLocalId: 'atomicity-rollback-test',
        });
        await recomputeDailySummary(tx, clientId, loggedDate);
        throw new Error('simulated failure after both writes');
      }),
    ).rejects.toThrow('simulated failure after both writes');

    const mealRows = await db
      .select()
      .from(meals)
      .where(and(eq(meals.clientId, clientId), eq(meals.clientLocalId, 'atomicity-rollback-test')));
    expect(mealRows).toHaveLength(0);

    const summaryRows = await db
      .select()
      .from(dailyNutritionSummary)
      .where(
        and(
          eq(dailyNutritionSummary.clientId, clientId),
          eq(dailyNutritionSummary.date, loggedDate),
        ),
      );
    expect(summaryRows).toHaveLength(0);
  });

  it('commits both the meal write and the summary row when the transaction succeeds', async () => {
    const loggedDate = '2026-08-23';

    await db.transaction(async (tx) => {
      await tx.insert(meals).values({
        clientId,
        coachId,
        loggedDate,
        mealType: 'lunch',
        clientLocalId: 'atomicity-commit-test',
      });
      await recomputeDailySummary(tx, clientId, loggedDate);
    });

    const mealRows = await db
      .select()
      .from(meals)
      .where(and(eq(meals.clientId, clientId), eq(meals.clientLocalId, 'atomicity-commit-test')));
    expect(mealRows).toHaveLength(1);

    const summaryRows = await db
      .select()
      .from(dailyNutritionSummary)
      .where(
        and(
          eq(dailyNutritionSummary.clientId, clientId),
          eq(dailyNutritionSummary.date, loggedDate),
        ),
      );
    expect(summaryRows).toHaveLength(1);
  });
});
