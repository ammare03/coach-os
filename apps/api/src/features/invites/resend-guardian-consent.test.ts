// Real Postgres and real Redis (`testing` skill §4). Every claim this task
// makes is about the interaction between a database row, two Redis
// counters, and a token store — a mocked Drizzle or a stubbed Redis would
// test none of them, and the headline criterion ("changing the address
// invalidates the link already sent") is *only* observable by confirming
// with the old token afterwards.
//
// Same dynamic-import-after-the-containers-start shape as
// `./confirm-guardian-consent.test.ts`, whose fixtures this suite mirrors:
// the only honest way to obtain a consent token is to accept an invite as a
// 15-year-old and read the link out of the mocked send.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { invites as invitesSchemas } from '@coachos/schemas';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import type { keys as Keys } from '../../lib/redis-keys.ts';
import type { invitesRouter as InvitesRouter } from '../../routers/invites.ts';
import type { createContext as CreateContext } from '../../trpc/context.ts';
import type { router as Router } from '../../trpc/init.ts';
import type { clientProcedure as ClientProcedure } from '../../trpc/procedures.ts';

import type { acceptInvite as AcceptInvite } from './accept-invite.ts';
import type { confirmGuardianConsent as ConfirmGuardianConsent } from './confirm-guardian-consent.ts';
import type { resendGuardianConsent as ResendGuardianConsent } from './resend-guardian-consent.ts';

jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: DbClient;
let redis: Redis;
let keys: typeof Keys;
let acceptInvite: typeof AcceptInvite;
let confirmGuardianConsent: typeof ConfirmGuardianConsent;
let resendGuardianConsent: typeof ResendGuardianConsent;
let createTestContext: typeof CreateTestContext;
let createContext: typeof CreateContext;
let hashGuardianConsentToken: (token: string) => string;
let sendEmailMock: jest.Mock;
// The pool `../../trpc/context.ts` opens at module scope, held so `afterAll`
// can close it — this suite's own `db` is a second, separate pool.
let contextDb: DbClient;

// The **real** `invitesRouter`, mounted under a scratch parent alongside one
// gated probe. Nothing in the invites tree imports `queues/registry.ts`, so
// this stays clear of its eager BullMQ connections (`docs/UNFORGET.md` S9)
// while still proving the claim on the real procedure rather than a
// re-declared copy of it.
function buildScratchRouter(
  router: typeof Router,
  invites: typeof InvitesRouter,
  clientProcedure: typeof ClientProcedure,
) {
  return router({
    invites,
    gated: clientProcedure.query(({ ctx }) => ({ clientProfileId: ctx.user.clientProfileId })),
  });
}
let scratchRouter: ReturnType<typeof buildScratchRouter>;

beforeAll(async () => {
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
  ({ confirmGuardianConsent } = await import('./confirm-guardian-consent.ts'));
  ({ resendGuardianConsent } = await import('./resend-guardian-consent.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
  ({ keys } = await import('../../lib/redis-keys.ts'));
  ({ hashGuardianConsentToken } = await import('../../lib/auth/guardian-consent-token.ts'));
  ({ sendEmail: sendEmailMock } = (await import('../../lib/email/client.ts')) as unknown as {
    sendEmail: jest.Mock;
  });

  ({ redis } = await import('../../lib/redis.ts'));
  await redis.connect();

  ({ createContext } = await import('../../trpc/context.ts'));
  const { router } = await import('../../trpc/init.ts');
  const { clientProcedure } = (await import('../../trpc/procedures.ts')) as {
    clientProcedure: typeof ClientProcedure;
  };
  const { invitesRouter } = (await import('../../routers/invites.ts')) as {
    invitesRouter: typeof InvitesRouter;
  };
  scratchRouter = buildScratchRouter(router, invitesRouter, clientProcedure);
  contextDb = (await createContext(new Request('http://localhost/trpc/health.ping'))).db;
}, 90_000);

afterAll(async () => {
  await Promise.all([db.$client.end(), contextDb.$client.end()]);
  await Promise.all([pgContainer.stop(), redisContainer.stop()]);
}, 60_000);

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true });
});

let seq = 0;

const DEVICE = { platform: 'ios' as const };

function dobYearsAgo(years: number): string {
  const then = new Date();
  then.setFullYear(then.getFullYear() - years);
  return then.toISOString().slice(0, 10);
}

interface SentEmail {
  to: string;
  react: { props?: { actionUrl?: string } };
}

