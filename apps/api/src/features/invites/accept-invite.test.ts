// Real Postgres (`testing` skill §4) — the invite-state validation, the
// seat re-check, and the minor/guardian branching are exactly the kind of
// behaviour a mocked Drizzle client would test the mock of. Same
// dynamic-import-after-container-starts shape as
// `../auth/social-sign-in.test.ts`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';

import type { acceptInvite as AcceptInvite } from './accept-invite.ts';

// Both notifications go through this one wrapper
// (`./send-guardian-consent-email.ts`, `./send-client-is-minor-email.ts`);
// it is the same boundary `../../__tests__/auth-reset.test.ts` stubs.
jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: DbClient;
let redis: Redis;
let acceptInvite: typeof AcceptInvite;
let createTestContext: typeof CreateTestContext;
let sendEmailMock: jest.Mock;

beforeAll(async () => {
  // Redis is real here too: the consent token is stored there *before* its
  // email is sent, and a stubbed store would hide the ordering this suite
  // asserts (`guardian-consent/01`'s Risks).
  [pgContainer, redisContainer] = await Promise.all([
    new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_USER: 'coachos',
        POSTGRES_PASSWORD: 'coachos',
        POSTGRES_DB: 'coachos',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential
  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

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
  ({ sendEmail: sendEmailMock } = (await import('../../lib/email/client.ts')) as unknown as {
    sendEmail: jest.Mock;
  });

  // Real enforcement, not the fail-open path — connect up front rather than
  // racing the lazy connection against the first real command.
  ({ redis } = await import('../../lib/redis.ts'));
  await redis.connect();
}, 60_000);

// Teardown carries the same timeout as setup: stopping a container is not cheaper than
// starting one, and Jest would otherwise fall back to its 5s default.
afterAll(async () => {
  await db.$client.end();
  await Promise.all([pgContainer.stop(), redisContainer.stop()]);
}, 60_000);

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true });
});

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

// Both sends are fire-and-forget (`./accept-invite.ts`), so these
// assertions wait for the OUTCOME rather than a duration — the reasoning
// `../../__tests__/auth-reset.test.ts` records for the same shape: a fixed
// sleep tuned on an idle machine becomes a coin flip under a full suite.
async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after 10s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Proving an email was NOT sent has no condition to poll — absence is only
// ever "nothing yet" — so this stays a bounded wait, deliberately generous.
function waitForSendToSettle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

interface SentEmail {
  to: string;
  subject: string;
  react: { props?: { actionUrl?: string } };
}

function sentTo(address: string): SentEmail[] {
  return (sendEmailMock.mock.calls as Array<[SentEmail]>)
    .map(([sent]) => sent)
    .filter((sent) => sent.to === address);
}

async function coachUserFor(coachProfileId: string): Promise<{ name: string; email: string }> {
  const [row] = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.coachProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.coachProfiles.userId))
    .where(eq(schema.coachProfiles.id, coachProfileId));
  if (!row) throw new Error('expected a users row behind the coach profile');
  return row;
}

