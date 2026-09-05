// Real Postgres (`testing` skill §4) — the behaviour worth proving is the
// conditional UPDATE, and a mocked Drizzle would only test the mock
// (`phase-06-onboarding/onboarding-infrastructure/02`).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { completeOnboarding as CompleteOnboarding } from './complete-onboarding.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let completeOnboarding: typeof CompleteOnboarding;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
  ({ completeOnboarding } = await import('./complete-onboarding.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

async function insertUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${seq}@complete-onboarding-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `User ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  return user.id;
}

async function readTimestamp(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ onboardingCompletedAt: schema.users.onboardingCompletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row?.onboardingCompletedAt ?? null;
}

describe('completeOnboarding', () => {
  it('stamps onboarding_completed_at on a user who has none', async () => {
    const userId = await insertUser();
    expect(await readTimestamp(userId)).toBeNull();

    const result = await completeOnboarding(db, userId);

    expect(result.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(await readTimestamp(userId)).toEqual(result.onboardingCompletedAt);
  });

  // A retry, a double-tap, or a replayed request must not move the recorded
  // moment — the first completion is the one that stands.
  it('leaves the original timestamp untouched on a second call', async () => {
    const userId = await insertUser();
    const first = await completeOnboarding(db, userId);

    const second = await completeOnboarding(db, userId);

    expect(second.onboardingCompletedAt).toEqual(first.onboardingCompletedAt);
    expect(await readTimestamp(userId)).toEqual(first.onboardingCompletedAt);
  });

  it('touches only the calling user', async () => {
    const mine = await insertUser();
    const theirs = await insertUser();

    await completeOnboarding(db, mine);

    expect(await readTimestamp(theirs)).toBeNull();
  });

  it('throws for a user id that does not exist', async () => {
    await expect(completeOnboarding(db, '00000000-0000-7000-8000-000000000000')).rejects.toThrow();
  });
});