function sentTo(address: string): SentEmail[] {
  return (sendEmailMock.mock.calls as Array<[SentEmail]>)
    .map(([sent]) => sent)
    .filter((sent) => sent.to === address);
}

/** The token out of the newest email to `address`, exactly as a recipient reads it. */
function newestTokenTo(address: string): string {
  const sent = sentTo(address);
  const url = sent.at(-1)?.react.props?.actionUrl;
  const token = url?.split('/').pop();
  if (!token) throw new Error(`expected a consent link in an email to ${address}`);
  return token;
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (condition()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after 10s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Coach {
  userId: string;
  coachProfileId: string;
}

async function insertCoach(): Promise<Coach> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@resend-consent-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return { userId: user.id, coachProfileId: profile.id };
}

interface AcceptedClient {
  userId: string;
  clientProfileId: string;
  guardianEmail: string;
  clientName: string;
  accessToken: string;
  /** Only meaningful for a minor — the link the acceptance already emailed. */
  token: string;
}

async function acceptAs(ageYears: number): Promise<AcceptedClient> {
  const coach = await insertCoach();
  seq += 1;
  const email = `client-${seq}@resend-consent-test.com`;
  const code = `RSND${String(seq).padStart(4, '2')}`;
  const guardianEmail = `guardian-${seq}@resend-consent-test.com`;
  const clientName = `Client ${seq}`;
  const isMinor = ageYears < 18;
  await db.insert(schema.invites).values({ coachId: coach.coachProfileId, email, code });

  const session = await acceptInvite(db, createTestContext({ db }), {
    code,
    password: 'a-real-password',
    name: clientName,
    timezone: 'UTC',
    dateOfBirth: dobYearsAgo(ageYears),
    guardianEmail: isMinor ? guardianEmail : undefined,
    device: DEVICE,
  });

  if (isMinor) {
    await waitFor(() => sentTo(guardianEmail).length >= 1, 'the guardian consent email');
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw new Error('expected a users row for the accepted invite');
  const [profile] = await db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.userId, user.id));
  if (!profile) throw new Error('expected a client_profiles row for the accepted invite');

  return {
    userId: user.id,
    clientProfileId: profile.id,
    guardianEmail,
    clientName,
    accessToken: session.accessToken,
    token: isMinor ? newestTokenTo(guardianEmail) : '',
  };
}

/** A 15-year-old, held at `'invited'` with consent outstanding — this suite's subject. */
async function acceptAsMinor(): Promise<AcceptedClient> {
  const accepted = await acceptAs(15);
  const user = await readUser(accepted.userId);
  expect(user.isMinor).toBe(true);
  expect(user.guardianConsentAt).toBeNull();
  expect((await readProfile(accepted.clientProfileId)).status).toBe('invited');
  return accepted;
}

async function readUser(userId: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!row) throw new Error('expected a users row');
  return row;
}

async function readProfile(clientProfileId: string) {
  const [row] = await db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.id, clientProfileId));
  if (!row) throw new Error('expected a client_profiles row');
  return row;
}

function emailChangeRows(userId: string) {
  return db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.action, 'guardian_consent.email_changed'),
        eq(schema.auditLog.targetId, userId),
      ),
    );
}

// Recomputed here rather than imported from the module under test, so a
// change to how an address is hashed fails this suite instead of agreeing
// with itself.
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------

// The criterion `guardian-consent/03` left a pending assertion for, proved
// against the real router and the real middleware chain rather than
// inferred from where the procedure is declared: the caller here is
// literally an account `clientProcedure` is refusing in the line above.
describe('reachability while the consent gate is blocking', () => {
  async function callerOn(accessToken: string) {
    const request = new Request('http://localhost/trpc/invites.resendGuardianConsent', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return scratchRouter.createCaller(await createContext(request));
  }

  it('is callable by exactly the account clientProcedure rejects', async () => {
    const minor = await acceptAsMinor();
    const caller = await callerOn(minor.accessToken);

    await expect(caller.gated()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'GUARDIAN_CONSENT_PENDING' },
    });

    await expect(caller.invites.resendGuardianConsent({})).resolves.toEqual({ success: true });
    expect(sentTo(minor.guardianEmail)).toHaveLength(2); // the acceptance's, plus this one
  });

  it('accepts a corrected address through the real input schema', async () => {
    const minor = await acceptAsMinor();
    const corrected = `corrected-${seq}@resend-consent-test.com`;
    const caller = await callerOn(minor.accessToken);

    await expect(
      caller.invites.resendGuardianConsent({ guardianEmail: corrected.toUpperCase() }),
    ).resolves.toEqual({ success: true });

    // `email` lowercases at the edge, so the stored address is canonical.
    expect((await readUser(minor.userId)).guardianEmail).toBe(corrected);
    expect(sentTo(corrected)).toHaveLength(1);
  });
});

