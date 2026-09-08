// Real Postgres, real migrated schema (`testing` skill §4). This test is
// about the interaction of three things that only exist in a real database:
// the PARTIAL `sessions_client_local` index, the `session_completion` /
// `session_skip_reason` CHECK constraints, and migration 0021's
// `touch_updated_at` trigger. A mock proves none of them.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { upsertWorkoutSession, type WorkoutSessionUpsertValues } from './workout-session-upsert.ts';

let container: StartedTestContainer;
let db: DbClient;

let coachProfileId: string;
let clientProfileId: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // Subprocess, matching `offline-upsert.test.ts` — `migrate.ts` reads
  // `import.meta.url`, which ts-jest's CommonJS transpile cannot execute.
  const migrateScript = path.join(
    __dirname,
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

  const [coachUser] = await db
    .insert(schema.users)
    .values({
      email: `coach-${randomUUID()}@lww.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
    })
    .returning();
  if (!coachUser) throw new Error('fixture: users insert returned no row');

  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: coachUser.id })
    .returning();
  if (!coachProfile) throw new Error('fixture: coach_profiles insert returned no row');
  coachProfileId = coachProfile.id;

  const [clientUser] = await db
    .insert(schema.users)
    .values({
      email: `client-${randomUUID()}@lww.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
    })
    .returning();
  if (!clientUser) throw new Error('fixture: users insert returned no row');

  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: clientUser.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
    })
    .returning();
  if (!clientProfile) throw new Error('fixture: client_profiles insert returned no row');
  clientProfileId = clientProfile.id;
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

const HOUR_MS = 60 * 60 * 1000;

/**
 * The server's own clock, not the test process's. The API host and the
 * database are NTP-synced in production, but a testcontainer's clock runs
 * inside the Docker VM and can sit either side of the Windows host's — and
 * every assertion below turns on an ordering of timestamps. Reading `now()`
 * from the same clock the `touch_updated_at` trigger reads removes that as
 * a source of flake entirely.
 */
async function dbNow(): Promise<Date> {
  // Epoch milliseconds as text, not a timestamptz: `db.execute` hands back
  // the driver's raw row, where a timestamp arrives as a Postgres-formatted
  // string with microsecond precision that `new Date()` does not parse
  // reliably. An integer has one reading.
  const result: unknown = await db.execute(
    sql`SELECT (extract(epoch from now()) * 1000)::bigint::text AS now_ms`,
  );
  if (!Array.isArray(result)) throw new Error('dbNow: expected a row list');
  const [row] = result;
  if (typeof row !== 'object' || row === null || !('now_ms' in row)) {
    throw new Error('dbNow: expected a "now_ms" column');
  }
  const { now_ms: nowMs } = row as { now_ms: unknown };
  if (typeof nowMs !== 'string') throw new Error('dbNow: "now_ms" was not text');
  return new Date(Number(nowMs));
}

type SessionRow = typeof schema.workoutSessions.$inferSelect;

/** A session as the device first created it, with a controlled `updated_at`. */
async function seedSession(updatedAt: Date): Promise<string> {
  const clientLocalId = randomUUID();
  await upsertWorkoutSession(db, {
    clientId: clientProfileId,
    coachId: coachProfileId,
    scheduledDate: '2026-09-10',
    clientLocalId,
    status: 'scheduled',
    updatedAt,
  });
  return clientLocalId;
}

async function readSession(clientLocalId: string): Promise<SessionRow> {
  const rows = await db
    .select()
    .from(schema.workoutSessions)
    .where(
      and(
        eq(schema.workoutSessions.clientId, clientProfileId),
        eq(schema.workoutSessions.clientLocalId, clientLocalId),
      ),
    );
  const [row] = rows;
  if (rows.length !== 1 || !row) {
    throw new Error(`expected exactly one session row, found ${String(rows.length)}`);
  }
  return row;
}

/** The device's "I finished this" write. `completed` needs both timestamps (`session_completion`). */
function deviceCompleted(clientLocalId: string, updatedAt: Date): WorkoutSessionUpsertValues {
  return {
    clientId: clientProfileId,
    coachId: coachProfileId,
    scheduledDate: '2026-09-10',
    clientLocalId,
    status: 'completed',
    startedAt: new Date(updatedAt.getTime() - HOUR_MS),
    completedAt: updatedAt,
    updatedAt,
  };
}

/** The live coach's "they didn't train" write. `skipped` needs a reason (`session_skip_reason`). */
function coachSkipped(clientLocalId: string, updatedAt: Date): WorkoutSessionUpsertValues {
  return {
    clientId: clientProfileId,
    coachId: coachProfileId,
    scheduledDate: '2026-09-10',
    clientLocalId,
    status: 'skipped',
    skipReason: 'Client called in sick',
    updatedAt,
  };
}

