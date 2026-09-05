// `account-lifecycle/05` — real Postgres (`testing` skill §4): the whole
// claim under test is that `client_profiles.coach_id`'s `ON DELETE
// RESTRICT` genuinely blocks a purge until every referencing row is
// cleared, and that detachment happens via the one shared `detachClient`
// (`account-lifecycle/06`), not a second implementation.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { processCoachDeletionStep as ProcessCoachDeletionStep } from './coach-deletion-flow.ts';

const enqueuePurgeAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('../queues/enqueue.ts', () => ({
  enqueuePurgeAccount: (data: { userId: string }) => enqueuePurgeAccount(data),
}));

const sendEmail = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../lib/email/client.ts', () => ({
  sendEmail: (data: unknown) => sendEmail(data),
}));

jest.mock('../lib/storage/r2-client.ts', () => ({
  deleteR2Objects: jest.fn().mockResolvedValue(undefined),
}));

let container: StartedTestContainer;
let db: DbClient;
let processCoachDeletionStep: typeof ProcessCoachDeletionStep;
let purgeAccount: (db: DbClient, userId: string) => Promise<void>;

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

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  ({ processCoachDeletionStep } = await import('./coach-deletion-flow.ts'));
  ({ purgeAccount } = await import('./purge-account.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

beforeEach(() => {
  enqueuePurgeAccount.mockClear();
  sendEmail.mockClear();
});

let seq = 0;
async function insertUser(role: 'coach' | 'client', name = 'Fixture'): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-deletion-${seq}-${randomUUID()}@fixture.com`,
      passwordHash: 'x',
      name,
      role,
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('insertUser: users insert returned no row');
  return user.id;
}

async function insertCoach(): Promise<{ userId: string; coachProfileId: string }> {
  const userId = await insertUser('coach');
  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId })
    .returning({ id: schema.coachProfiles.id });
  if (!profile) throw new Error('insertCoach: coach_profiles insert returned no row');
  return { userId, coachProfileId: profile.id };
}

async function insertClient(coachProfileId: string, status: 'active' | 'archived' = 'active') {
  const userId = await insertUser('client');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId,
      coachId: coachProfileId,
      status,
      activatedAt: new Date(),
      archivedAt: status === 'archived' ? new Date() : undefined,
    })
    .returning({ id: schema.clientProfiles.id });
  if (!profile) throw new Error('insertClient: client_profiles insert returned no row');
  return { userId, profileId: profile.id };
}

describe('processCoachDeletionStep', () => {
  it('purges immediately for a client (not a coach)', async () => {
    const userId = await insertUser('client');

    const outcome = await processCoachDeletionStep(db, userId);

    expect(outcome).toBe('not_a_coach');
    expect(enqueuePurgeAccount).toHaveBeenCalledWith({ userId });
  });

  it('purges immediately for a coach with no clients', async () => {
    const { userId } = await insertCoach();

    const outcome = await processCoachDeletionStep(db, userId);

    expect(outcome).toBe('purged');
    expect(enqueuePurgeAccount).toHaveBeenCalledWith({ userId });
  });

  it('notifies non-archived clients and starts the window, without purging', async () => {
    const coach = await insertCoach();
    const activeClient = await insertClient(coach.coachProfileId, 'active');
    const archivedClient = await insertClient(coach.coachProfileId, 'archived');
    await db.insert(schema.deletionRequests).values({ userId: coach.userId });

    const outcome = await processCoachDeletionStep(db, coach.userId);

    expect(outcome).toBe('notified');
    expect(enqueuePurgeAccount).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [request] = await db
      .select({ coachClientsNotifiedAt: schema.deletionRequests.coachClientsNotifiedAt })
      .from(schema.deletionRequests)
      .where(eq(schema.deletionRequests.userId, coach.userId));
    expect(request?.coachClientsNotifiedAt).not.toBeNull();

    // Both clients still reference the coach — nothing detached yet.
    const [active, archived] = await Promise.all([
      db
        .select({ coachId: schema.clientProfiles.coachId })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, activeClient.profileId)),
      db
        .select({ coachId: schema.clientProfiles.coachId })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, archivedClient.profileId)),
    ]);
    expect(active[0]?.coachId).toBe(coach.coachProfileId);
    expect(archived[0]?.coachId).toBe(coach.coachProfileId);
  });

  it('waits when the window has not elapsed', async () => {
    const coach = await insertCoach();
    await insertClient(coach.coachProfileId);
    await db.insert(schema.deletionRequests).values({
      userId: coach.userId,
      coachClientsNotifiedAt: new Date(),
    });

    const outcome = await processCoachDeletionStep(db, coach.userId);

    expect(outcome).toBe('waiting');
    expect(enqueuePurgeAccount).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('detaches every referencing client (archived included) and purges once the window has elapsed', async () => {
    const coach = await insertCoach();
    const activeClient = await insertClient(coach.coachProfileId, 'active');
    const archivedClient = await insertClient(coach.coachProfileId, 'archived');
    await db.insert(schema.deletionRequests).values({
      userId: coach.userId,
      coachClientsNotifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });

    const outcome = await processCoachDeletionStep(db, coach.userId);

    expect(outcome).toBe('detached_and_purged');
    expect(enqueuePurgeAccount).toHaveBeenCalledWith({ userId: coach.userId });

    const [active, archived] = await Promise.all([
      db
        .select({
          coachId: schema.clientProfiles.coachId,
          formerCoachId: schema.clientProfiles.formerCoachId,
        })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, activeClient.profileId)),
      db
        .select({
          coachId: schema.clientProfiles.coachId,
          formerCoachId: schema.clientProfiles.formerCoachId,
        })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, archivedClient.profileId)),
    ]);
    expect(active[0]?.coachId).toBeNull();
    expect(active[0]?.formerCoachId).toBe(coach.coachProfileId);
    expect(archived[0]?.coachId).toBeNull();
    expect(archived[0]?.formerCoachId).toBe(coach.coachProfileId);
  });

  it('the RESTRICT actually blocks a direct purge, and the full flow clears it', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.coachProfileId);

    // Task 04's purge, unmodified, against a coach who still has a client —
    // the database itself must refuse this, proving RESTRICT still holds.
    await expect(purgeAccount(db, coach.userId)).rejects.toThrow();

    // Full flow: notify, then (simulating the window's passage) detach.
    await db.insert(schema.deletionRequests).values({
      userId: coach.userId,
      coachClientsNotifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    const outcome = await processCoachDeletionStep(db, coach.userId);
    expect(outcome).toBe('detached_and_purged');

    // Now the same purge task 04 already ships succeeds unmodified.
    await expect(purgeAccount(db, coach.userId)).resolves.toBeUndefined();

    const [coachRow] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, coach.userId));
    expect(coachRow).toBeUndefined();

    // Client-owned data survives (CLAUDE.md §21.3) — the row is untouched.
    const [clientRow] = await db
      .select({ id: schema.clientProfiles.id })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, client.profileId));
    expect(clientRow).toBeDefined();
  });
});
