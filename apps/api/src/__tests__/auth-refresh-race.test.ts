// `auth-server/04` — genuine concurrency, not sequential calls (sequentially,
// the second call *is* reuse). Real Postgres (`testing` skill §4).
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

describe('auth.refresh — concurrent replay of the same token', () => {
  it('exactly one call succeeds, the other gets REFRESH_RACE, and the family survives', async () => {
    const session = await caller().auth.signUp({
      email: 'race@refresh-test.com',
      password: 'a-real-password',
      name: 'Race Test',
      dateOfBirth: '1990-01-01',
      timezone: 'UTC',
      platform: 'ios',
    });

    const outcomes = await Promise.allSettled([
      caller().auth.refresh({ refreshToken: session.refreshToken }),
      caller().auth.refresh({ refreshToken: session.refreshToken }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'CONFLICT' });

    const familyRows = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    const live = familyRows.filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(1); // the winner's successor — family alive, not revoked

    const reuseAudit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.refresh.reuse'));
    expect(reuseAudit).toHaveLength(0); // a race must never write a reuse row
  });
});
