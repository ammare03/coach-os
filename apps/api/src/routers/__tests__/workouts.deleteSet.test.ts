// Real Postgres (`testing` skill §4). What this file proves is exactly what
// a mock cannot: that the withdrawal is a SOFT delete the partial index
// `set_logs_client_exercise` is already built around, that replaying it
// answers identically rather than erroring, that a set the caller does not
// own is untouched by a statement pinned to `ctx.user.clientProfileId`, that
// `total_volume_kg` comes back into agreement with the rows that survive,
// and that a `logSet` flushed afterwards cannot bring the row back.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { sessionVolumeKg } from '@coachos/utils';
import type { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
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
/** The tap that logged the set. Deliberately far from `now()`. */
const TAPPED_AT = new Date('2026-08-15T09:14:22.000Z');
/** The moment the undo window closed, five seconds after the delete tap. */
const WITHDRAWN_AT = new Date('2026-08-15T09:20:31.000Z');

interface ClientFixture {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@deleteset-test.com`,
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
      email: `client-${seq}@deleteset-test.com`,
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
function logPayload(
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

/** The payload the outbox flushes once the undo window closes untouched. */
function deletePayload(session: SessionFixture, setClientLocalId: string) {
  return {
    sessionClientLocalId: session.sessionClientLocalId,
    clientLocalId: setClientLocalId,
    deletedAt: WITHDRAWN_AT,
  };
}

/** A live session with one 10 × 80kg set already logged into it. */
async function loggedSet(overrides: Partial<typeof schema.workoutSessions.$inferInsert> = {}) {
  const coachProfileId = await insertCoach();
  const client = await insertClient(coachProfileId);
  const session = await insertSession(client, coachProfileId, overrides);
  const exerciseId = await insertExercise();
  const input = logPayload(session, exerciseId);
  const set = await caller(client.ctx).workouts.logSet(input);
  return { coachProfileId, client, session, exerciseId, input, set };
}

describe('workouts.deleteSet — the withdrawal', () => {
  it('soft-deletes the row with the device instant, and does not remove it', async () => {
    const { client, session, input } = await loggedSet();

    const result = await caller(client.ctx).workouts.deleteSet(
      deletePayload(session, input.clientLocalId),
    );

    expect(result).toMatchObject({ outcome: 'deleted', workoutSessionId: session.serverId });

    const rows = await setsOf(client.profileId, input.clientLocalId);
    // The row survives — `deleted_at` is set, not the row removed. A hard
    // DELETE would take it out from under `personal_records.set_log_id`.
    expect(rows).toHaveLength(1);
    // Not `now()`. The undo window closed at 09:20 whether the phone had
    // signal then or hours later (`offline-sync` §10).
    expect(rows[0]?.deletedAt).toEqual(WITHDRAWN_AT);
    expect(rows[0]?.reps).toBe(10);
  });

  it('drops the set out of the partial index that answers "last time"', async () => {
    const { client, session, exerciseId, input } = await loggedSet();

    await caller(client.ctx).workouts.deleteSet(deletePayload(session, input.clientLocalId));

    // The shape of "last time you did this exercise" (DB§22's cookbook),
    // whose index `set_logs_client_exercise` is partial on
    // `deleted_at IS NULL` (DB§5.2). The withdrawal has to disappear from
    // it without that read growing a predicate of its own.
    const lastTime = await db
      .select({ id: schema.setLogs.id })
      .from(schema.setLogs)
      .where(
        and(
          eq(schema.setLogs.clientId, client.profileId),
          eq(schema.setLogs.exerciseId, exerciseId),
          isNull(schema.setLogs.deletedAt),
        ),
      )
      .orderBy(desc(schema.setLogs.loggedAt));
    expect(lastTime).toHaveLength(0);

    // And the row itself is still there — soft, not removed.
    expect(await setsOf(client.profileId, input.clientLocalId)).toHaveLength(1);
  });
});

describe('workouts.deleteSet — idempotency (decision (d))', () => {
  it('answers identically when the outbox replays the same withdrawal', async () => {
    const { client, session, input } = await loggedSet();
    const payload = deletePayload(session, input.clientLocalId);

    const first = await caller(client.ctx).workouts.deleteSet(payload);
    const second = await caller(client.ctx).workouts.deleteSet(payload);
    const third = await caller(client.ctx).workouts.deleteSet(payload);

    // An already-deleted set succeeds quietly. Erroring here would burn all
    // ten outbox attempts and surface "couldn't sync" for a withdrawal the
    // server already agrees with (`offline-sync` §10).
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await setsOf(client.profileId, input.clientLocalId)).toHaveLength(1);
  });

  it('succeeds without throwing when the set does not exist at all', async () => {
    const { client, session } = await loggedSet();

    // The device committed locally and queued this; the row never reached
    // the server, or was purged. Either way the postcondition — "that set
    // is not in your log" — already holds, so this is not a failure.
    const result = await caller(client.ctx).workouts.deleteSet(deletePayload(session, uuidv7()));

    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('creates no divergence when two flushes race the same withdrawal', async () => {
    const { client, session, input } = await loggedSet();
    const payload = deletePayload(session, input.clientLocalId);

    // Foreground and a connectivity event firing together (`offline-sync` §4).
    const [a, b] = await Promise.all([
      caller(client.ctx).workouts.deleteSet(payload),
      caller(client.ctx).workouts.deleteSet(payload),
    ]);

    expect(a).toEqual(b);
    const rows = await setsOf(client.profileId, input.clientLocalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toEqual(WITHDRAWN_AT);
  });
});

describe('workouts.deleteSet — authorisation (decision (b))', () => {
  it("leaves another client's set untouched when its key is sent", async () => {
    const coachA = await insertCoach();
    const clientA = await insertClient(coachA);
    const sessionA = await insertSession(clientA, coachA);

    const victim = await loggedSet();

    // Client A names their OWN session — which resolves — but client B's
    // set key. The UPDATE is pinned to A's `client_id`, so B's row is not
    // reachable by it even in principle.
    const result = await caller(clientA.ctx).workouts.deleteSet(
      deletePayload(sessionA, victim.input.clientLocalId),
    );

    expect(result).toEqual({ outcome: 'not_found' });

    const rows = await setsOf(victim.client.profileId, victim.input.clientLocalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toBeNull();
  });

  it("refuses a session key belonging to another coach's client", async () => {
    const coachA = await insertCoach();
    const clientA = await insertClient(coachA);

    const victim = await loggedSet();

    const error = await caller(clientA.ctx)
      .workouts.deleteSet(deletePayload(victim.session, victim.input.clientLocalId))
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(isCatalogedError(error)).toBe(true);
    // `NOT_FOUND`, never `FORBIDDEN` — anything finer is an existence
    // oracle (`ERRORS.md` ER§2.1).
    expect((error as TRPCError & { cause: AppErrorCause }).code).toBe('NOT_FOUND');
    expect((error as TRPCError & { cause: AppErrorCause }).cause.appCode).toBe('NOT_YOUR_CLIENT');

    const rows = await setsOf(victim.client.profileId, victim.input.clientLocalId);
    expect(rows[0]?.deletedAt).toBeNull();
  });

  it('refuses a session key that names nothing at all', async () => {
    const { client } = await loggedSet();

    await expect(
      caller(client.ctx).workouts.deleteSet(
        deletePayload({ serverId: uuidv7(), sessionClientLocalId: uuidv7() }, uuidv7()),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("rejects a coach outright — withdrawing is the client's own act", async () => {
    const { coachProfileId, session, input } = await loggedSet();

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
        deletedAt: null,
      },
      deviceId: null,
    });

    await expect(
      caller(coachCtx).workouts.deleteSet(deletePayload(session, input.clientLocalId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('workouts.deleteSet — the derived total (decision (e))', () => {
  it('re-totals a completed session so the volume matches the surviving sets', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const kept = logPayload(session, exerciseId, { setNumber: 1, reps: 10, weightKg: 80 });
    const withdrawn = logPayload(session, exerciseId, { setNumber: 2, reps: 8, weightKg: 85 });
    await caller(client.ctx).workouts.logSet(kept);
    await caller(client.ctx).workouts.logSet(withdrawn);

    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-15T10:00:00.000Z'),
    });

    const afterCompletion = await sessionRow(session.serverId);
    expect(Number(afterCompletion?.totalVolumeKg)).toBeCloseTo(10 * 80 + 8 * 85, 2);

    await caller(client.ctx).workouts.deleteSet(deletePayload(session, withdrawn.clientLocalId));

    // Without the recompute the stored total would keep counting work the
    // client says they did not do — silently, on the coach's screen.
    const afterWithdrawal = await sessionRow(session.serverId);
    const expected = sessionVolumeKg([{ reps: 10, weightKg: 80, isWarmup: false }]);
    expect(Number(afterWithdrawal?.totalVolumeKg)).toBeCloseTo(expected ?? 0, 2);
  });

  it('leaves the total null when the last working set of a session is withdrawn', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const only = logPayload(session, exerciseId);
    await caller(client.ctx).workouts.logSet(only);
    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-15T10:00:00.000Z'),
    });

    await caller(client.ctx).workouts.deleteSet(deletePayload(session, only.clientLocalId));

    // Null, never `0`. "You lifted nothing" is a judgement about the
    // session rather than a fact about it (`COPY.md` CO§2, and
    // `recomputeSessionVolume` decision (b)).
    const row = await sessionRow(session.serverId);
    expect(row?.totalVolumeKg).toBeNull();
  });

  it('leaves the total alone while the session is still in progress', async () => {
    const { client, session, input } = await loggedSet();

    await caller(client.ctx).workouts.deleteSet(deletePayload(session, input.clientLocalId));

    // Nothing reads the column until completion, and `workouts.complete`
    // sums the surviving rows anyway — `log-set.ts` decision (e) unchanged.
    const row = await sessionRow(session.serverId);
    expect(row?.totalVolumeKg).toBeNull();
  });
});

describe('workouts.deleteSet — the withdrawal is final', () => {
  it('is not undone by a logSet for the same key flushing afterwards', async () => {
    const { client, session, input } = await loggedSet();

    await caller(client.ctx).workouts.deleteSet(deletePayload(session, input.clientLocalId));

    // The original log, or an edit of it, re-sent after the delete —
    // reachable whenever a retry outlives the chain. `logSet` omits
    // `deleted_at` from its upsert payload precisely so this cannot
    // resurrect the row (`log-set.ts` decision (f)).
    const replayed = await caller(client.ctx).workouts.logSet(input);
    expect(replayed.clientLocalId).toBe(input.clientLocalId);

    const rows = await setsOf(client.profileId, input.clientLocalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).toEqual(WITHDRAWN_AT);
  });

  it('keeps a withdrawn set out of a completion that runs after it', async () => {
    const { client, session, exerciseId, input } = await loggedSet();

    const kept = logPayload(session, exerciseId, { setNumber: 2, reps: 5, weightKg: 100 });
    await caller(client.ctx).workouts.logSet(kept);
    await caller(client.ctx).workouts.deleteSet(deletePayload(session, input.clientLocalId));

    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-15T10:00:00.000Z'),
    });

    const row = await sessionRow(session.serverId);
    const expected = sessionVolumeKg([{ reps: 5, weightKg: 100, isWarmup: false }]);
    expect(Number(row?.totalVolumeKg)).toBeCloseTo(expected ?? 0, 2);
  });
});
