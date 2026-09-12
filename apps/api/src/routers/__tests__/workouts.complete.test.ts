// Real Postgres (`testing` skill §4). What this file proves is exactly what
// a mock cannot: that the status transition and the volume recompute land in
// ONE transaction, that `duration_seconds` is the server's own subtraction
// and not anything the caller sent, that the `session_completion` CHECK is
// satisfied rather than tripped, and that the stored total agrees — to the
// cent — with the `packages/utils` formula the client's own card renders.
//
// That last one is the reason this suite lives in `apps/api` rather than in
// `packages/db`: this is the only package that can see BOTH
// `recomputeSessionVolume` (the SQL) and `sessionVolumeKg` (the TypeScript),
// so it is the only place the two can be held against each other.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { sessionVolumeKg } from '@coachos/utils';
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import { createTestContext } from '../../__tests__/test-context.ts';
import { completeSession } from '../../features/workouts/complete.ts';
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
const FINISHED_AT = new Date('2026-08-15T10:12:30.000Z');
/** 72 minutes 30 seconds. The number the server has to arrive at on its own. */
const EXPECTED_DURATION_S = 4_350;

interface ClientFixture {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@complete-test.com`,
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
      email: `client-${seq}@complete-test.com`,
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

/** The three fields the volume rule reads, plus the two that must not affect it. */
interface SeedSet {
  reps: number | null;
  weightKg: string | null;
  isWarmup?: boolean;
  deleted?: boolean;
}

async function insertSets(
  client: ClientFixture,
  session: SessionFixture,
  exerciseId: string,
  sets: readonly SeedSet[],
): Promise<void> {
  let setNumber = 0;
  for (const set of sets) {
    setNumber += 1;
    await db.insert(schema.setLogs).values({
      workoutSessionId: session.serverId,
      exerciseId,
      clientId: client.profileId,
      setNumber,
      reps: set.reps,
      weightKg: set.weightKg,
      isWarmup: set.isWarmup ?? false,
      clientLocalId: uuidv7(),
      deletedAt: set.deleted === true ? new Date() : null,
      // `set_has_measurement` needs one of reps/duration/distance. A set with
      // no reps carries a duration so the row is legal but contributes no
      // volume — which is the case the rule has to get right.
      durationSeconds: set.reps === null ? 45 : null,
    });
  }
}

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

async function rowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row;
}

describe('workouts.complete — the completed transition', () => {
  it('moves the session to completed and stamps the instant the device reported', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.status).toBe('completed');
    expect(result.completedAt?.getTime()).toBe(FINISHED_AT.getTime());

    const row = await rowOf(session.serverId);
    expect(row?.status).toBe('completed');
    expect(row?.completedAt?.getTime()).toBe(FINISHED_AT.getTime());
    // The `session_completion` CHECK: both timestamps present on a completed
    // row, or the write would not have been accepted at all.
    expect(row?.startedAt?.getTime()).toBe(STARTED_AT.getTime());
  });

  it('computes duration_seconds server-side from completed_at minus started_at', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.durationSeconds).toBe(EXPECTED_DURATION_S);
    expect((await rowOf(session.serverId))?.durationSeconds).toBe(EXPECTED_DURATION_S);
  });

  it('never stores a negative duration when the device clock runs backwards', async () => {
    // A phone whose clock is behind reports a finish earlier than the start
    // the same phone reported. Neither number is trustworthy enough to
    // reject the session over, and "-12 min" is not a duration.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date(STARTED_AT.getTime() - 60_000),
    });

    expect(result.durationSeconds).toBe(0);
  });

  it('refuses a duration the caller tries to supply', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    await expect(
      caller(client.ctx).workouts.complete({
        sessionClientLocalId: session.sessionClientLocalId,
        clientLocalId: uuidv7(),
        completedAt: FINISHED_AT,
        // @ts-expect-error — the whole point: the input has no such field.
        durationSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("answers NOT_YOUR_CLIENT for a key that is not this client's", async () => {
    const coachA = await insertCoach();
    const coachB = await insertCoach();
    const clientA = await insertClient(coachA);
    const clientB = await insertClient(coachB);
    const sessionB = await insertSession(clientB, coachB);

    const error = await caller(clientA.ctx)
      .workouts.complete({
        sessionClientLocalId: sessionB.sessionClientLocalId,
        clientLocalId: uuidv7(),
        completedAt: FINISHED_AT,
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(isCatalogedError(error)).toBe(true);
    expect((error as TRPCError & { cause: AppErrorCause }).cause.appCode).toBe('NOT_YOUR_CLIENT');

    // And it did not touch the other client's row on the way past.
    expect((await rowOf(sessionB.serverId))?.status).toBe('in_progress');
  });
});

describe('workouts.complete — replay and the states it must not move', () => {
  it('is a no-op on replay: the second call moves neither completed_at nor duration', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    const first = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    // A replay from the outbox an hour later, reporting a different instant
    // (a second device, a re-queued entry) must not drag the row anywhere.
    const second = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date(FINISHED_AT.getTime() + 3_600_000),
    });

    expect(second.completedAt?.getTime()).toBe(first.completedAt?.getTime());
    expect(second.durationSeconds).toBe(EXPECTED_DURATION_S);
    expect((await rowOf(session.serverId))?.completedAt?.getTime()).toBe(FINISHED_AT.getTime());
  });

  it('leaves a skipped session skipped — the coach wrote that, and this did not', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, {
      status: 'skipped',
      startedAt: null,
      skipReason: 'Client was ill',
    });

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.status).toBe('skipped');
    const row = await rowOf(session.serverId);
    expect(row?.status).toBe('skipped');
    expect(row?.completedAt).toBeNull();
  });

  it('leaves a session whose start has not landed alone rather than tripping the CHECK', async () => {
    // `started_at IS NULL` on a row moved to `completed` violates
    // `session_completion`. The completion chains to the start in the outbox,
    // so this is unreachable in the ordinary path — and the floor under it is
    // "write nothing", never "write a row the constraint refuses".
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, {
      status: 'scheduled',
      startedAt: null,
    });

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.status).toBe('scheduled');
    expect((await rowOf(session.serverId))?.completedAt).toBeNull();
  });
});

describe('workouts.complete — total_volume_kg', () => {
  it('sums weight × reps across working sets and agrees with packages/utils', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    const sets: SeedSet[] = [
      { reps: 10, weightKg: '60.00' }, // 600
      { reps: 8, weightKg: '80.50' }, // 644
      { reps: 6, weightKg: '100.25' }, // 601.5
    ];
    await insertSets(client, session, exerciseId, sets);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    // The manual sum the task's Verification step asks for.
    expect(result.totalVolumeKg).toBeCloseTo(1_845.5, 2);

    // …and the same number the client's own completed card will render, from
    // the one implementation in `packages/utils`.
    const fromUtils = sessionVolumeKg(
      sets.map((set) => ({
        reps: set.reps,
        weightKg: set.weightKg === null ? null : Number(set.weightKg),
        isWarmup: set.isWarmup ?? false,
      })),
    );
    expect(result.totalVolumeKg).toBeCloseTo(fromUtils as number, 2);
  });

  it('excludes warm-ups, soft-deleted sets, and sets missing reps or weight', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    await insertSets(client, session, exerciseId, [
      { reps: 10, weightKg: '60.00' }, // 600 — the only one that counts
      { reps: 12, weightKg: '40.00', isWarmup: true },
      { reps: 5, weightKg: '100.00', deleted: true },
      { reps: null, weightKg: '50.00' },
      { reps: 8, weightKg: null },
    ]);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.totalVolumeKg).toBeCloseTo(600, 2);
  });

  it('leaves the total null — never 0 — when no working set carries both reps and weight', async () => {
    // `COPY.md` CO§2: a stored `0` renders as "you lifted nothing", which is
    // a judgement about a bodyweight session rather than a fact about it.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    await insertSets(client, session, exerciseId, [
      { reps: 15, weightKg: null },
      { reps: 12, weightKg: '20.00', isWarmup: true },
    ]);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.totalVolumeKg).toBeNull();
    expect((await rowOf(session.serverId))?.totalVolumeKg).toBeNull();
  });

  it('counts only this session, never the neighbouring one', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const exerciseId = await insertExercise();
    const mine = await insertSession(client, coachProfileId);
    const other = await insertSession(client, coachProfileId, { scheduledDate: '2026-08-16' });

    await insertSets(client, mine, exerciseId, [{ reps: 10, weightKg: '50.00' }]); // 500
    await insertSets(client, other, exerciseId, [{ reps: 10, weightKg: '999.00' }]);

    const result = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: mine.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(result.totalVolumeKg).toBeCloseTo(500, 2);
  });

  it('corrects the total on a replay that arrives after a late set log', async () => {
    // The completion chains to the session START, not to the sets — so the
    // sets are siblings and may still be in flight when it lands
    // (`lib/outbox/enqueue.ts` rule 4, and this task's Approach step 2). A
    // replay is the one moment the server gets to look again, so it does.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const exerciseId = await insertExercise();

    await insertSets(client, session, exerciseId, [{ reps: 10, weightKg: '50.00' }]);
    const first = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });
    expect(first.totalVolumeKg).toBeCloseTo(500, 2);

    // The last set finally syncs, after the completion did.
    await db.insert(schema.setLogs).values({
      workoutSessionId: session.serverId,
      exerciseId,
      clientId: client.profileId,
      setNumber: 99,
      reps: 10,
      weightKg: '30.00',
      clientLocalId: uuidv7(),
    });

    const second = await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      completedAt: FINISHED_AT,
    });

    expect(second.totalVolumeKg).toBeCloseTo(800, 2);
    // …and it corrected the aggregate without moving the transition.
    expect(second.completedAt?.getTime()).toBe(FINISHED_AT.getTime());
  });

  it('rolls the status transition back when the volume recompute fails', async () => {
    // DB§8.2's whole guarantee: it must be impossible to mark a session
    // completed and not compute its volume. Proved by breaking the second
    // half and watching the first half disappear with it — which is why
    // `completeSession` takes the recompute as a parameter at all.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    await expect(
      completeSession(
        db,
        client.profileId,
        {
          sessionClientLocalId: session.sessionClientLocalId,
          clientLocalId: uuidv7(),
          completedAt: FINISHED_AT,
        },
        () => Promise.reject(new Error('volume recompute exploded')),
      ),
    ).rejects.toThrow('volume recompute exploded');

    const row = await rowOf(session.serverId);
    expect(row?.status).toBe('in_progress');
    expect(row?.completedAt).toBeNull();
  });
});