describe('resendGuardianConsent', () => {
  it('issues a fresh, working token and re-sends to the address on file', async () => {
    const minor = await acceptAsMinor();

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {});

    expect(sentTo(minor.guardianEmail)).toHaveLength(2);
    const resent = newestTokenTo(minor.guardianEmail);
    expect(resent).not.toBe(minor.token);

    const result = await confirmGuardianConsent(db, createTestContext({ db }), resent);
    expect(result).toEqual({ outcome: 'confirmed', clientName: minor.clientName });
  });

  // The headline criterion. Whoever received the mistyped email must not
  // keep a link that still activates a child's account.
  it('a corrected address is stored, used, and kills the link already sent', async () => {
    const minor = await acceptAsMinor();
    const corrected = `corrected-${seq}@resend-consent-test.com`;

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {
      guardianEmail: corrected,
    });

    expect((await readUser(minor.userId)).guardianEmail).toBe(corrected);
    expect(sentTo(corrected)).toHaveLength(1);
    expect(sentTo(minor.guardianEmail)).toHaveLength(1); // still only the acceptance's
    const tokenB = newestTokenTo(corrected);
    expect(tokenB).not.toBe(minor.token);

    // Token A first: it must be dead *before* B is used, or the assertion
    // would pass for the wrong reason (`already_confirmed`).
    await expect(
      confirmGuardianConsent(db, createTestContext({ db }), minor.token),
    ).resolves.toEqual({ outcome: 'invalid' });
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect((await readProfile(minor.clientProfileId)).status).toBe('invited');

    await expect(confirmGuardianConsent(db, createTestContext({ db }), tokenB)).resolves.toEqual({
      outcome: 'confirmed',
      clientName: minor.clientName,
    });
    expect((await readProfile(minor.clientProfileId)).status).toBe('active');
  });

  // `users_minor_has_guardian` is `NOT is_minor OR guardian_email IS NOT
  // NULL`, so the only way to violate it from here would be an input that
  // admits a cleared address. It does not.
  it('offers no way to clear the guardian address', () => {
    const { resendGuardianConsentInput } = invitesSchemas;

    expect(resendGuardianConsentInput.safeParse({ guardianEmail: '' }).success).toBe(false);
    expect(resendGuardianConsentInput.safeParse({ guardianEmail: null }).success).toBe(false);
    expect(resendGuardianConsentInput.safeParse({ guardianEmail: '   ' }).success).toBe(false);
    expect(resendGuardianConsentInput.safeParse({}).success).toBe(true);
  });

  it('leaves the stored address intact on a plain resend', async () => {
    const minor = await acceptAsMinor();

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {});

    expect((await readUser(minor.userId)).guardianEmail).toBe(minor.guardianEmail);
    expect(await emailChangeRows(minor.userId)).toHaveLength(0);
  });

  // A post-consent guardian change is a guardian-substitution attack:
  // `services/export/delegated.ts` matches a guardian purely on this
  // address, so moving it would hand over export and deletion rights.
  it('changes nothing and sends nothing once consent has been granted', async () => {
    const minor = await acceptAsMinor();
    await confirmGuardianConsent(db, createTestContext({ db }), minor.token);
    const consentAt = (await readUser(minor.userId)).guardianConsentAt;
    sendEmailMock.mockClear();
    const attacker = `substitute-${seq}@resend-consent-test.com`;

    const result = await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {
      guardianEmail: attacker,
    });

    expect(result).toEqual({ success: true });
    const user = await readUser(minor.userId);
    expect(user.guardianEmail).toBe(minor.guardianEmail);
    expect(user.guardianConsentAt?.toISOString()).toBe(consentAt?.toISOString());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await emailChangeRows(minor.userId)).toHaveLength(0);
  });

  it('reveals nothing to an adult client, and sends nothing', async () => {
    const adult = await acceptAs(30);
    expect((await readUser(adult.userId)).isMinor).toBe(false);
    sendEmailMock.mockClear();

    const result = await resendGuardianConsent(db, createTestContext({ db }), adult.userId, {
      guardianEmail: `not-a-guardian-${seq}@resend-consent-test.com`,
    });

    expect(result).toEqual({ success: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect((await readUser(adult.userId)).guardianEmail).toBeNull();
    expect(await emailChangeRows(adult.userId)).toHaveLength(0);
  });

  it('reveals nothing to a coach, and sends nothing', async () => {
    const coach = await insertCoach();
    sendEmailMock.mockClear();

    const result = await resendGuardianConsent(db, createTestContext({ db }), coach.userId, {
      guardianEmail: `not-a-guardian-${seq}@resend-consent-test.com`,
    });

    expect(result).toEqual({ success: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await emailChangeRows(coach.userId)).toHaveLength(0);
  });

  it('records an address change in audit_log with neither address in plaintext', async () => {
    const minor = await acceptAsMinor();
    const corrected = `corrected-${seq}@resend-consent-test.com`;

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {
      guardianEmail: corrected,
    });

    const rows = await emailChangeRows(minor.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(minor.userId);
    expect(rows[0]?.targetType).toBe('user');
    expect(rows[0]?.metadata).toEqual({
      previousEmailHash: sha256(minor.guardianEmail),
      newEmailHash: sha256(corrected),
    });
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain(minor.guardianEmail);
    expect(serialised).not.toContain(corrected);
  });

  it('puts no raw email address into any Redis key', async () => {
    const minor = await acceptAsMinor();
    const corrected = `corrected-${seq}@resend-consent-test.com`;

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {
      guardianEmail: corrected,
    });

    const allKeys = await redis.keys('*');
    expect(allKeys.length).toBeGreaterThan(0);
    for (const key of allKeys) {
      expect(key).not.toContain('@');
      expect(key).not.toContain(corrected);
      expect(key).not.toContain(minor.guardianEmail);
    }
    // And the destination counter is genuinely there, under its hash.
    expect(allKeys).toContain(keys.rateLimitGuardianConsentEmail(sha256(corrected)).key);
  });

  // `docs/UNFORGET.md` S7's stranding question, tested. A free-tier Redis
  // restart evicts the token; nothing in Postgres records that a consent
  // request is outstanding; this is the only way back.
  it('recovers an evicted token with no operator involvement', async () => {
    const minor = await acceptAsMinor();
    await redis.del(keys.guardianConsent(hashGuardianConsentToken(minor.token)).key);
    await expect(
      confirmGuardianConsent(db, createTestContext({ db }), minor.token),
    ).resolves.toEqual({ outcome: 'invalid' });

    await resendGuardianConsent(db, createTestContext({ db }), minor.userId, {});

    const recovered = newestTokenTo(minor.guardianEmail);
    await expect(confirmGuardianConsent(db, createTestContext({ db }), recovered)).resolves.toEqual(
      {
        outcome: 'confirmed',
        clientName: minor.clientName,
      },
    );
    const profile = await readProfile(minor.clientProfileId);
    expect(profile.status).toBe('active');
    expect(profile.activatedAt).not.toBeNull();
  });
});

