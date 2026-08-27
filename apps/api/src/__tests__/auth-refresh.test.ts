// `auth-server/04` — rotation, reuse detection, and the diagnosis branches.
// Real Postgres (`testing` skill §4). The reuse test is the deliverable.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { hashRefreshToken } from '../lib/auth/refresh-token.ts';
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

async function signUp(email: string) {
  return caller().auth.signUp({
    email,
    password: 'a-real-password',
    name: 'Refresh Test',
    dateOfBirth: '1990-01-01',
    timezone: 'UTC',
    platform: 'ios',
  });
}

describe('auth.refresh — happy rotation', () => {
  it('rotates: revokes the presented token, chains replaced_by, keeps family_id and device_id', async () => {
    const session = await signUp('rotate@refresh-test.com');
    const [before] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    if (!before) throw new Error('signUp did not create a refresh_tokens row');

    const result = await caller().auth.refresh({ refreshToken: session.refreshToken });

    expect(result.refreshToken).not.toBe(session.refreshToken);
    expect(result.accessToken).toEqual(expect.any(String));

    const [afterOld] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, before.id));
    if (!afterOld?.replacedBy) throw new Error('rotation did not set replacedBy');
    expect(afterOld.revokedAt).not.toBeNull();

    const [successor] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, afterOld.replacedBy));
    if (!successor) throw new Error('successor row not found');
    expect(successor).toMatchObject({
      familyId: before.familyId,
      deviceId: before.deviceId,
      revokedAt: null,
    });
    expect(successor.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('walks a chain of five rotations to a single live token, one family throughout', async () => {
    const session = await signUp('chain@refresh-test.com');
    let currentToken = session.refreshToken;

    for (let i = 0; i < 5; i++) {
      const result = await caller().auth.refresh({ refreshToken: currentToken });
      currentToken = result.refreshToken;
    }

    const familyRows = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    const familyIds = new Set(familyRows.map((r) => r.familyId));
    expect(familyIds.size).toBe(1);

    const live = familyRows.filter((r) => r.revokedAt === null);
    expect(live).toHaveLength(1);

    // Every revoked row but the last has a replacedBy pointing further down the chain.
    const revoked = familyRows.filter((r) => r.revokedAt !== null);
    expect(revoked.every((r) => r.replacedBy !== null)).toBe(true);
  });
});

describe('auth.refresh — reuse detection', () => {
  it('presenting an already-rotated token revokes the whole family and blocks every token in it', async () => {
    const session = await signUp('reuse@refresh-test.com');
    const firstToken = session.refreshToken;
    const rotated = await caller().auth.refresh({ refreshToken: firstToken });

    // Backdate the consumed token's revoked_at past the grace window rather
    // than sleeping for it in real time — this reads unambiguously as
    // reuse, not a benign race, without a slow test.
    const [firstRow] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hashRefreshToken(firstToken)));
    if (!firstRow) throw new Error('the consumed token row was not found');
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.refreshTokens.id, firstRow.id));

    await expect(caller().auth.refresh({ refreshToken: firstToken })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const familyRows = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    expect(familyRows.every((r) => r.revokedAt !== null)).toBe(true);

    // The successor from the legitimate rotation is also dead now.
    await expect(
      caller().auth.refresh({ refreshToken: rotated.refreshToken }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const [auditRow] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.refresh.reuse'));
    expect(auditRow).toBeDefined();
  });
});

describe('auth.refresh — refusal cases that touch nothing', () => {
  it('rejects an unknown token without creating or revoking any family', async () => {
    const before = await db.select().from(schema.refreshTokens);
    await expect(
      caller().auth.refresh({ refreshToken: 'not-a-real-token-at-all' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const after = await db.select().from(schema.refreshTokens);
    expect(after).toHaveLength(before.length);
  });

  it('rejects an expired token without revoking the family', async () => {
    const session = await signUp('expired@refresh-test.com');
    const [row] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    if (!row) throw new Error('signUp did not create a refresh_tokens row');
    await db
      .update(schema.refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.refreshTokens.id, row.id));

    await expect(
      caller().auth.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const [after] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, row.id));
    expect(after?.revokedAt).toBeNull(); // untouched, not revoked
  });

  it('a revoked family cannot refresh again', async () => {
    const session = await signUp('already-revoked@refresh-test.com');
    const [row] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, session.user.id));
    if (!row) throw new Error('signUp did not create a refresh_tokens row');
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 60_000) }) // well past the reuse grace window, no replacedBy
      .where(eq(schema.refreshTokens.id, row.id));

    await expect(
      caller().auth.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
