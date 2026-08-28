// `auth-server/02` — the sign-up half. Real Postgres (`testing` skill §4).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createCoachAccount } from '../features/auth/create-coach-account.ts';
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
});

function caller() {
  return appRouter.createCaller(createTestContext({ db }));
}

describe('auth.signUp', () => {
  it('creates users and coach_profiles in one transaction and returns a session', async () => {
    const result = await caller().auth.signUp({
      email: 'new-coach@signup-test.com',
      password: 'a-real-password',
      name: 'New Coach',
      dateOfBirth: '1990-01-01',
      timezone: 'Asia/Kolkata',
      platform: 'ios',
    });

    expect(result.user).toMatchObject({
      role: 'coach',
      name: 'New Coach',
      timezone: 'Asia/Kolkata',
    });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.deviceId).toEqual(expect.any(String));

    const [profile] = await db
      .select()
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.userId, result.user.id));
    expect(profile).toBeDefined();
  });

  it('rejects role as an unknown field — signUpInput has nothing for a caller to override', async () => {
    await expect(
      caller().auth.signUp({
        email: 'wants-client-role@signup-test.com',
        password: 'a-real-password',
        name: 'Wants Client',
        dateOfBirth: '1990-01-01',
        timezone: 'UTC',
        platform: 'ios',
        // @ts-expect-error — role is deliberately not part of signUpInput
        role: 'client',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'wants-client-role@signup-test.com'));
    expect(rows).toHaveLength(0);
  });

  it('returns a generic conflict for a duplicate email — no table, constraint, or confirmation the address exists', async () => {
    const email = 'duplicate@signup-test.com';
    await caller().auth.signUp({
      email,
      password: 'a-real-password',
      name: 'First',
      dateOfBirth: '1990-01-01',
      timezone: 'UTC',
      platform: 'ios',
    });

    const attempt = caller().auth.signUp({
      email,
      password: 'a-different-password',
      name: 'Second',
      dateOfBirth: '1990-01-01',
      timezone: 'UTC',
      platform: 'ios',
    });
    await expect(attempt).rejects.toMatchObject({ code: 'CONFLICT' });

    let caught: unknown;
    try {
      await attempt;
    } catch (error) {
      caught = error;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message.toLowerCase()).not.toMatch(
      /users_email_unique|constraint|"users"|already registered|already exists/,
    );

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(1); // the first sign-up, not a second row
  });

  it('writes exactly one audit_log row for a successful sign-up', async () => {
    const email = 'audited@signup-test.com';
    const result = await caller().auth.signUp({
      email,
      password: 'a-real-password',
      name: 'Audited',
      dateOfBirth: '1990-01-01',
      timezone: 'UTC',
      platform: 'ios',
    });

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, result.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'auth.signup', actorUserId: result.user.id });
    expect(JSON.stringify(rows[0]?.metadata ?? {})).not.toContain(email);
  });
});

describe('auth.signUp — age gating (auth-server/07)', () => {
  function signUpAt(dateOfBirth: string, email: string) {
    return caller().auth.signUp({
      email,
      password: 'a-real-password',
      name: 'Age Test',
      dateOfBirth,
      timezone: 'UTC',
      platform: 'ios',
    });
  }

  it('refuses a 12-year-old with AGE_BELOW_MINIMUM', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 12);
    await expect(
      signUpAt(dob.toISOString().slice(0, 10), 'age-12@signup-test.com'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'AGE_BELOW_MINIMUM' },
    });
  });

  it('refuses a 13-year-old coach with COACH_MUST_BE_ADULT', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 13);
    await expect(
      signUpAt(dob.toISOString().slice(0, 10), 'age-13@signup-test.com'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'COACH_MUST_BE_ADULT' },
    });
  });

  it('refuses a 17-year-old coach with COACH_MUST_BE_ADULT', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 17);
    await expect(
      signUpAt(dob.toISOString().slice(0, 10), 'age-17@signup-test.com'),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'COACH_MUST_BE_ADULT' },
    });
  });

  it('allows an 18-year-old coach and stores date_of_birth', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 18);
    const dateOfBirth = dob.toISOString().slice(0, 10);
    const result = await signUpAt(dateOfBirth, 'age-18@signup-test.com');
    expect(result.user.role).toBe('coach');

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, result.user.id));
    expect(row?.dateOfBirth).toBe(dateOfBirth);
    expect(row?.isMinor).toBe(false);
  });

  it('refused age signups leave no row', async () => {
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 15);
    const email = 'age-refused-no-row@signup-test.com';
    await signUpAt(dob.toISOString().slice(0, 10), email).catch(() => null);
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(0);
  });
});

describe('createCoachAccount — the forced-failure proof', () => {
  it('leaves zero rows in identity.users when the coach_profiles insert fails', async () => {
    const email = 'forced-failure@signup-test.com';
    const ctx = createTestContext({ db });

    await expect(
      db.transaction(async (tx) => {
        const realInsert = tx.insert.bind(tx);
        // Monkey-patch just this transaction handle: the coach_profiles
        // insert throws, everything else behaves normally — proving the
        // users insert that already ran does not survive the rollback
        // (`02`'s Verification: "make the coach_profiles insert throw,
        // then assert identity.users contains no row for that email").
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only monkeypatch of a generic query-builder method
        (tx as any).insert = (table: unknown) => {
          if (table === schema.coachProfiles) {
            throw new Error('forced failure for the transaction test');
          }
          return realInsert(table as never);
        };
        return createCoachAccount(tx, ctx, {
          email,
          passwordHash: 'argon2id$placeholder',
          name: 'Forced Failure',
          dateOfBirth: '1990-01-01',
          timezone: 'UTC',
        });
      }),
    ).rejects.toThrow('forced failure for the transaction test');

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(0);
  });
});
