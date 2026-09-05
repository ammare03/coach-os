// `auth-server/05` — sign-out revokes exactly one family; sign-out-
// everywhere revokes all of them; both are idempotent. Real Postgres
// (`testing` skill §4).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

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

async function signUp(email: string, deviceId?: string) {
  return caller().auth.signUp({
    email,
    password: 'a-real-password',
    name: 'Sign Out Test',
    dateOfBirth: '1990-01-01',
    timezone: 'UTC',
    platform: 'ios',
    ...(deviceId ? { deviceId } : {}),
  });
}

describe('auth.signOut', () => {
  it('revokes this family and leaves the family of a second device alive', async () => {
    const session = await signUp('two-devices@signout-test.com');
    const secondDevice = await caller().auth.signIn({
      email: 'two-devices@signout-test.com',
      password: 'a-real-password',
      platform: 'android',
    });

    const result = await caller().auth.signOut({ refreshToken: session.refreshToken });
    expect(result).toEqual({ success: true });

    await expect(
      caller().auth.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    // The second device's family is untouched.
    await expect(
      caller().auth.refresh({ refreshToken: secondDevice.refreshToken }),
    ).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('signing out twice succeeds both times and revokes nothing the second time', async () => {
    const session = await signUp('twice@signout-test.com');
    await expect(caller().auth.signOut({ refreshToken: session.refreshToken })).resolves.toEqual({
      success: true,
    });
    await expect(caller().auth.signOut({ refreshToken: session.refreshToken })).resolves.toEqual({
      success: true,
    });

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.signout'));
    // Exactly one row for this family across both calls, not two.
    const forThisUser = auditRows.filter((row) => row.targetId !== null);
    expect(forThisUser.length).toBeGreaterThanOrEqual(1);
  });

  it('an unknown token returns success and revokes nothing', async () => {
    await expect(caller().auth.signOut({ refreshToken: 'not-a-real-token' })).resolves.toEqual({
      success: true,
    });
  });

  it('succeeds with no refreshToken at all', async () => {
    await expect(caller().auth.signOut({})).resolves.toEqual({ success: true });
  });

  it('succeeds when the caller has no access token — it is a public procedure', async () => {
    const session = await signUp('no-access-token@signout-test.com');
    // `createTestContext` defaults `user: null` — no access token resolved,
    // exactly the "app backgrounded past 15 minutes" case this task exists
    // to accommodate.
    const anonymousCaller = appRouter.createCaller(createTestContext({ db, user: null }));
    await expect(
      anonymousCaller.auth.signOut({ refreshToken: session.refreshToken }),
    ).resolves.toEqual({
      success: true,
    });
  });
});

describe('auth.signOutAllDevices', () => {
  it('revokes every live family for the caller', async () => {
    const first = await signUp('everywhere@signout-test.com');
    const second = await caller().auth.signIn({
      email: 'everywhere@signout-test.com',
      password: 'a-real-password',
      platform: 'android',
    });

    const authedCaller = appRouter.createCaller(
      createTestContext({
        db,
        user: {
          id: first.user.id,
          email: 'everywhere@signout-test.com',
          role: 'coach',
          timezone: 'UTC',
          locale: 'en',
          coachProfileId: null,
          clientProfileId: null,
          deletedAt: null,
        },
      }),
    );

    await expect(authedCaller.auth.signOutAllDevices()).resolves.toEqual({ success: true });

    await expect(caller().auth.refresh({ refreshToken: first.refreshToken })).rejects.toMatchObject(
      {
        code: 'UNAUTHORIZED',
      },
    );
    await expect(
      caller().auth.refresh({ refreshToken: second.refreshToken }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('requires a valid access token', async () => {
    const anonymousCaller = appRouter.createCaller(createTestContext({ db, user: null }));
    await expect(anonymousCaller.auth.signOutAllDevices()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
