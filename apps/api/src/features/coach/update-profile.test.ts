// Real Postgres (`testing` skill §4). The thing worth proving here is what
// the UPDATE actually touches — `coach_profiles` carries §15.7's whole
// billing state alongside the two columns this procedure owns, and a mocked
// Drizzle would happily agree that `.set()` left them alone.
// Same dynamic-import-after-container-starts shape as
// `../invites/create-invite.test.ts`, for the identical reason.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { updateCoachProfile as UpdateCoachProfile } from './update-profile.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let updateCoachProfile: typeof UpdateCoachProfile;

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
  ({ updateCoachProfile } = await import('./update-profile.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let coachSeq = 0;

async function insertCoach(
  overrides: Partial<typeof schema.coachProfiles.$inferInsert> = {},
): Promise<string> {
  coachSeq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${coachSeq}@update-profile-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${coachSeq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id, ...overrides })
    .returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return profile.id;
}

function readProfile(coachProfileId: string) {
  return db.select().from(schema.coachProfiles).where(eq(schema.coachProfiles.id, coachProfileId));
}

describe('updateCoachProfile', () => {
  it('writes the business name and specialties onboarding step 2 collected', async () => {
    const coachProfileId = await insertCoach();

    const result = await updateCoachProfile(db, coachProfileId, {
      businessName: 'Iron & Oak Strength',
      specialties: ['strength', 'powerlifting'],
    });

    expect(result).toEqual({
      businessName: 'Iron & Oak Strength',
      specialties: ['strength', 'powerlifting'],
    });
    const [row] = await readProfile(coachProfileId);
    expect(row?.businessName).toBe('Iron & Oak Strength');
    expect(row?.specialties).toEqual(['strength', 'powerlifting']);
  });

  it('accepts no specialties as an empty array, not as "leave it alone"', async () => {
    const coachProfileId = await insertCoach({ specialties: ['mobility'] });

    await updateCoachProfile(db, coachProfileId, {
      businessName: 'Solo Coaching',
      specialties: [],
    });

    const [row] = await readProfile(coachProfileId);
    expect(row?.specialties).toEqual([]);
  });

  it('leaves every billing column on the row untouched', async () => {
    // The reason this procedure takes an allowlist rather than a partial of
    // the table (`packages/schemas/src/coach.ts`): these columns share a row
    // with the two it owns, and reaching them would be an entitlement bug.
    const coachProfileId = await insertCoach({
      subscriptionTier: 'pro',
      seatPacks: 2,
    });

    await updateCoachProfile(db, coachProfileId, {
      businessName: 'Renamed',
      specialties: ['endurance'],
    });

    const [row] = await readProfile(coachProfileId);
    expect(row?.subscriptionTier).toBe('pro');
    expect(row?.seatPacks).toBe(2);
  });

  it('touches only the caller’s own row', async () => {
    const mine = await insertCoach({ businessName: 'Mine' });
    const theirs = await insertCoach({ businessName: 'Theirs' });

    await updateCoachProfile(db, mine, { businessName: 'Mine, renamed', specialties: [] });

    const [otherRow] = await readProfile(theirs);
    expect(otherRow?.businessName).toBe('Theirs');
  });
});
