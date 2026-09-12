// Real Postgres (`testing` skill §4). What a mock could not prove: that the
// UPDATE is scoped to the caller's own `client_id` and therefore cannot
// reach another client's session however the key is chosen, that a cleared
// field really writes NULL rather than being skipped, and that the
// `smallint` column takes the value the device sent unrounded.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
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
const FINISHED_AT = new Date('2026-08-15T10:12:30.000Z');

interface ClientFixture {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@update-notes-test.com`,
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
      email: `client-${seq}@update-notes-test.com`,
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
      status: 'completed',
      startedAt: STARTED_AT,
      completedAt: FINISHED_AT,
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

async function rowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row;
}

const SKIP_LINE = 'Skipped: Leg press — equipment unavailable (machine was taken)';

describe('workouts.updateNotes — the two subjective fields', () => {
  it('writes both fields onto the session the client names', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);

    const result = await caller(client.ctx).workouts.updateNotes({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      perceivedExertion: 7,
      clientNotes: `${SKIP_LINE}\n\nKnee felt tight on the last two sets.`,
    });

    expect(result.perceivedExertion).toBe(7);
    expect(result.clientNotes).toContain(SKIP_LINE);

    const row = await rowOf(session.serverId);
    expect(row?.perceivedExertion).toBe(7);
    expect(row?.clientNotes).toContain('Knee felt tight on the last two sets.');
  });

  it('writes NULL for a field the client cleared, rather than leaving the old value', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, {
      perceivedExertion: 9,
      clientNotes: 'an earlier note',
    });

    await caller(client.ctx).workouts.updateNotes({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      perceivedExertion: null,
      clientNotes: null,
    });

    const row = await rowOf(session.serverId);
    expect(row?.perceivedExertion).toBeNull();
    expect(row?.clientNotes).toBeNull();
  });

  it('is idempotent on replay — the same payload twice leaves the same two values', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId);
    const payload = {
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      perceivedExertion: 6,
      clientNotes: SKIP_LINE,
    };

    const first = await caller(client.ctx).workouts.updateNotes(payload);
    const second = await caller(client.ctx).workouts.updateNotes(payload);

    expect(second).toEqual(first);
  });

  it('touches nothing else on the row — status, instants and volume are not this procedure’s', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, {
      durationSeconds: 4_350,
      totalVolumeKg: '4280.00',
    });

    await caller(client.ctx).workouts.updateNotes({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      perceivedExertion: 8,
      clientNotes: null,
    });

    const row = await rowOf(session.serverId);
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).toEqual(FINISHED_AT);
    expect(row?.durationSeconds).toBe(4_350);
    expect(row?.totalVolumeKg).toBe('4280.00');
  });

  it('accepts a session that has not been completed yet', async () => {
    // The capture is chained behind the completion in the outbox, but a
    // session whose row carried no `complete_outbox_id` queues the update
    // UNCHAINED (`useUpdateSessionNotes` rule (d)), so it can legitimately
    // arrive first. Refusing it here would strand a note over an ordering
    // detail the client has nothing to do with.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, {
      status: 'in_progress',
      completedAt: null,
    });

    await caller(client.ctx).workouts.updateNotes({
      sessionClientLocalId: session.sessionClientLocalId,
      clientLocalId: uuidv7(),
      perceivedExertion: 5,
      clientNotes: SKIP_LINE,
    });

    const row = await rowOf(session.serverId);
    expect(row?.perceivedExertion).toBe(5);
    expect(row?.status).toBe('in_progress');
  });

  it("refuses another client's session with NOT_YOUR_CLIENT, and writes nothing", async () => {
    const coachProfileId = await insertCoach();
    const mine = await insertClient(coachProfileId);
    const theirs = await insertClient(coachProfileId);
    const theirSession = await insertSession(theirs, coachProfileId, {
      perceivedExertion: 3,
      clientNotes: 'their words',
    });

    // The two clients share a coach, so the only thing standing between them
    // is the `client_id` predicate. That is exactly the leak §6.2 exists to
    // prevent.
    const error = await caller(mine.ctx)
      .workouts.updateNotes({
        sessionClientLocalId: theirSession.sessionClientLocalId,
        clientLocalId: uuidv7(),
        perceivedExertion: 10,
        clientNotes: 'mine',
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(isCatalogedError(error)).toBe(true);
    expect((error as TRPCError & { cause: AppErrorCause }).cause.appCode).toBe('NOT_YOUR_CLIENT');

    const row = await rowOf(theirSession.serverId);
    expect(row?.perceivedExertion).toBe(3);
    expect(row?.clientNotes).toBe('their words');
  });

  it('answers NOT_YOUR_CLIENT for a session key nothing holds', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);

    const error = await caller(client.ctx)
      .workouts.updateNotes({
        sessionClientLocalId: uuidv7(),
        clientLocalId: uuidv7(),
        perceivedExertion: null,
        clientNotes: 'orphan',
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(isCatalogedError(error)).toBe(true);
    expect((error as TRPCError & { cause: AppErrorCause }).cause.appCode).toBe('NOT_YOUR_CLIENT');
  });

  it('will not touch a soft-deleted session', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const session = await insertSession(client, coachProfileId, { deletedAt: new Date() });

    await expect(
      caller(client.ctx).workouts.updateNotes({
        sessionClientLocalId: session.sessionClientLocalId,
        clientLocalId: uuidv7(),
        perceivedExertion: 4,
        clientNotes: null,
      }),
    ).rejects.toThrow();

    const row = await rowOf(session.serverId);
    expect(row?.perceivedExertion).toBeNull();
  });
});
