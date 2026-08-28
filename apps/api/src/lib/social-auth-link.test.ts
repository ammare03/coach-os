// `social-sign-in/03` — real Postgres (`testing` skill §4), same
// testcontainers shape as `../../__tests__/auth-signin.test.ts`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { linkProviderToUser, resolveSocialIdentity } from './social-auth-link.ts';

let container: StartedTestContainer;
let db: DbClient;

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

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

async function insertCoach(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: 'link-fixture@social-link-test.com',
      passwordHash: 'not-a-real-hash',
      name: 'Fixture Coach',
      role: 'coach',
      timezone: 'UTC',
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  return user;
}

describe('resolveSocialIdentity', () => {
  it('resolves an existing (provider, providerUid) link with no email lookup at all', async () => {
    const user = await insertCoach({ email: 'existing-link@social-link-test.com' });
    await db.insert(schema.authProviders).values({
      userId: user.id,
      provider: 'apple',
      providerUid: 'apple-uid-existing',
    });

    // A different email than the row's own — proves the provider/uid match
    // alone resolved it, not a fallback email lookup.
    const result = await resolveSocialIdentity(db, {
      provider: 'apple',
      providerUid: 'apple-uid-existing',
      email: 'not-the-account-email@social-link-test.com',
    });
    expect(result).toEqual({ outcome: 'existingUser', userId: user.id });
  });

  it('resolves newIdentity when no provider link and no matching users row exist', async () => {
    const result = await resolveSocialIdentity(db, {
      provider: 'google',
      providerUid: 'google-uid-brand-new',
      email: 'never-seen@social-link-test.com',
    });
    expect(result).toEqual({ outcome: 'newIdentity' });
  });

  it('resolves newIdentity for a null email with no matching provider link', async () => {
    const result = await resolveSocialIdentity(db, {
      provider: 'apple',
      providerUid: 'apple-uid-no-email',
      email: null,
    });
    expect(result).toEqual({ outcome: 'newIdentity' });
  });

  it('resolves collision when the email matches an existing user with no provider link', async () => {
    await insertCoach({ email: 'collision-target@social-link-test.com' });

    const result = await resolveSocialIdentity(db, {
      provider: 'google',
      providerUid: 'google-uid-collision-attempt',
      email: 'collision-target@social-link-test.com',
    });
    expect(result).toEqual({ outcome: 'collision' });
  });

  it('ignores a soft-deleted user with a matching email — resolves newIdentity, not collision', async () => {
    await insertCoach({
      email: 'deleted-account@social-link-test.com',
      deletedAt: new Date(),
    });

    const result = await resolveSocialIdentity(db, {
      provider: 'google',
      providerUid: 'google-uid-vs-deleted',
      email: 'deleted-account@social-link-test.com',
    });
    expect(result).toEqual({ outcome: 'newIdentity' });
  });
});

describe('linkProviderToUser', () => {
  it('inserts a new auth_providers row', async () => {
    const user = await insertCoach({ email: 'to-link@social-link-test.com' });

    await db.transaction((tx) =>
      linkProviderToUser(tx, user.id, { provider: 'apple', providerUid: 'apple-uid-to-link' }),
    );

    const [row] = await db
      .select()
      .from(schema.authProviders)
      .where(eq(schema.authProviders.providerUid, 'apple-uid-to-link'));
    expect(row?.userId).toBe(user.id);
  });

  it('treats a concurrent duplicate (provider, providerUid) insert as success, not an error', async () => {
    const user = await insertCoach({ email: 'race-link@social-link-test.com' });
    const claim = { provider: 'google' as const, providerUid: 'google-uid-race' };

    // The row already exists — simulates the loser of a genuine race, which
    // observes the same unique-constraint violation `linkProviderToUser`
    // must swallow.
    await db.transaction((tx) => linkProviderToUser(tx, user.id, claim));

    await expect(
      db.transaction((tx) => linkProviderToUser(tx, user.id, claim)),
    ).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(schema.authProviders)
      .where(eq(schema.authProviders.providerUid, 'google-uid-race'));
    expect(rows).toHaveLength(1);
  });

  it('does not swallow an unrelated database error', async () => {
    // A userId with no matching `users` row violates the FK, a different
    // constraint entirely — must propagate, not be mistaken for the race.
    const bogusUserId = '00000000-0000-0000-0000-000000000000';
    await expect(
      db.transaction((tx) =>
        linkProviderToUser(tx, bogusUserId, {
          provider: 'apple',
          providerUid: 'apple-uid-fk-check',
        }),
      ),
    ).rejects.toThrow();
  });
});
