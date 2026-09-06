// Real Postgres (`testing` skill §4). The behaviour worth proving is the
// visibility rule — global plus mine, never another coach's — and that is a
// `WHERE` clause, which a mocked Drizzle would return whatever it was told
// to for.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { searchExercises as SearchExercises } from './search-exercises.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let searchExercises: typeof SearchExercises;

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
  ({ searchExercises } = await import('./search-exercises.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@search-exercises-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return profile.id;
}

async function insertExercise(
  name: string,
  overrides: Partial<typeof schema.exercises.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.exercises).values({
    name,
    primaryMuscle: 'quadriceps',
    equipment: 'Barbell',
    movementPattern: 'squat',
    ...overrides,
  });
}

describe('searchExercises', () => {
  it('matches on a fragment of the name, not only a whole word', async () => {
    const coachProfileId = await insertCoach();
    await insertExercise('Zercher Squat Variation');

    const results = await searchExercises(db, coachProfileId, 'ercher squ');

    expect(results.map((r) => r.name)).toContain('Zercher Squat Variation');
  });

  it('returns the library with no query, so the picker opens with something in it', async () => {
    const coachProfileId = await insertCoach();
    await insertExercise(`Aaa Opener ${seq}`);

    const results = await searchExercises(db, coachProfileId, '');

    expect(results.length).toBeGreaterThan(0);
  });

  it('shows the global library and the caller’s own custom exercises, and no one else’s', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    await insertExercise(`Custom Mine ${seq}`, { coachId: mine });
    await insertExercise(`Custom Theirs ${seq}`, { coachId: theirs });

    const results = await searchExercises(db, mine, 'Custom');
    const names = results.map((r) => r.name);

    expect(names.some((name) => name.startsWith('Custom Mine'))).toBe(true);
    expect(names.some((name) => name.startsWith('Custom Theirs'))).toBe(false);
  });

  it('omits an archived exercise', async () => {
    const coachProfileId = await insertCoach();
    await insertExercise(`Retired Movement ${seq}`, { archivedAt: new Date() });

    const results = await searchExercises(db, coachProfileId, 'Retired Movement');

    expect(results).toHaveLength(0);
  });
});