describe('acceptInvite guardian-consent notifications', () => {
  it('sends exactly one email to the guardian and one to the coach for a 13-17 client', async () => {
    const coachProfileId = await insertCoach();
    const coach = await coachUserFor(coachProfileId);
    const invite = await insertInvite(coachProfileId);
    const guardianEmail = `guardian-${++seq}@accept-invite-test.com`;
    const ctx = createTestContext({ db });

    await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail,
      device: DEVICE,
    });

    await waitFor(
      () => sentTo(guardianEmail).length >= 1 && sentTo(coach.email).length >= 1,
      'both notifications to be sent',
    );
    // ...then settle, so a wrongly-sent duplicate fails this rather than
    // arriving just after the assertion.
    await waitForSendToSettle();
    expect(sentTo(guardianEmail)).toHaveLength(1);
    expect(sentTo(coach.email)).toHaveLength(1);
  });

  it('sends neither email for an 18+ client', async () => {
    const coachProfileId = await insertCoach();
    const coach = await coachUserFor(coachProfileId);
    const invite = await insertInvite(coachProfileId);
    const ctx = createTestContext({ db });

    await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'An Adult',
      timezone: 'UTC',
      dateOfBirth: ADULT_DOB,
      device: DEVICE,
    });

    await waitForSendToSettle();
    expect(sentTo(coach.email)).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('links the guardian at an https APP_PUBLIC_URL route, never a coachos:// deep link', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const guardianEmail = `guardian-${++seq}@accept-invite-test.com`;
    const ctx = createTestContext({ db });

    await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail,
      device: DEVICE,
    });

    await waitFor(() => sentTo(guardianEmail).length >= 1, 'the guardian email to be sent');
    const consentUrl = sentTo(guardianEmail)[0]?.react.props?.actionUrl;
    expect(consentUrl).toBeDefined();
    expect(consentUrl?.startsWith('https://app.coachos.test/guardian-consent/')).toBe(true);
    // The raw token is in the URL; only its hash was ever stored.
    expect(consentUrl?.split('/').pop()?.length).toBeGreaterThan(0);
  });

  it('writes one guardian_consent.requested audit row against the minor', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const guardianEmail = `guardian-${++seq}@accept-invite-test.com`;
    const ctx = createTestContext({ db });

    await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail,
      device: DEVICE,
    });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    if (!user) throw new Error('expected a users row for the accepted invite');

    const auditRows = () =>
      db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'guardian_consent.requested'),
            eq(schema.auditLog.targetId, user.id),
          ),
        );
    await waitFor(async () => (await auditRows()).length >= 1, 'the audit_log row to be written');
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(user.id);
    expect(JSON.stringify(rows[0])).not.toContain(guardianEmail);
  });

  it('sends no guardian email when the token cannot be stored, and the acceptance still succeeds', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const guardianEmail = `guardian-${++seq}@accept-invite-test.com`;
    const ctx = createTestContext({ db });
    // Every Redis write in this window fails. The session-cache write is
    // wrapped in `safeRedis` and shrugs it off; the consent-token write is
    // deliberately not, so no link is emailed that could never work.
    //
    // Two spies, not one: `guardian-consent/04` made the token store a
    // `MULTI` — the token and the reverse pointer that lets a corrected
    // guardian address revoke it have to land together
    // (`../../lib/auth/guardian-consent-token.ts`). What this test is about
    // is the absence of a send, not which command carries the write.
    const setSpy = jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis unavailable'));
    const multiSpy = jest.spyOn(redis, 'multi').mockImplementation(() => {
      throw new Error('redis unavailable');
    });

    try {
      const session = await acceptInvite(db, ctx, {
        code: invite.code,
        password: 'a-real-password',
        name: 'A Teen',
        timezone: 'UTC',
        dateOfBirth: teenDob(),
        guardianEmail,
        device: DEVICE,
      });
      expect(session.user.role).toBe('client');

      await waitForSendToSettle();
      expect(sentTo(guardianEmail)).toHaveLength(0);
    } finally {
      setSpy.mockRestore();
      multiSpy.mockRestore();
    }

    // The account is still there, still held pending consent.
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
    expect(user?.isMinor).toBe(true);
    expect(user?.guardianConsentAt).toBeNull();
  });

  it('completes the acceptance even when a send rejects', async () => {
    const coachProfileId = await insertCoach();
    const invite = await insertInvite(coachProfileId);
    const guardianEmail = `guardian-${++seq}@accept-invite-test.com`;
    const ctx = createTestContext({ db });
    sendEmailMock.mockRejectedValue(new Error('resend is down'));

    const session = await acceptInvite(db, ctx, {
      code: invite.code,
      password: 'a-real-password',
      name: 'A Teen',
      timezone: 'UTC',
      dateOfBirth: teenDob(),
      guardianEmail,
      device: DEVICE,
    });

    expect(session.user.role).toBe('client');
    await waitForSendToSettle();

    const [clientUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, invite.email));
    expect(clientUser?.isMinor).toBe(true);
  });
});
