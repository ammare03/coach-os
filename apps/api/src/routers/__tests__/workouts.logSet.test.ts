// Real Postgres (`testing` skill §4). What this file proves is exactly what
// a mock cannot: that `ON CONFLICT (client_id, client_local_id)` finds the
// index it names and produces ONE row however many times the outbox replays
// it, that the device's payload replaces the stored row field for field
// (DB§14.3) rather than merging into it, that `estimated_1rm_kg` survives a
// `numeric(6,2)` round trip, that a key belonging to another client resolves
// to nothing, and that a set arriving after a completion drags
// `total_volume_kg` back into agreement with the rows it summarises.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { sessionVolumeKg } from '@coachos/utils';
import type { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import { createTestContext } from '../../__tests__/test-context.ts';
import { isCatalogedError, type AppErrorCause } from '../../lib/app-error.ts';
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

const STARTED_AT = new Date('2026-08-15T09:00:00.000Z');
/** The tap. Deliberately far from `now()`, which is what a basement session looks like. */
const TAPPED_AT = new Date('2026-08-15T09:14:22.000Z');

interface ClientFixture {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@logset-test.com`,
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
      email: `client-${seq}@logset-test.com`,
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
    deletionScheduledFor: null,
    deletedAt: null,
  };

  return {
    profileId: profile.id,
    ctx: createTestContext({ db, user: contextUser, deviceId: null }),
  };
}

async function insertExercise(): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(schema.exercises)
    .values({
      name: `Back squat ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning();
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

interface SessionFixture {
  serverId: string;
  sessionClientLocalId: string;
}

async function insertSession(
  client: ClientFixture,
  coachProfileId: string | null,
  overrides: Partial<typeof schema.workoutSessions.$inferInsert> = {},
): Promise<SessionFixture> {
  const sessionClientLocalId = uuidv7();
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: client.profileId,
      coachId: coachProfileId,
      scheduledDate: '2026-08-15',
      status: 'in_progress',
      startedAt: STARTED_AT,
      clientLocalId: sessionClientLocalId,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return { serverId: row.id, sessionClientLocalId: row.clientLocalId ?? sessionClientLocalId };
}

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

async function setsOf(clientProfileId: string, clientLocalId: string) {
  return db
    .select()
    .from(schema.setLogs)
    .where(
      and(
        eq(schema.setLogs.clientId, clientProfileId),
        eq(schema.setLogs.clientLocalId, clientLocalId),
      ),
    );
}

async function sessionRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, id));
  return row;
}

/** The payload a device sends for one ordinary working set. */
function payload(
  session: SessionFixture,
  exerciseId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    sessionClientLocalId: session.sessionClientLocalId,
    exerciseId,
    clientLocalId: uuidv7(),
    setNumber: 1,
    reps: 10,
    weightKg: 80,
    loggedAt: TAPPED_AT,
    isWarmup: false,
    isFailure: false,
    ...overrides,
  };
}

describe('workouts.logSet — the write', () => {
  it('writes the set against the resolved session, with the device instant', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId);
    const result = await caller(client.ctx).workouts.logSet(input);

    expect(result.workoutSessionId).toBe(session.serverId);
    expect(result.setNumber).toBe(1);
    expect(result.reps).toBe(10);
    expect(result.weightKg).toBe(80);
    expect(result.loggedAt).toEqual(TAPPED_AT);

    const [row] = await setsOf(client.profileId, input.clientLocalId);
    // `client_id` is `ctx.user.clientProfileId`, never the wire, and it has
    // to agree with the session's own — DB§6's denormalisation is only safe
    // because the resolver never takes the caller's word for either.
    expect(row?.clientId).toBe(client.profileId);
    expect(row?.workoutSessionId).toBe(session.serverId);
    // Not `now()`. A session logged in a basement and synced hours later
    // keeps the instant the client actually trained at (`offline-sync` §10).
    expect(row?.loggedAt).toEqual(TAPPED_AT);
  });

  it('computes estimated_1rm_kg by Epley and stores it at the column scale', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const result = await caller(client.ctx).workouts.logSet(
      payload(session, exerciseId, { reps: 10, weightKg: 80 }),
    );

    // 80 × (1 + 10/30) = 106.666… → 106.67 in `numeric(6,2)`.
    expect(result.estimated1rmKg).toBe(106.67);
  });

  it('returns the lifted weight for a single, which is Epley at r = 1', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const result = await caller(client.ctx).workouts.logSet(
      payload(session, exerciseId, { reps: 1, weightKg: 140 }),
    );

    expect(result.estimated1rmKg).toBe(140);
  });

  it('leaves the estimate null for a bodyweight set and for a zero-rep attempt', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const bodyweight = await caller(client.ctx).workouts.logSet(
      payload(session, exerciseId, { weightKg: null }),
    );
    const failed = await caller(client.ctx).workouts.logSet(
      payload(session, exerciseId, { setNumber: 2, reps: 0, isFailure: true }),
    );

    // Null, never zero: "no external load" and "a 0kg one-rep max" are
    // different claims, and only one of them is true (`COPY.md` CO§2).
    expect(bodyweight.estimated1rmKg).toBeNull();
    expect(bodyweight.weightKg).toBeNull();
    expect(failed.estimated1rmKg).toBeNull();
    expect(failed.isFailure).toBe(true);
  });
});

