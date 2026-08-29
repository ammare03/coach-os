// `account-lifecycle/06` — real Postgres (`testing` skill §4): the whole
// point of this task is a foreign-key-and-trigger-shaped guarantee (never
// delete, respect the guard trigger's bypass, keep DB§6's fast path from
// going stale) that a mocked Drizzle client cannot prove.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { count, eq, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../__tests__/test-context.ts';
import { RESOURCE_REGISTRY, type ResourceKind } from '../trpc/authz/resource-registry.ts';

import type { detachClient as DetachClient } from './coach-client-transition.ts';

jest.mock('../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let container: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;
let detachClient: typeof DetachClient;

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
  fixture = await createTwoCoachesFixture(db);
  ({ detachClient } = await import('./coach-client-transition.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

// Same isolation shape as `authz.test.ts`'s own `withRolledBackTx`: one
// shared fixture, every test's writes rolled back so tests never depend on
// ordering or leave the next one a half-detached client.
const ROLLBACK = Symbol('coach-client-transition-test-rollback');
async function withRolledBackTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as unknown as DbClient);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return out as T;
}

// `RESOURCE_REGISTRY[kind].formerCoachOwnedIds` is `| null` by design (a
// kind the grace window structurally cannot reach) — this test only ever
// calls it for kinds it has just asserted are grace-eligible, so a `null`
// here is a real failure, not a case to silently narrow past.
function graceFnOf(kind: ResourceKind) {
  const fn = RESOURCE_REGISTRY[kind].formerCoachOwnedIds;
  if (!fn) throw new Error(`${kind} has no formerCoachOwnedIds — test assumption is wrong`);
  return fn;
}

async function totalRowCount(tx: DbClient): Promise<number> {
  // Every schema this project has built, summed — the same "zero rows
  // deleted" proof `purge-account.test.ts` uses for its own irreversible
  // operation, adapted to prove the opposite claim: this one deletes
  // nothing at all, ever.
  const tables = [
    schema.users,
    schema.coachProfiles,
    schema.clientProfiles,
    schema.programs,
    schema.assignments,
    schema.workoutSessions,
    schema.setLogs,
    schema.exercises,
    schema.meals,
    schema.mediaAssets,
    schema.comments,
    schema.checkins,
    schema.liveSessions,
    schema.coachClientNotes,
    schema.invites,
  ];
  let total = 0;
  for (const table of tables) {
    const [row] = await tx.select({ value: count() }).from(table);
    total += row?.value ?? 0;
  }
  return total;
}

describe('detachClient', () => {
  it('nulls coach_id, records former_coach_id/detached_at, and deletes nothing', async () => {
    await withRolledBackTx(async (tx) => {
      const before = await totalRowCount(tx);

      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      expect(await totalRowCount(tx)).toBe(before);

      const [client] = await tx
        .select({
          coachId: schema.clientProfiles.coachId,
          formerCoachId: schema.clientProfiles.formerCoachId,
          detachedAt: schema.clientProfiles.detachedAt,
          status: schema.clientProfiles.status,
        })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      expect(client?.coachId).toBeNull();
      expect(client?.formerCoachId).toBe(fixture.coachA.profileId);
      expect(client?.detachedAt).not.toBeNull();
      // A real, valid, coachless state — never re-statused by this transition.
      expect(client?.status).toBe('active');
    });
  });

  it('never touches a sibling client of the same coach', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      const [sibling] = await tx
        .select({ coachId: schema.clientProfiles.coachId })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, fixture.clientA2.profileId));
      expect(sibling?.coachId).toBe(fixture.coachA.profileId);

      const [siblingSession] = await tx
        .select({ coachId: schema.workoutSessions.coachId })
        .from(schema.workoutSessions)
        .where(eq(schema.workoutSessions.id, fixture.clientA2.workoutSessionId));
      expect(siblingSession?.coachId).toBe(fixture.coachA.profileId);
    });
  });

  it('grants the former coach a 30-day window on training history, comments, and checkins — never meals', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      const coach = { coachProfileId: fixture.coachA.profileId };
      const grantedSessions = await graceFnOf('workoutSession')(tx, coach, [
        fixture.clientA1.workoutSessionId,
      ]);
      expect(grantedSessions.has(fixture.clientA1.workoutSessionId)).toBe(true);

      const grantedComments = await graceFnOf('comment')(tx, coach, [fixture.clientA1.commentId]);
      expect(grantedComments.has(fixture.clientA1.commentId)).toBe(true);

      const grantedCheckins = await graceFnOf('checkin')(tx, coach, [fixture.clientA1.checkinId]);
      expect(grantedCheckins.has(fixture.clientA1.checkinId)).toBe(true);

      // Nutrition is excluded outright — no grace function even exists for it.
      expect(RESOURCE_REGISTRY.meal.formerCoachOwnedIds).toBeNull();

      // And the fast path a departed coach might otherwise still match on
      // must actually be gone — this is the whole reason detachClient nulls
      // meals.coach_id rather than leaving it stale.
      const [meal] = await tx
        .select({ coachId: schema.meals.coachId })
        .from(schema.meals)
        .where(eq(schema.meals.id, fixture.clientA1.mealId));
      expect(meal?.coachId).toBeNull();
    });
  });

  it('never grants the former coach access to a progress photo, even inside the window', async () => {
    await withRolledBackTx(async (tx) => {
      const [photoAsset] = await tx
        .insert(schema.mediaAssets)
        .values({
          ownerUserId: fixture.clientA1.userId,
          coachId: fixture.coachA.profileId,
          clientId: fixture.clientA1.profileId,
          kind: 'image',
          storageKey: `test/${fixture.clientA1.profileId}/photo-1`,
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        })
        .returning({ id: schema.mediaAssets.id });
      if (!photoAsset) throw new Error('test setup: media_assets insert did not return a row');
      await tx.insert(schema.progressPhotos).values({
        clientId: fixture.clientA1.profileId,
        assetId: photoAsset.id,
        angle: 'front',
        takenAt: new Date(),
      });

      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      const granted = await graceFnOf('mediaAsset')(
        tx,
        { coachProfileId: fixture.coachA.profileId },
        [photoAsset.id, fixture.clientA1.mediaAssetId],
      );
      expect(granted.has(photoAsset.id)).toBe(false);
      // The client's ordinary form-check video, not a progress photo, keeps
      // the window — proves the exclusion is specific, not a blanket denial.
      expect(granted.has(fixture.clientA1.mediaAssetId)).toBe(true);
    });
  });

  it('marks the active assignment completed without deleting it', async () => {
    await withRolledBackTx(async (tx) => {
      const [program] = await tx
        .select({ id: schema.programs.id })
        .from(schema.programs)
        .where(eq(schema.programs.coachId, fixture.coachA.profileId));
      if (!program) throw new Error('test setup: fixture program not found');
      await tx.insert(schema.assignments).values({
        programId: program.id,
        clientId: fixture.clientA1.profileId,
        coachId: fixture.coachA.profileId,
        startDate: '2026-08-01',
        status: 'active',
      });

      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      const [assignment] = await tx
        .select({ status: schema.assignments.status, completedAt: schema.assignments.completedAt })
        .from(schema.assignments)
        .where(eq(schema.assignments.clientId, fixture.clientA1.profileId));
      expect(assignment?.status).toBe('completed');
      expect(assignment?.completedAt).not.toBeNull();
    });
  });

  it('rejects a client with no current coach', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      await expect(
        detachClient(tx, createTestContext({ db: tx }), {
          clientProfileId: fixture.clientA1.profileId,
          initiatedBy: 'client',
        }),
      ).rejects.toMatchObject({ cause: { appCode: 'CLIENT_HAS_NO_COACH' } });
    });
  });

  it('the grace window expires after 30 days', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await tx
        .update(schema.clientProfiles)
        .set({ detachedAt: sql`now() - interval '31 days'` })
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      const granted = await graceFnOf('workoutSession')(
        tx,
        { coachProfileId: fixture.coachA.profileId },
        [fixture.clientA1.workoutSessionId],
      );
      expect(granted.has(fixture.clientA1.workoutSessionId)).toBe(false);
    });
  });
});
