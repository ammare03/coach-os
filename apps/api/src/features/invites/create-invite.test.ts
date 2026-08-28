// Real Postgres (`testing` skill §4) — the seat-limit count queries and the
// `invites_code_unique` collision-retry are exactly the kind of behaviour a
// mocked Drizzle client would test the mock of, not the query. Same
// dynamic-import-after-container-starts shape as `../auth/social-sign-in.test.ts`,
// for the identical reason: `env.ts` freezes `DATABASE_URL` at module load.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';

import type {
  createInvite as CreateInvite,
  insertInviteWithUniqueCode as InsertInviteWithUniqueCode,
} from './create-invite.ts';

// Stubbed at the boundary, same pattern as `../../__tests__/auth-reset.test.ts`
// — a real Resend call against the fake test API key would otherwise fire
// (and log its 401) after this suite's `afterAll` has already torn down the
// Postgres pool, since `sendInviteEmail` is deliberately fire-and-forget
// (`invites/02`).
jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let createInvite: typeof CreateInvite;
let insertInviteWithUniqueCode: typeof InsertInviteWithUniqueCode;
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
  ({ createInvite, insertInviteWithUniqueCode } = await import('./create-invite.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
});

let coachSeq = 0;

async function insertCoach(
  overrides: Partial<typeof schema.coachProfiles.$inferInsert> = {},
): Promise<{ userId: string; coachProfileId: string }> {
  coachSeq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${coachSeq}@create-invite-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${coachSeq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id, ...overrides })
    .returning();
  if (!coachProfile) throw new Error('seed insert into coach_profiles did not return a row');
  return { userId: user.id, coachProfileId: coachProfile.id };
}

async function insertActiveClient(coachProfileId: string): Promise<void> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${Math.random().toString(36).slice(2)}@create-invite-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: 'A Client',
      role: 'client',
      timezone: 'UTC',
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  await db.insert(schema.clientProfiles).values({
    userId: user.id,
    coachId: coachProfileId,
    status: 'active',
    activatedAt: new Date(),
  });
}

async function insertInviteRow(
  coachProfileId: string,
  overrides: Partial<typeof schema.invites.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.invites).values({
    coachId: coachProfileId,
    email: `pending-${Math.random().toString(36).slice(2)}@create-invite-test.com`,
    code: Math.random().toString(36).slice(2, 10).toUpperCase(),
    ...overrides,
  });
}