describe('upsertWorkoutSession — status is last-write-wins by updated_at (DB§14.3)', () => {
  it('stores the payload as given when no row exists yet', async () => {
    const at = new Date(Date.now() - 3 * HOUR_MS);
    const clientLocalId = await seedSession(at);

    const row = await readSession(clientLocalId);
    expect(row.status).toBe('scheduled');
    // No BEFORE INSERT trigger, so the insert path keeps the device's own
    // change time — this is what makes the first comparison meaningful.
    expect(row.updatedAt).toEqual(at);
  });

  it('applies a status change whose updatedAt is newer than the stored row', async () => {
    const clientLocalId = await seedSession(new Date(Date.now() - 3 * HOUR_MS));

    await upsertWorkoutSession(db, deviceCompleted(clientLocalId, new Date(Date.now() - HOUR_MS)));

    expect((await readSession(clientLocalId)).status).toBe('completed');
  });

  it('discards a status change whose updatedAt is older than the stored row', async () => {
    const clientLocalId = await seedSession(await dbNow());

    // Captured on the device two hours ago and flushed only now.
    await upsertWorkoutSession(
      db,
      deviceCompleted(clientLocalId, new Date(Date.now() - 2 * HOUR_MS)),
    );

    expect((await readSession(clientLocalId)).status).toBe('scheduled');
  });

  it('still applies the other fields of a write whose status lost — device-wins (DB§14.3 row one)', async () => {
    const clientLocalId = await seedSession(await dbNow());

    await upsertWorkoutSession(db, {
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-09-10',
      clientLocalId,
      status: 'completed',
      startedAt: new Date(Date.now() - 3 * HOUR_MS),
      completedAt: new Date(Date.now() - 2 * HOUR_MS),
      clientNotes: 'Felt heavy, dropped the last set',
      perceivedExertion: 8,
      updatedAt: new Date(Date.now() - 2 * HOUR_MS),
    });

    const row = await readSession(clientLocalId);
    expect(row.status).toBe('scheduled');
    expect(row.clientNotes).toBe('Felt heavy, dropped the last set');
    expect(row.perceivedExertion).toBe(8);
  });

  it('leaves the status untouched when the same payload is replayed', async () => {
    const clientLocalId = await seedSession(new Date(Date.now() - 3 * HOUR_MS));
    const write = deviceCompleted(clientLocalId, new Date(Date.now() - HOUR_MS));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await upsertWorkoutSession(db, write);
    }

    // Equal timestamps are not "newer", so replays after the first are a
    // no-op on status — DB§14.1's ten-identical-responses rule, for the one
    // column that does not simply overwrite.
    expect((await readSession(clientLocalId)).status).toBe('completed');
  });
});

describe('upsertWorkoutSession — both arrival orders (the task Verification)', () => {
  // A device change captured while offline, and a live coach change made
  // later in real time. The coach is online, so their write's `updated_at`
  // is the server's own clock at the moment they make it — which is what
  // makes it chronologically later in both orders below.

  it('the later write wins when it arrives second', async () => {
    const clientLocalId = await seedSession(new Date(Date.now() - 3 * HOUR_MS));

    await upsertWorkoutSession(db, deviceCompleted(clientLocalId, new Date(Date.now() - HOUR_MS)));
    await upsertWorkoutSession(db, coachSkipped(clientLocalId, await dbNow()));

    expect((await readSession(clientLocalId)).status).toBe('skipped');
  });

  it('the later write wins when it arrives first', async () => {
    const clientLocalId = await seedSession(new Date(Date.now() - 3 * HOUR_MS));

    await upsertWorkoutSession(db, coachSkipped(clientLocalId, await dbNow()));
    await upsertWorkoutSession(db, deviceCompleted(clientLocalId, new Date(Date.now() - HOUR_MS)));

    expect((await readSession(clientLocalId)).status).toBe('skipped');
  });
});

describe('upsertWorkoutSession — two genuinely concurrent writers', () => {
  it('resolves to the later-timestamped status, and to exactly one row', async () => {
    const clientLocalId = await seedSession(new Date(Date.now() - 3 * HOUR_MS));
    const later = new Date((await dbNow()).getTime() + HOUR_MS);

    // Both statements race for the same conflicting row. Whichever Postgres
    // serialises first, the second re-evaluates its CASE against the row it
    // just locked — not against a snapshot read before the race, which is
    // what a read-then-write would compare and why this is one statement.
    // The margin is an hour so the assertion cannot turn on the interleaving.
    await Promise.all([
      upsertWorkoutSession(db, deviceCompleted(clientLocalId, new Date(Date.now() - 2 * HOUR_MS))),
      upsertWorkoutSession(db, coachSkipped(clientLocalId, later)),
    ]);

    expect((await readSession(clientLocalId)).status).toBe('skipped');
  });
});

describe("upsertWorkoutSession — migration 0021's touch_updated_at trigger", () => {
  it('overwrites the device timestamp on the conflict path, so updated_at reads as server time', async () => {
    const seededAt = new Date(Date.now() - 3 * HOUR_MS);
    const clientLocalId = await seedSession(seededAt);
    expect((await readSession(clientLocalId)).updatedAt).toEqual(seededAt);

    const deviceAt = new Date(Date.now() - HOUR_MS);
    await upsertWorkoutSession(db, deviceCompleted(clientLocalId, deviceAt));

    // `BEFORE UPDATE ... NEW.updated_at = now()` is unconditional, so the
    // stored column is "when the server last wrote this row", never "when
    // the device made the change". The comparison still works because
    // `excluded.updated_at` is the proposed insert's value, which the
    // trigger never sees. The consequence is documented at the module.
    const row = await readSession(clientLocalId);
    expect(row.updatedAt).not.toEqual(deviceAt);
    expect(row.updatedAt.getTime()).toBeGreaterThan(deviceAt.getTime());
  });
});
