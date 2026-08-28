// Real Postgres (`testing` skill §4). Both `revoke` and `listPending` are
// thin query/update wrappers — worth proving against a real index
// (`invites_pending`) rather than a mocked Drizzle client.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';

import type { listPendingInvites as ListPendingInvites } from './list-pending-invites.ts';
import type { revokeInvite as RevokeInvite } from './revoke-invite.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let revokeInvite: typeof RevokeInvite;
let listPendingInvites: typeof ListPendingInvites;
let createTestContext: typeof CreateTestContext;

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
  ({ revokeInvite } = await import('./revoke-invite.ts'));
  ({ listPendingInvites } = await import('./list-pending-invites.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
});

let seq = 0;

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@revoke-list-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning();
  if (!coachProfile) throw new Error('seed insert into coach_profiles did not return a row');
  return coachProfile.id;
}

async function insertInvite(
  coachProfileId: string,
  overrides: Partial<typeof schema.invites.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const [invite] = await db
    .insert(schema.invites)
    .values({
      coachId: coachProfileId,
      email: `invitee-${seq}@revoke-list-test.com`,
      code: `RLT${String(seq).padStart(5, '0')}`,
      ...overrides,
    })
    .returning();
  if (!invite) throw new Error('seed insert into invites did not return a row');
  return invite.id;
}

describe('revokeInvite', () => {
  it('sets revokedAt and writes an audit log entry', async () => {
    const coachProfileId = await insertCoach();
    const inviteId = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await revokeInvite(db, ctx, inviteId);

    const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId));
    expect(invite?.revokedAt).not.toBeNull();

    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, inviteId));
    expect(entry?.action).toBe('invite.revoked');
  });

  it('rejects revoking an already-accepted invite with INVITE_ALREADY_ACCEPTED', async () => {
    const coachProfileId = await insertCoach();
    const inviteId = await insertInvite(coachProfileId, { acceptedAt: new Date() });
    const ctx = createTestContext({ db });

    await expect(revokeInvite(db, ctx, inviteId)).rejects.toMatchObject({
      cause: { appCode: 'INVITE_ALREADY_ACCEPTED' },
    });
  });

  it('is idempotent on an already-revoked invite, preserving the original timestamp', async () => {
    const coachProfileId = await insertCoach();
    const inviteId = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await revokeInvite(db, ctx, inviteId);
    const [firstRevoke] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.id, inviteId));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await revokeInvite(db, ctx, inviteId);
    const [secondRevoke] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.id, inviteId));

    expect(secondRevoke?.revokedAt?.getTime()).toBe(firstRevoke?.revokedAt?.getTime());
  });

  it('frees the seat a revoked invite was counting against', async () => {
    const { assertSeatAvailable } = await import('./seat-check.ts');
    const coachProfileId = await insertCoach(); // starter, 2 seats
    const inviteId1 = await insertInvite(coachProfileId);
    await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    // Both seats are taken by pending invites — a third would fail.
    await expect(assertSeatAvailable(db, coachProfileId)).rejects.toMatchObject({
      cause: { appCode: 'SEAT_LIMIT_REACHED' },
    });

    await revokeInvite(db, ctx, inviteId1);

    // One seat is free again.
    await expect(assertSeatAvailable(db, coachProfileId)).resolves.toBeUndefined();
  });
});

describe('listPendingInvites', () => {
  it('returns only pending invites for the calling coach', async () => {
    const coachProfileId = await insertCoach();
    const otherCoachProfileId = await insertCoach();
    const pendingId = await insertInvite(coachProfileId);
    await insertInvite(coachProfileId, { acceptedAt: new Date() });
    await insertInvite(coachProfileId, { revokedAt: new Date() });
    await insertInvite(otherCoachProfileId);

    const result = await listPendingInvites(db, coachProfileId);

    expect(result.map((i) => i.id)).toEqual([pendingId]);
  });

  it('returns email, createdAt, and expiresAt for each pending invite', async () => {
    const coachProfileId = await insertCoach();
    await insertInvite(coachProfileId);

    const [invite] = await listPendingInvites(db, coachProfileId);

    expect(invite?.email).toEqual(expect.any(String));
    expect(invite?.createdAt).toBeInstanceOf(Date);
    expect(invite?.expiresAt).toBeInstanceOf(Date);
  });
});
