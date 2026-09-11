// Real Postgres (`testing` skill §4) — the guarantees this file proves are
// properties of the UPDATE itself (which statuses it may move, which it must
// leave alone) and of `ownsResource`'s lookup, and neither survives a mock.
//
// `phase-09-workout-logger/session-runtime/01`'s Verification: reconnect
// after starting a session offline and the server row reads `in_progress`
// with the right `started_at`; a retried outbox entry changes nothing.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import { createTestContext } from '../../__tests__/test-context.ts';
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

interface ClientFixture {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@start-test.com`,
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
      email: `client-${seq}@start-test.com`,
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
  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

/** The row `lib/materialise-sessions.ts` puts on the device before the signal goes. */
async function insertScheduledSession(
  client: ClientFixture,
  coachProfileId: string | null,
  overrides: Partial<typeof schema.workoutSessions.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: client.profileId,
      coachId: coachProfileId,
      assignmentId: null,
      programDayId: null,
      scheduledDate: '2026-08-15',
      status: 'scheduled',
      // Deterministic in production (DB§14.5); any stable value here.
      clientLocalId: uuidv7(),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return row.id;
}

/** What the device sends: the row it is transitioning, its own mutation key, the tap. */
function input(workoutSessionId: string, startedAt = new Date('2026-08-14T19:00:00.000Z')) {
  return { workoutSessionId, clientLocalId: uuidv7(), startedAt };
}

async function rowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row;
}

describe('workouts.start', () => {
  it('moves a scheduled session to in_progress', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId);
    const sent = input(sessionId);

    const result = await caller(client.ctx).workouts.start(sent);

    expect(result.status).toBe('in_progress');
    expect((await rowOf(sessionId))?.status).toBe('in_progress');
  });

  it('stores the device’s own instant, never the server’s', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId);
    const sent = input(sessionId);

    const result = await caller(client.ctx).workouts.start(sent);

    // `offline-sync` §10: a session started in a basement at 19:00 must not
    // be timestamped at whatever hour the signal came back.
    expect(result.startedAt?.getTime()).toBe(sent.startedAt.getTime());
    expect((await rowOf(sessionId))?.startedAt?.getTime()).toBe(sent.startedAt.getTime());
  });

  it('leaves the prescription alone — this is a transition, not a write', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId, { name: 'Push A' });

    await caller(client.ctx).workouts.start(input(sessionId));

    const row = await rowOf(sessionId);
    expect(row?.name).toBe('Push A');
    expect(row?.scheduledDate).toBe('2026-08-15');
    expect(row?.coachId).toBe(coachProfileId);
  });

  it('is idempotent — a retried outbox entry does not move started_at', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId);
    const sent = input(sessionId);

    const first = await caller(client.ctx).workouts.start(sent);
    const second = await caller(client.ctx).workouts.start({
      ...sent,
      startedAt: new Date('2026-08-14T21:00:00.000Z'),
    });

    expect(second.id).toBe(first.id);
    expect(second.startedAt?.getTime()).toBe(sent.startedAt.getTime());
    expect((await rowOf(sessionId))?.startedAt?.getTime()).toBe(sent.startedAt.getTime());
  });

  it('replays concurrently to one consistent answer', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId);
    const sent = input(sessionId);

    const results = await Promise.all([
      caller(client.ctx).workouts.start(sent),
      caller(client.ctx).workouts.start(sent),
      caller(client.ctx).workouts.start(sent),
    ]);

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(new Set(results.map((row) => row.startedAt?.getTime())).size).toBe(1);
    expect((await rowOf(sessionId))?.status).toBe('in_progress');
  });

  it('never un-completes a finished session', async () => {
    // The device chains completion to the start, so a start arriving after a
    // completion is only ever a replay — and reverting on a replay is the
    // double-apply `CLAUDE.md` §25.12 warns about.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const completedAt = new Date('2026-08-14T20:00:00.000Z');
    const sessionId = await insertScheduledSession(client, coachProfileId, {
      status: 'completed',
      startedAt: new Date('2026-08-14T19:00:00.000Z'),
      completedAt,
    });

    const result = await caller(client.ctx).workouts.start(input(sessionId));

    expect(result.status).toBe('completed');
    const row = await rowOf(sessionId);
    expect(row?.status).toBe('completed');
    expect(row?.completedAt?.getTime()).toBe(completedAt.getTime());
  });

  it('leaves a skipped session skipped rather than dropping the reason', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId, {
      status: 'skipped',
      skipReason: 'travelling',
    });

    const result = await caller(client.ctx).workouts.start(input(sessionId));

    // Moving it to in_progress would leave the row carrying a skip reason it
    // contradicts. The device learns the truth on the next prefetch.
    expect(result.status).toBe('skipped');
    expect((await rowOf(sessionId))?.skipReason).toBe('travelling');
  });

  it('refuses another client’s session', async () => {
    const coachProfileId = await insertCoach();
    const mine = await insertClient(coachProfileId);
    const theirs = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(theirs, coachProfileId);

    await expect(caller(mine.ctx).workouts.start(input(sessionId))).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
    expect((await rowOf(sessionId))?.status).toBe('scheduled');
  });

  it('refuses a session that does not exist', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);

    // NOT_FOUND-shaped, never a 403 — a 403 would confirm the row exists
    // (`ERRORS.md` ER§2.1).
    await expect(caller(client.ctx).workouts.start(input(uuidv7()))).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
  });

  it('refuses a soft-deleted session', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sessionId = await insertScheduledSession(client, coachProfileId, {
      deletedAt: new Date(),
    });

    await expect(caller(client.ctx).workouts.start(input(sessionId))).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
  });

  it('is registered on the router the outbox replays against', () => {
    expect(Object.keys(appRouter._def.procedures)).toContain('workouts.start');
  });
});
