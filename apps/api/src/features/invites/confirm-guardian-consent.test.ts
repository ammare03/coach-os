// Real Postgres and real Redis (`testing` skill §4) — the whole point of
// this procedure is a two-table transactional write guarded by a database
// CHECK and a Redis `GETDEL`, and a mocked Drizzle or a stubbed store would
// test neither. Same dynamic-import-after-the-containers-start shape as
// `./accept-invite.test.ts`, whose fixtures this suite reuses in spirit:
// the only way to obtain a real consent token is to accept an invite as a
// 15-year-old and read the link out of the mocked send.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import type { runAgeSweep as RunAgeSweep } from '../../jobs/age-sweep.ts';
import type { isConfirmedGuardianOf as IsConfirmedGuardianOf } from '../../services/export/delegated.ts';

import type { acceptInvite as AcceptInvite } from './accept-invite.ts';
import type { confirmGuardianConsent as ConfirmGuardianConsent } from './confirm-guardian-consent.ts';

jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: DbClient;
let redis: Redis;
let acceptInvite: typeof AcceptInvite;
let confirmGuardianConsent: typeof ConfirmGuardianConsent;
let createTestContext: typeof CreateTestContext;
let runAgeSweep: typeof RunAgeSweep;
let isConfirmedGuardianOf: typeof IsConfirmedGuardianOf;
let sendEmailMock: jest.Mock;

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
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
  ({ runAgeSweep } = await import('../../jobs/age-sweep.ts'));
  ({ isConfirmedGuardianOf } = await import('../../services/export/delegated.ts'));
  ({ sendEmail: sendEmailMock } = (await import('../../lib/email/client.ts')) as unknown as {
    sendEmail: jest.Mock;
  });

  ({ redis } = await import('../../lib/redis.ts'));
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await Promise.all([pgContainer.stop(), redisContainer.stop()]);
}, 60_000);

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ ok: true });
});

let seq = 0;

const DEVICE = { platform: 'ios' as const };

