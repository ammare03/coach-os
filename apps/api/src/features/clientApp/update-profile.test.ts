// Real Postgres (`testing` skill §4) — every assertion here is about what
// actually lands in `client_profiles`, including the `numeric` round trip
// and the two `text[]` columns, which a mocked Drizzle client cannot tell
// you anything about. Same container-then-dynamic-import shape as
// `../invites/preview-invite.test.ts`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { client as clientSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { updateClientProfile as UpdateClientProfile } from './update-profile.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let updateClientProfile: typeof UpdateClientProfile;

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
  ({ updateClientProfile } = await import('./update-profile.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;

async function insertClient(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@update-profile-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: 'A Client',
      role: 'client',
      timezone: 'UTC',
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, status: 'invited' })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  return profile.id;
}

function read(clientProfileId: string) {
  return db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.id, clientProfileId))
    .limit(1)
    .then(([row]) => row);
}

/** The whole accumulated draft, exactly as the flow's final step sends it. */
const FULL_DRAFT = {
  goal: 'muscle_gain',
  goalNotes: 'Half marathon in March.',
  dateOfBirth: '1994-03-14',
  sexAtBirth: 'female',
  heightCm: 168,
  experienceLevel: 'intermediate',
  equipmentAccess: ['Full gym', 'Resistance bands'],
  dietaryRestrictions: ['Lactose-free', 'Shellfish'],
} as const;

describe('updateClientProfile', () => {
  it('writes all five steps’ data in one call', async () => {
    const clientProfileId = await insertClient();
    const input = clientSchemas.updateProfileInput.parse(FULL_DRAFT);

    await updateClientProfile(db, clientProfileId, input);

    const row = await read(clientProfileId);
    expect(row?.goal).toBe('muscle_gain');
    expect(row?.goalNotes).toBe('Half marathon in March.');
    expect(row?.dateOfBirth).toBe('1994-03-14');
    expect(row?.sexAtBirth).toBe('female');
    // `numeric(5,1)` comes back as a string (DB§11.2) — asserted as the
    // stored value, not as whatever a client-side parse would make of it.
    expect(Number(row?.heightCm)).toBe(168);
    expect(row?.experienceLevel).toBe('intermediate');
    expect(row?.equipmentAccess).toEqual(['Full gym', 'Resistance bands']);
    expect(row?.dietaryRestrictions).toEqual(['Lactose-free', 'Shellfish']);
  });

  it('stores empty notes as NULL, so “no notes” is one value in the column', async () => {
    const clientProfileId = await insertClient();
    const input = clientSchemas.updateProfileInput.parse({ ...FULL_DRAFT, goalNotes: '   ' });

    await updateClientProfile(db, clientProfileId, input);

    expect((await read(clientProfileId))?.goalNotes).toBeNull();
  });

  it('accepts empty arrays — that is how “none” is expressed', async () => {
    const clientProfileId = await insertClient();
    const input = clientSchemas.updateProfileInput.parse({
      ...FULL_DRAFT,
      equipmentAccess: [],
      dietaryRestrictions: [],
    });

    await updateClientProfile(db, clientProfileId, input);

    const row = await read(clientProfileId);
    expect(row?.equipmentAccess).toEqual([]);
    expect(row?.dietaryRestrictions).toEqual([]);
  });

  // The allowlist is the point: `client_profiles` also carries `coach_id`,
  // `status` and the sharing columns, and none of them may be reachable
  // from this input.
  it('touches nothing outside its allowlist', async () => {
    const clientProfileId = await insertClient();
    const before = await read(clientProfileId);
    const input = clientSchemas.updateProfileInput.parse(FULL_DRAFT);

    await updateClientProfile(db, clientProfileId, input);

    const after = await read(clientProfileId);
    expect(after?.coachId).toBe(before?.coachId ?? null);
    expect(after?.status).toBe(before?.status);
    expect(after?.historySharedFrom).toBe(before?.historySharedFrom ?? null);
    expect(after?.metricsSharedFrom).toBe(before?.metricsSharedFrom ?? null);
    expect(after?.nutritionSharedFrom).toBe(before?.nutritionSharedFrom ?? null);
  });

  it('refuses to build an input the height CHECK would reject', () => {
    expect(
      clientSchemas.updateProfileInput.safeParse({ ...FULL_DRAFT, heightCm: 49 }).success,
    ).toBe(false);
    expect(
      clientSchemas.updateProfileInput.safeParse({ ...FULL_DRAFT, heightCm: 261 }).success,
    ).toBe(false);
    expect(
      clientSchemas.updateProfileInput.safeParse({ ...FULL_DRAFT, heightCm: 50 }).success,
    ).toBe(true);
    expect(
      clientSchemas.updateProfileInput.safeParse({ ...FULL_DRAFT, heightCm: 260 }).success,
    ).toBe(true);
  });

  it('rejects a key the allowlist does not carry', () => {
    const parsed = clientSchemas.updateProfileInput.safeParse({
      ...FULL_DRAFT,
      status: 'active',
    });

    expect(parsed.success).toBe(false);
  });
});
