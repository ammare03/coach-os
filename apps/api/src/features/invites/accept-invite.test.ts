// Real Postgres (`testing` skill §4) — the invite-state validation, the
// seat re-check, and the minor/guardian branching are exactly the kind of
// behaviour a mocked Drizzle client would test the mock of. Same
// dynamic-import-after-container-starts shape as
// `../auth/social-sign-in.test.ts`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';

import type { acceptInvite as AcceptInvite } from './accept-invite.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let acceptInvite: typeof AcceptInvite;
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
  ({ acceptInvite } = await import('./accept-invite.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

// Teardown carries the same timeout as setup: stopping a container is not cheaper than
// starting one, and Jest would otherwise fall back to its 5s default.
afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;

async function insertCoach(
  overrides: Partial<typeof schema.coachProfiles.$inferInsert> = {},
): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@accept-invite-test.com`,
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
    .values({ userId: user.id, ...overrides })
    .returning();
  if (!coachProfile) throw new Error('seed insert into coach_profiles did not return a row');
  return coachProfile.id;
}

async function insertInvite(
  coachProfileId: string,
  overrides: Partial<typeof schema.invites.$inferInsert> = {},
): Promise<{ code: string; email: string; id: string }> {
  seq += 1;
  const email = `invitee-${seq}@accept-invite-test.com`;
  const code = `CODE${String(seq).padStart(4, '0')}`;
  const [invite] = await db
    .insert(schema.invites)
    .values({ coachId: coachProfileId, email, code, ...overrides })
    .returning();
  if (!invite) throw new Error('seed insert into invites did not return a row');
  return { code: invite.code, email: invite.email, id: invite.id };
}

const DEVICE = { platform: 'ios' as const };
const ADULT_DOB = '1990-01-01';

function teenDob(): string {
  const fifteenYearsAgo = new Date();
  fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
  return fifteenYearsAgo.toISOString().slice(0, 10);
}

function childDob(): string {
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  return tenYearsAgo.toISOString().slice(0, 10);
}

describe('acceptInvite', () => {
  it('creates an active client bound to the inviting coach and opens a session', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    const session = await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'New Client',
      timezone: 'UTC',
      dateOfBirth: ADULT_DOB,
      device: DEVICE,
    });

    expect(session.user.role).toBe('client');
    expect(session.accessToken).toEqual(expect.any(String));

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    if (!user) throw new Error('expected a users row for the accepted invite');
    expect(user.role).toBe('client');
    expect(user.isMinor).toBe(false);

    const [clientProfile] = await db
      .select()
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.userId, user.id));
    expect(clientProfile?.coachId).toBe(coachProfileId);
    expect(clientProfile?.status).toBe('active');
    expect(clientProfile?.activatedAt).not.toBeNull();

    const [updatedInvite] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.id, invite.id));
    expect(updatedInvite?.acceptedAt).not.toBeNull();
    expect(updatedInvite?.acceptedByUserId).toBe(user.id);
  });

  it('rejects an unknown code with INVITE_NOT_FOUND', async () => {
    const ctx = createTestContext({ db });
    await expect(
      acceptInvite(db, ctx, {
        code: 'NOSUCH01',
        password: 'a-real-password',
        name: 'Nobody',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_NOT_FOUND' } });
  });

  it('rejects an expired invite with INVITE_EXPIRED', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId, { expiresAt: new Date(Date.now() - 1000) });
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Too Late',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_EXPIRED' } });
  });

  it('rejects an already-accepted invite with INVITE_ALREADY_ACCEPTED', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId, { acceptedAt: new Date() });
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Second Try',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_ALREADY_ACCEPTED' } });
  });

  it('rejects a revoked invite with INVITE_REVOKED', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId, { revokedAt: new Date() });
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Cancelled',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_REVOKED' } });
  });

  it('rejects under-13 with AGE_BELOW_MINIMUM without creating an account', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Too Young',
        timezone: 'UTC',
        dateOfBirth: childDob(),
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'AGE_BELOW_MINIMUM' } });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    expect(user).toBeUndefined();
  });

  it('rejects a 13-17 acceptance with no guardianEmail as GUARDIAN_CONSENT_REQUIRED, without burning the invite', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'A Teen',
        timezone: 'UTC',
        dateOfBirth: teenDob(),
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'GUARDIAN_CONSENT_REQUIRED' } });

    // The invite must still be usable — a missing guardian email is a
    // resubmission prompt, not a terminal failure of the code itself.
    const session = await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail: 'guardian@example.com',
      device: DEVICE,
    });
    expect(session.user.role).toBe('client');
  });

  it('creates a 13-17 account unactivated, with is_minor and guardian_email set, and never opens for coaching unconsented', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail: 'guardian@example.com',
      device: DEVICE,
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    if (!user) throw new Error('expected a users row for the accepted invite');
    expect(user.isMinor).toBe(true);
    expect(user.guardianEmail).toBe('guardian@example.com');
    expect(user.guardianConsentAt).toBeNull();

    const [clientProfile] = await db
      .select()
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.userId, user.id));
    expect(clientProfile?.status).toBe('invited');
    expect(clientProfile?.activatedAt).toBeNull();
  });

  it('re-checks the seat limit at acceptance, independently of creation time', async () => {
    const coachProfileId = await insertCoach(); // starter, 2 seats
    const invite = await insertInvite(coachProfileId);
    // Fill both seats with OTHER active clients after this invite was created.
    for (let i = 0; i < 2; i++) {
      seq += 1;
      const [otherUser] = await db
        .insert(schema.users)
        .values({
          email: `filler-${seq}@accept-invite-test.com`,
          passwordHash: 'argon2id$placeholder',
          name: 'Filler',
          role: 'client',
          timezone: 'UTC',
        })
        .returning();
      if (!otherUser) throw new Error('seed insert into users did not return a row');
      await db.insert(schema.clientProfiles).values({
        userId: otherUser.id,
        coachId: coachProfileId,
        status: 'active',
        activatedAt: new Date(),
      });
    }
    const ctx = createTestContext({ db });

    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Over Limit',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'SEAT_LIMIT_REACHED' } });

    // Never left a half-created account behind.
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    expect(user).toBeUndefined();
  });

  it('rethrows an email collision at account-creation time untouched, for the request-wide boundary to translate', async () => {
    const coachProfileId = await insertCoach();
    const sharedEmail = `shared-${++seq}@accept-invite-test.com`;
    await db.insert(schema.users).values({
      email: sharedEmail,
      passwordHash: 'argon2id$placeholder',
      name: 'Already Exists',
      role: 'client',
      timezone: 'UTC',
    });
    const [invite] = await db
      .insert(schema.invites)
      .values({
        coachId: coachProfileId,
        email: sharedEmail,
        code: `DUP${String(seq).padStart(5, '0')}`,
      })
      .returning();
    if (!invite) throw new Error('seed insert into invites did not return a row');
    const ctx = createTestContext({ db });

    // Same reasoning as `auth.signUp`'s own doc comment: a duplicate email
    // is deliberately left uncaught here, for the request-wide
    // `databaseErrorBoundary` (not present in this direct-function test) to
    // translate into `UNKNOWN_CONFLICT`.
    await expect(
      acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'Collision',
        timezone: 'UTC',
        dateOfBirth: ADULT_DOB,
        device: DEVICE,
      }),
    ).rejects.toThrow();
  });
});
