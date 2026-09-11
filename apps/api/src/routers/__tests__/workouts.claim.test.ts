// Real Postgres (`testing` skill §4). What this file proves is exactly what
// a mock cannot: that the claim decision and the write happen under one row
// lock, that two devices racing the same session produce one winner and one
// row, and that the columns move only when the rule says they may.
//
// `phase-09-workout-logger/session-runtime/08`'s Verification is written for
// two physical devices. Two `Context`s with different `deviceId`s against
// one database is the same code path — what it cannot reproduce is real
// radio behaviour, which stays a device check.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import { createTestContext } from '../../__tests__/test-context.ts';
import {
  CLAIM_CEILING_MS,
  CLAIM_HEARTBEAT_STALE_MS,
  CLAIM_HEARTBEAT_WRITE_MIN_MS,
} from '../../features/workouts/claim.ts';
import { computeSessionClientLocalId } from '../../lib/materialise-sessions.ts';
import { upsertWorkoutSession } from '../../lib/workout-session-upsert.ts';
import type { Context, ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;

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
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

const DEVICE_A = '01926b8e-0000-7000-8000-0000000000aa';
const DEVICE_B = '01926b8e-0000-7000-8000-0000000000bb';

// `claim` and `heartbeat` decide against the SERVER's clock — neither takes
// an instant from the caller (`packages/schemas/src/workouts.ts`). So the
// fixtures are anchored on real time rather than on a frozen literal: a
// seeded `claimed_at` of "sixteen minutes ago" is what the server will
// actually measure against when the test calls it a moment later.
function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

/**
 * The server stamped this, so the assertion is a window rather than an
 * instant. Generous enough for a container round trip, far tighter than any
 * threshold under test.
 */
function expectJustStamped(actual: Date | null | undefined): void {
  expect(actual).toBeInstanceOf(Date);
  const ageMs = Date.now() - (actual as Date).getTime();
  expect(ageMs).toBeGreaterThanOrEqual(0);
  expect(ageMs).toBeLessThan(60_000);
}

interface ClientFixture {
  profileId: string;
  user: ContextUser;
  /** One `Context` per simulated device — the only thing that differs. */
  onDevice: (deviceId: string | null) => Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@claim-test.com`,
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
  return profile.id;
}

async function insertClient(coachProfileId: string | null): Promise<ClientFixture> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@claim-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, coachId: coachProfileId, status: 'active', activatedAt: new Date() })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');

  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: 'client',
    timezone: user.timezone,
    locale: user.locale,
    isMinor: user.isMinor,
    guardianConsentAt: user.guardianConsentAt,
    coachProfileId: null,
    clientProfileId: profile.id,
    deletedAt: null,
  };

  return {
    profileId: profile.id,
    user: contextUser,
    onDevice: (deviceId) => createTestContext({ db, user: contextUser, deviceId }),
  };
}

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

async function insertSession(
  client: ClientFixture,
  coachProfileId: string | null,
  overrides: Partial<typeof schema.workoutSessions.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: client.profileId,
      coachId: coachProfileId,
      scheduledDate: '2026-08-15',
      status: 'scheduled',
      clientLocalId: uuidv7(),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return row.id;
}

async function rowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row;
}

/** A session already under way and owned by `deviceId`, heartbeating `heartbeatAgeMs` ago. */
async function insertClaimedSession(
  client: ClientFixture,
  coachProfileId: string | null,
  opts: { deviceId: string; heartbeatAgeMs: number; startedAgoMs?: number },
): Promise<string> {
  return insertSession(client, coachProfileId, {
    status: 'in_progress',
    startedAt: ago(opts.startedAgoMs ?? opts.heartbeatAgeMs),
    activeDeviceId: opts.deviceId,
    claimedAt: ago(opts.heartbeatAgeMs),
  });
}

describe('workouts.start — claiming on the transition', () => {
  it('claims the session for the device that started it', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId);
    const startedAt = new Date('2026-08-15T09:00:00.000Z');

    await caller(client.onDevice(DEVICE_A)).workouts.start({
      workoutSessionId: sessionId,
      clientLocalId: uuidv7(),
      startedAt,
    });

    const row = await rowOf(sessionId);
    expect(row?.activeDeviceId).toBe(DEVICE_A);
    // `claimed_at` is the last heartbeat, and a start is the first one.
    expect(row?.claimedAt?.getTime()).toBe(startedAt.getTime());
  });

  it('leaves the claim untouched on a token that carries no device id', async () => {
    // Not a reason to refuse a client the session in front of them.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId);

    const result = await caller(client.onDevice(null)).workouts.start({
      workoutSessionId: sessionId,
      clientLocalId: uuidv7(),
      startedAt: new Date(),
    });

    expect(result.status).toBe('in_progress');
    const row = await rowOf(sessionId);
    expect(row?.activeDeviceId).toBeNull();
    expect(row?.claimedAt).toBeNull();
  });

  it('keeps one row and one holder when two devices start the SAME server row', async () => {
    // Narrow on purpose: both calls name one id, so this proves only that a
    // second start neither forks the row nor moves the holder. That the two
    // devices arrive at one id in the first place is the deterministic key,
    // and it is proved separately in "the deterministic session key" below —
    // `workouts.start` is UPDATE-only, so `toHaveLength(1)` here would be
    // true of any implementation and cannot stand in for that.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId);
    const send = (deviceId: string, startedAt: Date) =>
      caller(client.onDevice(deviceId)).workouts.start({
        workoutSessionId: sessionId,
        clientLocalId: uuidv7(),
        startedAt,
      });

    await send(DEVICE_A, new Date('2026-08-15T09:00:00.000Z'));
    await send(DEVICE_B, new Date('2026-08-15T09:05:00.000Z'));

    const all = await db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.clientId, client.profileId));
    expect(all).toHaveLength(1);
    // The second start is a no-op on a row already `in_progress`, so it
    // moves neither the instant nor the holder.
    expect(all[0]?.activeDeviceId).toBe(DEVICE_A);
    expect(all[0]?.startedAt?.getTime()).toBe(new Date('2026-08-15T09:00:00.000Z').getTime());
  });

  it('never steals a live claim, even from a start replayed hours later', async () => {
    // A start that reaches the server long after the device tapped it must
    // not take the session from whoever is actually logging.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, {
      activeDeviceId: DEVICE_B,
      claimedAt: ago(60_000),
    });
    const before = await rowOf(sessionId);

    await caller(client.onDevice(DEVICE_A)).workouts.start({
      workoutSessionId: sessionId,
      clientLocalId: uuidv7(),
      startedAt: ago(6 * 60 * 60 * 1_000),
    });

    const row = await rowOf(sessionId);
    expect(row?.status).toBe('in_progress');
    expect(row?.activeDeviceId).toBe(DEVICE_B);
    expect(row?.claimedAt?.getTime()).toBe(before?.claimedAt?.getTime());
  });
});

describe('the deterministic session key', () => {
  // Acceptance criterion: "two devices starting the same scheduled session
  // produce ONE row". That outcome comes from DB§14.5 mechanism 1 — both
  // devices DERIVE `client_local_id` from (client, assignment, local day)
  // instead of minting a random one — and from the unique index that then
  // has something to collide on. Neither is reachable through
  // `workouts.start`, which only ever UPDATEs a row the server already
  // materialised, so the mechanism is exercised at the layer that owns it:
  // the same `upsertWorkoutSession` an offline device's write lands in.
  //
  // Two simulated devices, no shared state but the identity they both see.

  /** What a device computes locally before it has ever spoken to the server. */
  function deviceDerivedKey(clientId: string, assignmentId: string, day: string): string {
    return computeSessionClientLocalId(clientId, assignmentId, day);
  }

  async function sessionsOf(clientProfileId: string) {
    return db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.clientId, clientProfileId));
  }

  it('collapses two independent devices onto one row', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const assignmentId = uuidv7();
    const day = '2026-08-18';

    // Device A and device B each derive the key on their own. Nothing is
    // passed between them — this is the whole mechanism.
    const keyA = deviceDerivedKey(client.profileId, assignmentId, day);
    const keyB = deviceDerivedKey(client.profileId, assignmentId, day);

    const write = (clientLocalId: string, startedAt: Date) =>
      upsertWorkoutSession(db, {
        clientId: client.profileId,
        coachId: coachProfileId,
        clientLocalId,
        scheduledDate: day,
        status: 'in_progress',
        startedAt,
        updatedAt: startedAt,
      });

    await write(keyA, ago(10 * 60_000));
    await write(keyB, ago(5 * 60_000));

    const rows = await sessionsOf(client.profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clientLocalId).toBe(keyA);
  });

  it('would produce two rows if the key were minted per device — the control', async () => {
    // Without this, the assertion above proves nothing: it would pass for an
    // implementation that collapsed every session of a client into one row.
    // Random keys are exactly what an ad-hoc session carries, and two
    // unplanned workouts in a day is a legitimate thing a person does.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const day = '2026-08-19';

    const write = (clientLocalId: string) =>
      upsertWorkoutSession(db, {
        clientId: client.profileId,
        coachId: coachProfileId,
        clientLocalId,
        scheduledDate: day,
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      });

    await write(uuidv7());
    await write(uuidv7());

    expect(await sessionsOf(client.profileId)).toHaveLength(2);
  });

  it('derives a different key per client, per assignment and per day', async () => {
    const clientId = '01926b8e-0000-7000-8000-000000000001';
    const assignmentId = '01926b8e-0000-7000-8000-000000000002';
    const base = deviceDerivedKey(clientId, assignmentId, '2026-08-15');

    expect(
      deviceDerivedKey('01926b8e-0000-7000-8000-0000000000ff', assignmentId, '2026-08-15'),
    ).not.toBe(base);
    expect(
      deviceDerivedKey(clientId, '01926b8e-0000-7000-8000-0000000000ff', '2026-08-15'),
    ).not.toBe(base);
    expect(deviceDerivedKey(clientId, assignmentId, '2026-08-16')).not.toBe(base);
  });

  it('matches the vector the mobile derivation pins, byte for byte', async () => {
    // The contract was pinned on the device side only: `session-key.test.ts`
    // asserts this literal, while the server's own suite compared
    // `computeSessionClientLocalId` against itself. So a change to the
    // server's namespace or name layout broke no server test, and the two
    // implementations would have drifted apart silently — producing exactly
    // the duplicate session this whole mechanism exists to prevent.
    expect(
      computeSessionClientLocalId(
        '01926b8e-0000-7000-8000-000000000001',
        '01926b8e-0000-7000-8000-000000000002',
        '2026-08-15',
      ),
    ).toBe('6ed84a77-cf78-59b4-b784-49603ac274b5');
  });
});

describe('workouts.claim', () => {
  it('claims a session nobody holds', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, { status: 'in_progress' });

    const result = await caller(client.onDevice(DEVICE_A)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });

    expect(result).toEqual({ outcome: 'claimed' });
    expect((await rowOf(sessionId))?.activeDeviceId).toBe(DEVICE_A);
  });

  it('refuses a live claim held by another device, and changes nothing', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 60_000,
    });
    const before = await rowOf(sessionId);

    await expect(
      caller(client.onDevice(DEVICE_B)).workouts.claim({
        workoutSessionId: sessionId,
        transfer: false,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'SESSION_CLAIMED_ELSEWHERE' } });

    const row = await rowOf(sessionId);
    expect(row?.activeDeviceId).toBe(DEVICE_A);
    expect(row?.claimedAt?.getTime()).toBe(before?.claimedAt?.getTime());
  });

  it('transfers a live claim when the client answered “Continue here”', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 60_000,
    });

    const result = await caller(client.onDevice(DEVICE_B)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: true,
    });

    expect(result).toEqual({ outcome: 'transferred' });
    const row = await rowOf(sessionId);
    expect(row?.activeDeviceId).toBe(DEVICE_B);
    expectJustStamped(row?.claimedAt);
  });

  it('transfers a claim gone quiet for 15 minutes with no sheet at all', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: CLAIM_HEARTBEAT_STALE_MS + 60_000,
    });

    const result = await caller(client.onDevice(DEVICE_B)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });

    expect(result).toEqual({ outcome: 'transferred' });
    expect((await rowOf(sessionId))?.activeDeviceId).toBe(DEVICE_B);
  });

  it('transfers past the six-hour ceiling even while the holder is heartbeating', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 30_000,
      startedAgoMs: CLAIM_CEILING_MS + 60_000,
    });

    const result = await caller(client.onDevice(DEVICE_B)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });

    expect(result).toEqual({ outcome: 'transferred' });
  });

  it('renews its own claim rather than reporting a transfer', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: CLAIM_HEARTBEAT_WRITE_MIN_MS + 60_000,
    });

    const result = await caller(client.onDevice(DEVICE_A)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });

    expect(result).toEqual({ outcome: 'renewed' });
    expectJustStamped((await rowOf(sessionId))?.claimedAt);
  });

  it('lets exactly one of two devices racing the same session win', async () => {
    // The row lock, which is the reason the decision and the write are one
    // transaction. Without it both callers read "unclaimed" and both write.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, { status: 'in_progress' });

    const attempt = (deviceId: string) =>
      caller(client.onDevice(deviceId))
        .workouts.claim({ workoutSessionId: sessionId, transfer: false })
        .then((r) => r.outcome)
        .catch(() => 'refused' as const);

    const outcomes = await Promise.all([attempt(DEVICE_A), attempt(DEVICE_B)]);

    expect(outcomes.filter((o) => o === 'claimed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'refused')).toHaveLength(1);
    expect([DEVICE_A, DEVICE_B]).toContain((await rowOf(sessionId))?.activeDeviceId);
  });

  it('reports the session as unclaimable on a token with no device id', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, { status: 'in_progress' });

    const result = await caller(client.onDevice(null)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });

    expect(result).toEqual({ outcome: 'unclaimable' });
  });

  it("refuses another coach's client's session with no existence oracle", async () => {
    const coachA = await insertCoach();
    const coachB = await insertCoach();
    const mine = await insertClient(coachA);
    const theirs = await insertClient(coachB);
    const foreignSessionId = await insertSession(theirs, coachB, { status: 'in_progress' });

    await expect(
      caller(mine.onDevice(DEVICE_A)).workouts.claim({
        workoutSessionId: foreignSessionId,
        transfer: false,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });

    expect((await rowOf(foreignSessionId))?.activeDeviceId).toBeNull();
  });
});

describe('workouts.heartbeat', () => {
  it('moves claimed_at forward once the throttle window has passed', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: CLAIM_HEARTBEAT_WRITE_MIN_MS + 60_000,
    });

    const result = await caller(client.onDevice(DEVICE_A)).workouts.heartbeat({
      workoutSessionId: sessionId,
    });

    expect(result).toEqual({ outcome: 'renewed' });
    expectJustStamped((await rowOf(sessionId))?.claimedAt);
  });

  it('writes nothing while its own claim is still fresh', async () => {
    // Every write advances `updated_at` to the server clock, which is
    // DB§14.3's last-write-wins basis for `status`.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 60_000,
    });
    const before = await rowOf(sessionId);

    const result = await caller(client.onDevice(DEVICE_A)).workouts.heartbeat({
      workoutSessionId: sessionId,
    });

    expect(result).toEqual({ outcome: 'renewed' });
    const after = await rowOf(sessionId);
    expect(after?.claimedAt?.getTime()).toBe(before?.claimedAt?.getTime());
    expect(after?.updatedAt?.getTime()).toBe(before?.updatedAt?.getTime());
  });

  it('never takes a claim from a device the client just transferred to', async () => {
    // The one thing a heartbeat may not do. If it could, A's next tick
    // would steal the session back from B, once per interval, forever.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_B,
      heartbeatAgeMs: 30_000,
    });

    const result = await caller(client.onDevice(DEVICE_A)).workouts.heartbeat({
      workoutSessionId: sessionId,
    });

    expect(result).toEqual({ outcome: 'held_elsewhere' });
    expect((await rowOf(sessionId))?.activeDeviceId).toBe(DEVICE_B);
  });

  it('takes a free claim, which is how a device that started offline records itself', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, {
      status: 'in_progress',
      startedAt: ago(20 * 60_000),
    });

    const result = await caller(client.onDevice(DEVICE_A)).workouts.heartbeat({
      workoutSessionId: sessionId,
    });

    expect(result).toEqual({ outcome: 'claimed' });
    expect((await rowOf(sessionId))?.activeDeviceId).toBe(DEVICE_A);
  });

  it("refuses another coach's client's session", async () => {
    const coachA = await insertCoach();
    const coachB = await insertCoach();
    const mine = await insertClient(coachA);
    const theirs = await insertClient(coachB);
    const foreignSessionId = await insertSession(theirs, coachB, { status: 'in_progress' });

    await expect(
      caller(mine.onDevice(DEVICE_A)).workouts.heartbeat({
        workoutSessionId: foreignSessionId,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });
});

describe('support.clearSessionClaim', () => {
  async function operatorContext(): Promise<Context> {
    seq += 1;
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `operator-${seq}@claim-test.com`,
        passwordHash: 'argon2id$placeholder',
        name: `Operator ${seq}`,
        role: 'coach',
        timezone: 'UTC',
        emailVerifiedAt: new Date(),
        internalOperator: true,
      })
      .returning();
    if (!user) throw new Error('seed insert into users did not return a row');
    const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
    if (!profile) throw new Error('seed insert into coach_profiles did not return a row');

    return createTestContext({
      db,
      user: {
        id: user.id,
        email: user.email,
        role: 'coach',
        timezone: user.timezone,
        locale: user.locale,
        isMinor: user.isMinor,
        guardianConsentAt: user.guardianConsentAt,
        coachProfileId: profile.id,
        clientProfileId: null,
        deletedAt: null,
      },
    });
  }

  it('releases a claim so the client can log on the phone they still own', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 60_000,
    });

    const result = await caller(await operatorContext()).support.clearSessionClaim({
      workoutSessionId: sessionId,
      reason: 'Client lost the phone that holds the claim',
      ticketReference: 'CS-4711',
    });

    expect(result).toEqual({ cleared: true });
    const row = await rowOf(sessionId);
    expect(row?.activeDeviceId).toBeNull();
    expect(row?.claimedAt).toBeNull();
    // The session itself is untouched — this clears a claim, not a workout.
    expect(row?.status).toBe('in_progress');

    // And the client can now take it with no confirmation.
    const claimed = await caller(client.onDevice(DEVICE_B)).workouts.claim({
      workoutSessionId: sessionId,
      transfer: false,
    });
    expect(claimed).toEqual({ outcome: 'claimed' });
  });

  it('records the operator’s attempt even when there was no claim to clear', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertSession(client, coachProfileId, { status: 'in_progress' });

    const result = await caller(await operatorContext()).support.clearSessionClaim({
      workoutSessionId: sessionId,
      reason: 'Client reported being locked out',
      ticketReference: 'CS-4712',
    });

    expect(result).toEqual({ cleared: false });
    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, sessionId));
    expect(entry?.action).toBe('workout_session.claim_cleared_by_operator');
  });

  it('is not reachable by an ordinary coach', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertClaimedSession(client, coachProfileId, {
      deviceId: DEVICE_A,
      heartbeatAgeMs: 60_000,
    });

    await expect(
      caller(client.onDevice(DEVICE_A)).support.clearSessionClaim({
        workoutSessionId: sessionId,
        reason: 'not an operator',
        ticketReference: 'CS-4713',
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'ROLE_REQUIRED' } });

    expect((await rowOf(sessionId))?.activeDeviceId).toBe(DEVICE_A);
  });
});