describe('workouts.logSet — idempotency and device-wins (DB§14.1, DB§14.3)', () => {
  it('produces one row when the same clientLocalId is replayed', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId);

    const first = await caller(client.ctx).workouts.logSet(input);
    const second = await caller(client.ctx).workouts.logSet(input);
    const third = await caller(client.ctx).workouts.logSet(input);

    // One row, three identical responses — `offline-sync` §3's whole rule.
    const rows = await setsOf(client.profileId, input.clientLocalId);
    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(second).toEqual(first);
  });

  it('creates one row when two replays land concurrently', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId);

    // Two flushes racing is a real scenario — foreground and a connectivity
    // event fire together (`offline-sync` §4).
    const [a, b] = await Promise.all([
      caller(client.ctx).workouts.logSet(input),
      caller(client.ctx).workouts.logSet(input),
    ]);

    expect(await setsOf(client.profileId, input.clientLocalId)).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('replaces every field the device resubmits, including the ones it cleared', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId, { reps: 10, weightKg: 80, isWarmup: true });
    const stored = await caller(client.ctx).workouts.logSet(input);

    // `set-entry/05`'s edit: the SAME key, new numbers, and a weight the
    // client cleared. A field-level merge would keep the 80.
    const edited = await caller(client.ctx).workouts.logSet({
      ...input,
      setNumber: 2,
      reps: 6,
      weightKg: null,
      isWarmup: false,
      isFailure: true,
      loggedAt: new Date('2026-08-15T09:31:00.000Z'),
    });

    expect(edited.id).toBe(stored.id);
    expect(edited.setNumber).toBe(2);
    expect(edited.reps).toBe(6);
    expect(edited.weightKg).toBeNull();
    expect(edited.estimated1rmKg).toBeNull();
    expect(edited.isWarmup).toBe(false);
    expect(edited.isFailure).toBe(true);
    expect(await setsOf(client.profileId, input.clientLocalId)).toHaveLength(1);
  });

  it("stores the device's note, and lets a re-send clear it", async () => {
    // `session-modifications/02`. The substitution fact rides in
    // `set_logs.notes` — an existing column, no schema addition — and the
    // device composes the whole string. An omitted key would leave a stale
    // note standing, which is why the payload always names it.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId, {
      notes: 'Substituted for Barbell back squat.',
    });
    await caller(client.ctx).workouts.logSet(input);

    const [stored] = await setsOf(client.profileId, input.clientLocalId);
    expect(stored?.notes).toBe('Substituted for Barbell back squat.');

    await caller(client.ctx).workouts.logSet({ ...input, notes: null });

    const [cleared] = await setsOf(client.profileId, input.clientLocalId);
    expect(cleared?.notes).toBeNull();
  });

  it('does not resurrect a set that was deleted after it was logged', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const input = payload(session, exerciseId);
    const stored = await caller(client.ctx).workouts.logSet(input);

    // `set-entry/06` will soft-delete it; a re-queued original log must not
    // undo that, which is why `deleted_at` is not in the upsert's payload.
    await db
      .update(schema.setLogs)
      .set({ deletedAt: new Date() })
      .where(eq(schema.setLogs.id, stored.id));

    await caller(client.ctx).workouts.logSet(input);

    const [row] = await setsOf(client.profileId, input.clientLocalId);
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe('workouts.logSet — authorisation', () => {
  it("refuses a session key belonging to another coach's client", async () => {
    const coachA = await insertCoach();
    const coachB = await insertCoach();
    const clientA = await insertClient(coachA);
    const clientB = await insertClient(coachB);
    const sessionB = await insertSession(clientB, coachB);
    const exerciseId = await insertExercise();

    // Client A sends client B's session key. There is no id here that
    // `ownsResource` could guard — the predicate is what refuses it.
    const error = await caller(clientA.ctx)
      .workouts.logSet(payload(sessionB, exerciseId))
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(isCatalogedError(error)).toBe(true);
    // `NOT_FOUND`, never `FORBIDDEN` — anything finer is an existence
    // oracle (`ERRORS.md` ER§2.1).
    expect((error as TRPCError & { cause: AppErrorCause }).code).toBe('NOT_FOUND');
    expect((error as TRPCError & { cause: AppErrorCause }).cause.appCode).toBe('NOT_YOUR_CLIENT');

    // And nothing was written under either client.
    const written = await db
      .select()
      .from(schema.setLogs)
      .where(eq(schema.setLogs.workoutSessionId, sessionB.serverId));
    expect(written).toHaveLength(0);
  });

  it('refuses a session key that names nothing at all', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const exerciseId = await insertExercise();

    await expect(
      caller(client.ctx).workouts.logSet(
        payload({ serverId: uuidv7(), sessionClientLocalId: uuidv7() }, exerciseId),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a soft-deleted session', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, { deletedAt: new Date() });
    const exerciseId = await insertExercise();

    await expect(
      caller(client.ctx).workouts.logSet(payload(session, exerciseId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("rejects a coach outright — logging is the client's own act", async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const [coachUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, 'coach'))
      .limit(1);
    if (!coachUser) throw new Error('no coach user seeded');

    const coachCtx = createTestContext({
      db,
      user: {
        id: coachUser.id,
        email: coachUser.email,
        role: 'coach',
        timezone: coachUser.timezone,
        locale: coachUser.locale,
        isMinor: coachUser.isMinor,
        guardianConsentAt: coachUser.guardianConsentAt,
        coachProfileId,
        clientProfileId: null,
        deletionScheduledFor: null,
        deletedAt: null,
      },
      deviceId: null,
    });

    await expect(
      caller(coachCtx).workouts.logSet(payload(session, exerciseId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('workouts.logSet — the volume window (complete.ts decision (g))', () => {
  it('recomputes the stored total when a set lands after the completion', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    await caller(client.ctx).workouts.logSet(
      payload(session, exerciseId, { setNumber: 1, reps: 10, weightKg: 80 }),
    );
    await caller(client.ctx).workouts.logSet({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      exerciseId,
      setNumber: 2,
      reps: 8,
      weightKg: 85,
      loggedAt: TAPPED_AT,
      isWarmup: false,
      isFailure: false,
    });

    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-15T10:00:00.000Z'),
    });

    const afterCompletion = await sessionRow(session.serverId);
    expect(Number(afterCompletion?.totalVolumeKg)).toBeCloseTo(10 * 80 + 8 * 85, 2);

    // The straggler: a set chained to the START, flushed after the
    // completion that is its sibling. Without the recompute the stored
    // total stays behind the rows forever.
    await caller(client.ctx).workouts.logSet({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      exerciseId,
      setNumber: 3,
      reps: 6,
      weightKg: 90,
      loggedAt: new Date('2026-08-15T09:55:00.000Z'),
      isWarmup: false,
      isFailure: false,
    });

    const afterStraggler = await sessionRow(session.serverId);
    const expected = sessionVolumeKg([
      { reps: 10, weightKg: 80, isWarmup: false },
      { reps: 8, weightKg: 85, isWarmup: false },
      { reps: 6, weightKg: 90, isWarmup: false },
    ]);
    expect(Number(afterStraggler?.totalVolumeKg)).toBeCloseTo(expected ?? 0, 2);
  });

  it('leaves the total alone while the session is still in progress', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    await caller(client.ctx).workouts.logSet(payload(session, exerciseId));

    // Computing it per set would be a sum over the whole session on every
    // tap, for a column nothing reads until completion.
    const row = await sessionRow(session.serverId);
    expect(row?.totalVolumeKg).toBeNull();
  });
});

// The Epley unit tests moved to `packages/utils/src/one-rep-max.test.ts`
// with the formula itself. They needed no Postgres and should not wait on
// a container to run.