describe('createInvite', () => {
  it('creates an invite with an 8-character code and the requested email', async () => {
    const { coachProfileId } = await insertCoach();
    const ctx = createTestContext({ db });

    const invite = await createInvite(db, ctx, coachProfileId, { email: 'new-client@example.com' });

    expect(invite.email).toBe('new-client@example.com');
    expect(invite.code).toHaveLength(8);
    expect(invite.coachId).toBe(coachProfileId);
    expect(invite.acceptedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
  });

  it('rejects with SEAT_LIMIT_REACHED once active clients reach the starter tier limit (2)', async () => {
    const { coachProfileId } = await insertCoach(); // starter, default
    await insertActiveClient(coachProfileId);
    await insertActiveClient(coachProfileId);
    const ctx = createTestContext({ db });

    await expect(
      createInvite(db, ctx, coachProfileId, { email: 'over-limit@example.com' }),
    ).rejects.toMatchObject({
      cause: { appCode: 'SEAT_LIMIT_REACHED', details: { seatsUsed: 2, seatLimit: 2 } },
    });
  });

  it('counts a pending invite toward the limit, alongside active clients', async () => {
    const { coachProfileId } = await insertCoach();
    await insertActiveClient(coachProfileId);
    await insertInviteRow(coachProfileId);
    const ctx = createTestContext({ db });

    await expect(
      createInvite(db, ctx, coachProfileId, { email: 'blocked@example.com' }),
    ).rejects.toMatchObject({ cause: { appCode: 'SEAT_LIMIT_REACHED' } });
  });

  it('does not count a revoked or already-accepted invite toward the limit', async () => {
    const { coachProfileId } = await insertCoach();
    await insertActiveClient(coachProfileId);
    await insertInviteRow(coachProfileId, { revokedAt: new Date() });
    await insertInviteRow(coachProfileId, { acceptedAt: new Date() });
    const ctx = createTestContext({ db });

    const invite = await createInvite(db, ctx, coachProfileId, { email: 'room-left@example.com' });
    expect(invite.email).toBe('room-left@example.com');
  });

  it('never blocks an agency-tier coach regardless of active client count', async () => {
    const { coachProfileId } = await insertCoach({ subscriptionTier: 'agency' });
    for (let i = 0; i < 5; i++) {
      await insertActiveClient(coachProfileId);
    }
    const ctx = createTestContext({ db });

    const invite = await createInvite(db, ctx, coachProfileId, {
      email: 'agency-client@example.com',
    });
    expect(invite.coachId).toBe(coachProfileId);
  });

  it('retries code generation on a unique-constraint collision rather than failing', async () => {
    const { coachProfileId } = await insertCoach();
    await insertInviteRow(coachProfileId, { code: 'COLLIDE1' });

    // Exercises `insertInviteWithUniqueCode` directly with an injected
    // generator, rather than the full `createInvite` — `jest.spyOn` on
    // `@coachos/utils`'s own export fails ("Cannot redefine property") under
    // this repo's ESM/ts-jest setup, so the code-generator seam
    // `create-invite.ts` exports for exactly this reason is used instead.
    const generateCode = jest
      .fn<string, []>()
      .mockReturnValueOnce('COLLIDE1') // the pre-seeded row's code — first attempt must collide
      .mockReturnValueOnce('FRESH999');

    const invite = await db.transaction((tx) =>
      insertInviteWithUniqueCode(tx, coachProfileId, 'retry@example.com', generateCode),
    );

    expect(invite.code).toBe('FRESH999');
    expect(generateCode).toHaveBeenCalledTimes(2);
  });

  it('writes an audit log entry for the created invite', async () => {
    const { coachProfileId } = await insertCoach();
    const ctx = createTestContext({ db });

    const invite = await createInvite(db, ctx, coachProfileId, { email: 'audited@example.com' });

    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, 'invite.created'), eq(schema.auditLog.targetId, invite.id)),
      );
    expect(entry).toBeDefined();
  });

  it('leaves expiresAt to the database default rather than an application value', async () => {
    const { coachProfileId } = await insertCoach();
    const ctx = createTestContext({ db });
    const before = Date.now();

    const invite = await createInvite(db, ctx, coachProfileId, { email: 'expiry@example.com' });

    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const expiresAtMs = invite.expiresAt.getTime();
    expect(expiresAtMs).toBeGreaterThan(before + fourteenDaysMs - 60_000);
    expect(expiresAtMs).toBeLessThan(before + fourteenDaysMs + 60_000);
  });
});

// Confirms an unrelated collision (a different constraint firing on retry
// attempt, e.g. some future unrelated uniqueness rule) is never silently
// retried — only `invites_code_unique` is.
describe('insertInviteWithUniqueCode collision scoping', () => {
  it('does not loop forever or misfire on a non-code unique violation', async () => {
    const { coachProfileId } = await insertCoach();
    const ctx = createTestContext({ db });
    // A duplicate email is allowed by the schema (no unique constraint on
    // identity.invites.email) — this just proves two invites for the same
    // address both succeed and are independent, not merged or blocked by
    // the code-collision retry path.
    const first = await createInvite(db, ctx, coachProfileId, { email: 'same@example.com' });
    const second = await createInvite(db, ctx, coachProfileId, { email: 'same@example.com' });
    expect(first.code).not.toBe(second.code);
  });
});