describe('the two rate-limit axes', () => {
  it('rejects a caller on the fourth attempt inside the window', async () => {
    const minor = await acceptAsMinor();
    const ctx = createTestContext({ db });
    // A different destination every time, so each address counter sits at 1
    // and only the per-user counter can be what trips.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await resendGuardianConsent(db, ctx, minor.userId, {
        guardianEmail: `per-user-${seq}-${attempt}@resend-consent-test.com`,
      });
    }

    await expect(
      resendGuardianConsent(db, ctx, minor.userId, {
        guardianEmail: `per-user-${seq}-4@resend-consent-test.com`,
      }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      cause: { appCode: 'RATE_LIMITED' },
    });
  });

  // Without this axis the correction field is a mailbomb: accounts are free
  // to create, so a per-user limit alone bounds nothing for the inbox on
  // the receiving end.
  it('limits one destination address independently of who is sending', async () => {
    const first = await acceptAsMinor();
    const second = await acceptAsMinor();
    const ctx = createTestContext({ db });
    const victim = `victim-${seq}@resend-consent-test.com`;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await resendGuardianConsent(db, ctx, first.userId, { guardianEmail: victim });
    }
    expect(sentTo(victim)).toHaveLength(3);

    // A different account, on its very first call — its own per-user
    // counter is 1, so only the destination counter can reject this.
    await expect(
      resendGuardianConsent(db, ctx, second.userId, { guardianEmail: victim }),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      cause: { appCode: 'RATE_LIMITED' },
    });
    expect(sentTo(victim)).toHaveLength(3);
  });
});
