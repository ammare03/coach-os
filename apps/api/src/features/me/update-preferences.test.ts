// Real Postgres (`testing` skill §4) — the composite-key upsert is the
// exact behaviour worth proving against a real `ON CONFLICT` target rather
// than a mocked Drizzle client.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { updatePreferences as UpdatePreferences } from './update-preferences.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let updatePreferences: typeof UpdatePreferences;

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
  ({ updatePreferences } = await import('./update-preferences.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
});

let seq = 0;

async function insertUser(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${seq}@preferences-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `User ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  return user.id;
}

describe('updatePreferences', () => {
  it('updates analyticsOptOut and aiProcessingOptOut on users', async () => {
    const userId = await insertUser();

    await updatePreferences(db, userId, { analyticsOptOut: true, aiProcessingOptOut: true });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.analyticsOptOut).toBe(true);
    expect(user?.aiProcessingOptOut).toBe(true);
  });

  it('leaves unspecified users booleans unchanged', async () => {
    const userId = await insertUser();
    await updatePreferences(db, userId, { analyticsOptOut: true });

    await updatePreferences(db, userId, { aiProcessingOptOut: true });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user?.analyticsOptOut).toBe(true); // untouched by the second call
    expect(user?.aiProcessingOptOut).toBe(true);
  });

  it('inserts a notification_preferences row on first write', async () => {
    const userId = await insertUser();

    await updatePreferences(db, userId, {
      notifications: [{ channel: 'push', type: 'comment_received', enabled: false }],
    });

    const [row] = await db
      .select()
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.userId, userId),
          eq(schema.notificationPreferences.channel, 'push'),
          eq(schema.notificationPreferences.type, 'comment_received'),
        ),
      );
    expect(row?.enabled).toBe(false);
  });

  it('upserts against the composite key rather than duplicating rows', async () => {
    const userId = await insertUser();
    await updatePreferences(db, userId, {
      notifications: [{ channel: 'email', type: 'checkin_reminder', enabled: true }],
    });

    await updatePreferences(db, userId, {
      notifications: [{ channel: 'email', type: 'checkin_reminder', enabled: false }],
    });

    const rows = await db
      .select()
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.userId, userId),
          eq(schema.notificationPreferences.channel, 'email'),
          eq(schema.notificationPreferences.type, 'checkin_reminder'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
  });

  it('leaves an unrelated preference row unchanged on a partial update', async () => {
    const userId = await insertUser();
    await updatePreferences(db, userId, {
      notifications: [
        { channel: 'push', type: 'comment_received', enabled: true },
        { channel: 'push', type: 'checkin_reminder', enabled: true },
      ],
    });

    await updatePreferences(db, userId, {
      notifications: [{ channel: 'push', type: 'comment_received', enabled: false }],
    });

    const [untouched] = await db
      .select()
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.userId, userId),
          eq(schema.notificationPreferences.channel, 'push'),
          eq(schema.notificationPreferences.type, 'checkin_reminder'),
        ),
      );
    expect(untouched?.enabled).toBe(true);
  });
});
