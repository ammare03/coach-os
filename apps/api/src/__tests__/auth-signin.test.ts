// `auth-server/02` — the sign-in half. Real Postgres (`testing` skill §4).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { hashPassword } from '../lib/auth/password.ts';
import { appRouter } from '../routers/index.ts';

import { createTestContext } from './test-context.ts';

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
}, 60_000);

function caller() {
  return appRouter.createCaller(createTestContext({ db }));
}

async function insertCoach(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: 'signin-fixture@signin-test.com',
      passwordHash: await hashPassword('correct-password-123'),
      name: 'Fixture Coach',
      role: 'coach',
      timezone: 'UTC',
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  await db.insert(schema.coachProfiles).values({ userId: user.id });
  return user;
}

describe('auth.signIn', () => {
  it('accepts correct credentials and returns a session', async () => {
    const user = await insertCoach({ email: 'correct@signin-test.com' });
    const result = await caller().auth.signIn({
      email: 'correct@signin-test.com',
      password: 'correct-password-123',
      platform: 'ios',
    });
    expect(result.user.id).toBe(user.id);
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('rejects a wrong password with a generic error', async () => {
    await insertCoach({ email: 'wrongpw@signin-test.com' });
    await expect(
      caller().auth.signIn({
        email: 'wrongpw@signin-test.com',
        password: 'not-it',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects an unknown email with the identical error', async () => {
    await expect(
      caller().auth.signIn({
        email: 'never-signed-up@signin-test.com',
        password: 'whatever',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a soft-deleted user', async () => {
    await insertCoach({ email: 'deleted@signin-test.com', deletedAt: new Date() });
    await expect(
      caller().auth.signIn({
        email: 'deleted@signin-test.com',
        password: 'correct-password-123',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a social-only account presenting a password, identically', async () => {
    await db.insert(schema.users).values({
      email: 'social-only@signin-test.com',
      passwordHash: null,
      name: 'Social Only',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    });
    await expect(
      caller().auth.signIn({
        email: 'social-only@signin-test.com',
        password: 'whatever-they-typed',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('the three refusal cases share the identical cause.code and message', async () => {
    await insertCoach({ email: 'compare-wrongpw@signin-test.com' });
    await db.insert(schema.users).values({
      email: 'compare-social@signin-test.com',
      passwordHash: null,
      name: 'Compare Social',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    });

    const outcomes = await Promise.all(
      [
        { email: 'compare-unknown@signin-test.com', password: 'x' },
        { email: 'compare-wrongpw@signin-test.com', password: 'not-the-password' },
        { email: 'compare-social@signin-test.com', password: 'x' },
      ].map(async (creds) => {
        try {
          await caller().auth.signIn({ ...creds, platform: 'ios' });
          return null;
        } catch (error) {
          return error;
        }
      }),
    );

    const shapes = outcomes.map((e) => ({
      code: (e as { code?: string })?.code,
      message: (e as { message?: string })?.message,
    }));
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[1]).toEqual(shapes[2]);
  });

  it('rewrites password_hash in the same request when the stored parameters are outdated', async () => {
    const email = 'outdated-hash@signin-test.com';
    // A real Argon2id digest, deliberately hashed at a lower memory cost
    // than the current constant — proves the rehash reads the *current*
    // plaintext (only available here, at verification) rather than
    // something recorded at creation time.
    const { hash } = await import('@node-rs/argon2');
    const outdatedDigest = await hash('correct-password-123', {
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: outdatedDigest,
        name: 'Outdated',
        role: 'coach',
        timezone: 'UTC',
      })
      .returning();
    if (!user) throw new Error('seed insert did not return a row');
    await db.insert(schema.coachProfiles).values({ userId: user.id });

    await caller().auth.signIn({ email, password: 'correct-password-123', platform: 'ios' });

    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(updated?.passwordHash).not.toBe(outdatedDigest);
    expect(updated?.passwordHash).toMatch(/m=19456/);
  });

  it('performs a real hash verification even when the email is unknown (no fast-path)', async () => {
    const start = process.hrtime.bigint();
    await expect(
      caller().auth.signIn({
        email: 'timing-unknown@signin-test.com',
        password: 'whatever-length-password-here',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    // A skipped verification returns in ~1ms; Argon2id at these parameters
    // takes tens of milliseconds. This is a floor, not a precise timing
    // proof (`02`'s own Verification note: run hundreds of attempts for
    // that) — it only catches the "verification skipped entirely" bug.
    expect(elapsedMs).toBeGreaterThan(5);
  });

  it('writes a distinct audit_log row for a failed sign-in with no email in it', async () => {
    const before = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.signin.failed'));
    await expect(
      caller().auth.signIn({
        email: 'audit-failure@signin-test.com',
        password: 'whatever',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const after = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.signin.failed'));
    expect(after.length).toBe(before.length + 1);
    expect(JSON.stringify(after)).not.toContain('audit-failure@signin-test.com');
  });
});
