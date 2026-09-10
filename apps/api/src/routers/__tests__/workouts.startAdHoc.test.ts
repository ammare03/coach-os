// Real Postgres (`testing` skill §4) — the idempotency this file proves is
// a property of the `sessions_client_local` unique index, and an in-memory
// stand-in cannot have one.
//
// `phase-09-workout-logger/today-card/04`'s Verification: an ad-hoc session
// syncs with null `assignment_id`/`program_day_id`, and a retried outbox
// entry produces one row rather than a second workout (`CLAUDE.md` §25.12).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { toLocalDate } from '@coachos/utils';
import { and, eq } from 'drizzle-orm';
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
      email: `coach-${seq}@adhoc-test.com`,
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
      email: `client-${seq}@adhoc-test.com`,
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

/** What the device sends: its own key, its own local day, and the tap instant. */
function input(overrides: Partial<{ clientLocalId: string; scheduledDate: string }> = {}) {
  const startedAt = new Date('2026-08-14T19:00:00.000Z');
  return {
    clientLocalId: uuidv7(),
    scheduledDate: toLocalDate(startedAt, 'Asia/Kolkata'),
    startedAt,
    ...overrides,
  };
}

async function rowsFor(clientProfileId: string) {
  return db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.clientId, clientProfileId));
}

describe('workouts.startAdHoc', () => {
  it('creates a session with no assignment and no program day', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);

    const created = await caller(client.ctx).workouts.startAdHoc(input());

    const rows = await rowsFor(client.profileId);
    expect(rows).toHaveLength(1);
    // DB§5.2's own comment: both columns are nullable precisely so this row
    // can exist.
    expect(rows[0]?.assignmentId).toBeNull();
    expect(rows[0]?.programDayId).toBeNull();
    expect(rows[0]?.id).toBe(created.id);
  });

  it('is born in_progress with the device’s own instant, never the server’s', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sent = input();

    const created = await caller(client.ctx).workouts.startAdHoc(sent);

    expect(created.status).toBe('in_progress');
    // `offline-sync` §10: a session logged in a basement at 19:00 must not
    // be timestamped at whatever hour the signal came back.
    expect(created.startedAt?.getTime()).toBe(sent.startedAt.getTime());
  });

  it('stores the client-local calendar day the device computed', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    // 19:00 UTC on the 14th is already the 15th in Kolkata (`CLAUDE.md` §25.5).
    const sent = input();
    expect(sent.scheduledDate).toBe('2026-08-15');

    const created = await caller(client.ctx).workouts.startAdHoc(sent);

    expect(created.scheduledDate).toBe('2026-08-15');
  });

  it('denormalises the coach for `ownsResource` (DB§6)', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);

    await caller(client.ctx).workouts.startAdHoc(input());

    const rows = await rowsFor(client.profileId);
    expect(rows[0]?.coachId).toBe(coachProfileId);
  });

  it('works for a client with no coach at all', async () => {
    // The detached state (`account-lifecycle/06`) — frame `E`'s coachless
    // variant is the loudest entry point into this flow, so it must not be
    // the one that throws.
    const client = await insertClient(null);

    const created = await caller(client.ctx).workouts.startAdHoc(input());

    const rows = await rowsFor(client.profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.coachId).toBeNull();
    expect(created.status).toBe('in_progress');
  });

  it('is idempotent — a retried outbox entry returns the same row, not a second workout', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sent = input();

    const first = await caller(client.ctx).workouts.startAdHoc(sent);
    const second = await caller(client.ctx).workouts.startAdHoc(sent);
    const third = await caller(client.ctx).workouts.startAdHoc(sent);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(await rowsFor(client.profileId)).toHaveLength(1);
  });

  it('replays concurrently without a duplicate — the index resolves the race, not the resolver', async () => {
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);
    const sent = input();

    const results = await Promise.all([
      caller(client.ctx).workouts.startAdHoc(sent),
      caller(client.ctx).workouts.startAdHoc(sent),
      caller(client.ctx).workouts.startAdHoc(sent),
    ]);

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await rowsFor(client.profileId)).toHaveLength(1);
  });

  it('keys idempotency per client, so two devices’ keys can never collide across accounts', async () => {
    const coachProfileId = await insertCoach();
    const first = await insertClient(coachProfileId);
    const second = await insertClient(coachProfileId);
    const shared = input();

    const a = await caller(first.ctx).workouts.startAdHoc(shared);
    const b = await caller(second.ctx).workouts.startAdHoc(shared);

    // `sessions_client_local` is compound on (client_id, client_local_id):
    // the key is only unique within one client's own mutation stream.
    expect(a.id).not.toBe(b.id);
    expect(await rowsFor(first.profileId)).toHaveLength(1);
    expect(await rowsFor(second.profileId)).toHaveLength(1);
  });

  it('lets one client hold two ad-hoc sessions on the same day', async () => {
    // Frame `C`'s "Log another workout" — a client who finishes and trains
    // again is not an error, and no `sessions_client_day_unique` applies
    // because that index is partial on a non-null `program_day_id`.
    const coachProfileId = await insertCoach();
    const client = await insertClient(coachProfileId);

    await caller(client.ctx).workouts.startAdHoc(input());
    await caller(client.ctx).workouts.startAdHoc(input());

    expect(await rowsFor(client.profileId)).toHaveLength(2);
  });

  it('never writes a session for anyone but the caller', async () => {
    const coachProfileId = await insertCoach();
    const mine = await insertClient(coachProfileId);
    const theirs = await insertClient(coachProfileId);

    await caller(mine.ctx).workouts.startAdHoc(input());

    // The input carries no `clientId`, so there is nothing to point
    // elsewhere — asserted rather than assumed (`api-conventions` §3).
    expect(await rowsFor(theirs.profileId)).toHaveLength(0);
    const soft = await db
      .select()
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.clientId, mine.profileId),
          eq(schema.workoutSessions.status, 'in_progress'),
        ),
      );
    expect(soft).toHaveLength(1);
  });

  it('is registered on the router the outbox replays against', () => {
    expect(Object.keys(appRouter._def.procedures)).toContain('workouts.startAdHoc');
  });
});
