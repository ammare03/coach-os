// Real Postgres (`testing` skill §4). Both `getMe` and `updateMe` are thin
// query/update wrappers around `identity.users` — worth proving against a
// real column set rather than a mocked Drizzle client.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { getMe as GetMe } from './get-me.ts';
import type { updateMe as UpdateMe } from './update-me.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let getMe: typeof GetMe;
let updateMe: typeof UpdateMe;

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
  ({ getMe } = await import('./get-me.ts'));
  ({ updateMe } = await import('./update-me.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;

async function insertUser(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${seq}@me-router-test.com`,
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

describe('getMe', () => {
  it('returns the shared users fields, never passwordHash or role-specific columns', async () => {
    const userId = await insertUser({ name: 'Ada Lovelace', locale: 'en-GB' });

    const profile = await getMe(db, userId);

    expect(profile).toEqual({
      id: userId,
      email: expect.stringContaining('@me-router-test.com'),
      name: 'Ada Lovelace',
      avatarAssetId: null,
      role: 'coach',
      timezone: 'UTC',
      locale: 'en-GB',
      onboardingCompletedAt: null,
      createdAt: expect.any(Date),
      weightUnit: 'kg',
      isMinor: false,
      guardianConsentAt: null,
      guardianEmailMasked: null,
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('throws for a user id that does not exist', async () => {
    await expect(getMe(db, '00000000-0000-7000-8000-000000000000')).rejects.toThrow();
  });

  // `guardian-consent/06` — the three fields the pending screen renders
  // from, and the one that must never arrive whole.
  it('reports a pending minor and masks the guardian address', async () => {
    const userId = await insertUser({
      role: 'client',
      isMinor: true,
      guardianEmail: 'jane.doe@gmail.com',
    });

    const profile = await getMe(db, userId);

    expect(profile.isMinor).toBe(true);
    expect(profile.guardianConsentAt).toBeNull();
    expect(profile.guardianEmailMasked).toBe('j•••@gmail.com');
  });

  it('never returns the raw guardian address, on either me procedure', async () => {
    const userId = await insertUser({
      role: 'client',
      isMinor: true,
      guardianEmail: 'jane.doe@gmail.com',
    });

    for (const profile of [await getMe(db, userId), await updateMe(db, userId, { locale: 'en' })]) {
      expect(profile).not.toHaveProperty('guardianEmail');
      expect(JSON.stringify(profile)).not.toContain('jane.doe@gmail.com');
    }
  });

  it('reports a consented minor as consented', async () => {
    const consentedAt = new Date('2026-08-01T10:00:00.000Z');
    const userId = await insertUser({
      role: 'client',
      isMinor: true,
      guardianEmail: 'p@outlook.com',
      guardianConsentAt: consentedAt,
    });

    const profile = await getMe(db, userId);

    expect(profile.isMinor).toBe(true);
    expect(profile.guardianConsentAt).toEqual(consentedAt);
  });
});

describe('updateMe', () => {
  it('updates only the fields provided, leaving the rest untouched', async () => {
    const userId = await insertUser({ name: 'Original Name', timezone: 'UTC' });

    const updated = await updateMe(db, userId, { name: 'New Name' });

    expect(updated.name).toBe('New Name');
    expect(updated.timezone).toBe('UTC'); // unchanged
  });

  it('accepts timezone, locale, and avatarAssetId together', async () => {
    const userId = await insertUser();

    const updated = await updateMe(db, userId, {
      timezone: 'Asia/Kolkata',
      locale: 'hi',
      avatarAssetId: null,
    });

    expect(updated.timezone).toBe('Asia/Kolkata');
    expect(updated.locale).toBe('hi');
    expect(updated.avatarAssetId).toBeNull();
  });
});