function teenDob(): string {
  const fifteenYearsAgo = new Date();
  fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
  return fifteenYearsAgo.toISOString().slice(0, 10);
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@confirm-consent-test.com`,
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

// Both sends are fire-and-forget on the acceptance path, so this waits for
// the outcome rather than a fixed duration (`./accept-invite.test.ts`'s own
// reasoning: a sleep tuned on an idle machine is a coin flip under load).
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (condition()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after 10s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface MinorFixture {
  userId: string;
  clientProfileId: string;
  guardianEmail: string;
  token: string;
  clientName: string;
}

/**
 * The only honest way to get a token: accept an invite as a 15-year-old and
 * read the link out of the mocked send, exactly as a guardian reads it out
 * of their inbox. Nothing here reaches into Redis to plant one.
 */
async function acceptAsMinor(): Promise<MinorFixture> {
  const coachProfileId = await insertCoach();
  seq += 1;
  const email = `teen-${seq}@confirm-consent-test.com`;
  const code = `TEEN${String(seq).padStart(4, '0')}`;
  const guardianEmail = `guardian-${seq}@confirm-consent-test.com`;
  const clientName = `Teen ${seq}`;
  await db.insert(schema.invites).values({ coachId: coachProfileId, email, code });

  const ctx = createTestContext({ db });
  await acceptInvite(db, ctx, {
    code,
    password: 'a-real-password',
    name: clientName,
    timezone: 'UTC',
    dateOfBirth: teenDob(),
    guardianEmail,
    device: DEVICE,
  });

  interface SentEmail {
    to: string;
    react: { props?: { actionUrl?: string } };
  }
  const sentToGuardian = (): SentEmail[] =>
    (sendEmailMock.mock.calls as Array<[SentEmail]>)
      .map(([sent]) => sent)
      .filter((sent) => sent.to === guardianEmail);
  await waitFor(() => sentToGuardian().length >= 1, 'the guardian consent email');

  const consentUrl = sentToGuardian()[0]?.react.props?.actionUrl;
  const token = consentUrl?.split('/').pop();
  if (!token) throw new Error('expected a consent token in the emailed URL');

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) throw new Error('expected a users row for the accepted invite');
  const [profile] = await db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.userId, user.id));
  if (!profile) throw new Error('expected a client_profiles row for the accepted invite');

  // The precondition every case below depends on: held, not activated.
  expect(user.isMinor).toBe(true);
  expect(user.guardianConsentAt).toBeNull();
  expect(profile.status).toBe('invited');
  expect(profile.activatedAt).toBeNull();

  return { userId: user.id, clientProfileId: profile.id, guardianEmail, token, clientName };
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

function grantRows(userId: string) {
  return db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.action, 'guardian_consent.granted'),
        eq(schema.auditLog.targetId, userId),
      ),
    );
}

describe('confirmGuardianConsent', () => {
  it('sets guardian_consent_at and activates the client profile in one transaction', async () => {
    const minor = await acceptAsMinor();
    const ctx = createTestContext({ db });

    const result = await confirmGuardianConsent(db, ctx, minor.token);

    expect(result).toEqual({ outcome: 'confirmed', clientName: minor.clientName });

    const user = await readUser(minor.userId);
    expect(user.guardianConsentAt).not.toBeNull();

    const profile = await readProfile(minor.clientProfileId);
    expect(profile.status).toBe('active');
    expect(profile.activatedAt).not.toBeNull();
    // Same `now` for both writes — one transaction, one timestamp.
    expect(profile.activatedAt?.getTime()).toBe(user.guardianConsentAt?.getTime());
  });

  // The proof that the CHECK, not the code, is what protects the invariant
  // (`02`'s Verification). If this ever stops rejecting, the "write both in
  // the same UPDATE" rule above becomes a convention rather than a guarantee.
  it("Postgres itself rejects status 'active' with a null activated_at", async () => {
    const minor = await acceptAsMinor();

    // Drizzle wraps the driver error with query context, so the constraint
    // name is only reachable through `unwrapDatabaseError` — asserting on
    // the wrapper's message would pass for any failed update at all.
    const rejection = await db
      .update(schema.clientProfiles)
      .set({ status: 'active', activatedAt: null })
      .where(eq(schema.clientProfiles.id, minor.clientProfileId))
      .then(
        () => null,
        (error: unknown) => unwrapDatabaseError(error),
      );

    expect(rejection?.code).toBe('23514'); // check_violation
    expect(rejection?.constraint_name).toBe('client_status_timestamps');

    const profile = await readProfile(minor.clientProfileId);
    expect(profile.status).toBe('invited');
  });

  it("a second visit to the same link returns 'already_confirmed' and writes nothing more", async () => {
    const minor = await acceptAsMinor();
    const ctx = createTestContext({ db });

    const first = await confirmGuardianConsent(db, ctx, minor.token);
    expect(first.outcome).toBe('confirmed');
    const afterFirst = await readProfile(minor.clientProfileId);
    const consentAfterFirst = (await readUser(minor.userId)).guardianConsentAt;

    const second = await confirmGuardianConsent(db, ctx, minor.token);

    expect(second).toEqual({ outcome: 'already_confirmed' });
    const afterSecond = await readProfile(minor.clientProfileId);
    expect(afterSecond.activatedAt?.toISOString()).toBe(afterFirst.activatedAt?.toISOString());
    expect((await readUser(minor.userId)).guardianConsentAt?.toISOString()).toBe(
      consentAfterFirst?.toISOString(),
    );
    expect(await grantRows(minor.userId)).toHaveLength(1);
  });

  it("an unknown token and an expired one are both 'invalid', indistinguishably", async () => {
    const ctx = createTestContext({ db });

    const unknown = await confirmGuardianConsent(db, ctx, 'not-a-token-anyone-ever-issued');

    // "Expired" is modelled the only way Redis models it: the key is gone.
    const minor = await acceptAsMinor();
    const { hashGuardianConsentToken } = await import('../../lib/auth/guardian-consent-token.ts');
    const { keys } = await import('../../lib/redis-keys.ts');
    await redis.del(keys.guardianConsent(hashGuardianConsentToken(minor.token)).key);
    const expired = await confirmGuardianConsent(db, ctx, minor.token);

    expect(unknown).toEqual({ outcome: 'invalid' });
    expect(expired).toEqual(unknown);

    // Nothing was written for the expired case.
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect((await readProfile(minor.clientProfileId)).status).toBe('invited');
  });

  it("returns 'invalid' and writes nothing for a soft-deleted user", async () => {
    const minor = await acceptAsMinor();
    await db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, minor.userId));
    const ctx = createTestContext({ db });

    const result = await confirmGuardianConsent(db, ctx, minor.token);

    expect(result).toEqual({ outcome: 'invalid' });
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect((await readProfile(minor.clientProfileId)).status).toBe('invited');
    expect(await grantRows(minor.userId)).toHaveLength(0);
  });

  it("returns 'invalid' and writes nothing for an archived profile", async () => {
    const minor = await acceptAsMinor();
    await db
      .update(schema.clientProfiles)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(schema.clientProfiles.id, minor.clientProfileId));
    const ctx = createTestContext({ db });

    const result = await confirmGuardianConsent(db, ctx, minor.token);

    expect(result).toEqual({ outcome: 'invalid' });
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect((await readProfile(minor.clientProfileId)).status).toBe('archived');
    expect(await grantRows(minor.userId)).toHaveLength(0);
  });

  it("returns 'invalid' and writes nothing for a soft-deleted profile", async () => {
    const minor = await acceptAsMinor();
    await db
      .update(schema.clientProfiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.clientProfiles.id, minor.clientProfileId));
    const ctx = createTestContext({ db });

    const result = await confirmGuardianConsent(db, ctx, minor.token);

    expect(result).toEqual({ outcome: 'invalid' });
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect(await grantRows(minor.userId)).toHaveLength(0);
  });

  // The 18th-birthday case. `age-sweep.ts` runs daily and seven days is
  // long enough for it to fire between the email and the click; telling a
  // parent their confirmation "failed" would be wrong.
  it("returns 'already_confirmed' for a client the age sweep has since aged out", async () => {
    const minor = await acceptAsMinor();
    const nineteenYearsAgo = new Date();
    nineteenYearsAgo.setFullYear(nineteenYearsAgo.getFullYear() - 19);
    await db
      .update(schema.users)
      .set({ dateOfBirth: nineteenYearsAgo.toISOString().slice(0, 10) })
      .where(eq(schema.users.id, minor.userId));
    await runAgeSweep(db);
    expect((await readUser(minor.userId)).isMinor).toBe(false);
    const ctx = createTestContext({ db });

    const result = await confirmGuardianConsent(db, ctx, minor.token);

    expect(result).toEqual({ outcome: 'already_confirmed' });
    // No consent to grant any more, and no activation forced through it.
    expect((await readUser(minor.userId)).guardianConsentAt).toBeNull();
    expect(await grantRows(minor.userId)).toHaveLength(0);
  });

  it('activates exactly once when the same link is confirmed twice concurrently', async () => {
    const minor = await acceptAsMinor();
    const ctx = createTestContext({ db });

    const [a, b] = await Promise.all([
      confirmGuardianConsent(db, ctx, minor.token),
      confirmGuardianConsent(db, ctx, minor.token),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toContain('confirmed');
    expect(outcomes.filter((outcome) => outcome === 'confirmed')).toHaveLength(1);
    expect(['already_confirmed', 'invalid']).toContain(
      outcomes.find((outcome) => outcome !== 'confirmed'),
    );

    const profile = await readProfile(minor.clientProfileId);
    expect(profile.status).toBe('active');
    expect(await grantRows(minor.userId)).toHaveLength(1);
  });

  it('writes one audit row attributed to the minor, with no guardian email anywhere in it', async () => {
    const minor = await acceptAsMinor();
    const ctx = createTestContext({ db });

    await confirmGuardianConsent(db, ctx, minor.token);

    const rows = await grantRows(minor.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(minor.userId);
    expect(rows[0]?.targetType).toBe('user');
    expect(JSON.stringify(rows[0])).not.toContain(minor.guardianEmail);
  });

  // `services/export/delegated.ts`'s `isConfirmedGuardianOf` has required a
  // non-null `guardian_consent_at` since `account-lifecycle/12`, and nothing
  // ever set one — this is the first task that makes that path reachable.
  it('unlocks isConfirmedGuardianOf for a guardian holding a matching verified account', async () => {
    const minor = await acceptAsMinor();
    seq += 1;
    const [guardianUser] = await db
      .insert(schema.users)
      .values({
        email: minor.guardianEmail,
        passwordHash: 'argon2id$placeholder',
        name: 'A Guardian',
        role: 'coach',
        timezone: 'UTC',
        emailVerifiedAt: new Date(),
      })
      .returning();
    if (!guardianUser) throw new Error('seed insert into users did not return a row');

    expect(await isConfirmedGuardianOf(db, guardianUser.id, minor.userId)).toBe(false);

    await confirmGuardianConsent(db, createTestContext({ db }), minor.token);

    expect(await isConfirmedGuardianOf(db, guardianUser.id, minor.userId)).toBe(true);
  });
});
