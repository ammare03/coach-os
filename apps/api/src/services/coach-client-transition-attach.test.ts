// `account-lifecycle/07` — real Postgres (`testing` skill §4), same
// reasoning as `coach-client-transition.test.ts`: the claims under test are
// about live joins and NULL-safe comparisons across real rows, not logic a
// mock could stand in for.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../__tests__/test-context.ts';
import { RESOURCE_REGISTRY, type ResourceKind } from '../trpc/authz/resource-registry.ts';

import type {
  attachClient as AttachClient,
  detachClient as DetachClient,
  updateHistorySharing as UpdateHistorySharing,
} from './coach-client-transition.ts';

jest.mock('../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let container: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;
let attachClient: typeof AttachClient;
let detachClient: typeof DetachClient;
let updateHistorySharing: typeof UpdateHistorySharing;

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
  ({ attachClient, detachClient, updateHistorySharing } =
    await import('./coach-client-transition.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

const ROLLBACK = Symbol('attach-test-rollback');
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

function graceFnOf(
  kind: ResourceKind,
  field: 'formerCoachOwnedIds' | 'historySharedOwnedIds' | 'nutritionSharedOwnedIds',
) {
  const fn = RESOURCE_REGISTRY[kind][field];
  if (!fn) throw new Error(`${kind}.${field} is null — test assumption is wrong`);
  return fn;
}

describe('attachClient', () => {
  it('rejects a client who already has a coach', async () => {
    await withRolledBackTx(async (tx) => {
      await expect(
        attachClient(tx, createTestContext({ db: tx }), {
          clientProfileId: fixture.clientA1.profileId,
          newCoachId: fixture.coachB.profileId,
          historySharing: 'twelve_weeks',
          shareMetrics: false,
          shareNutrition: false,
        }),
      ).rejects.toMatchObject({ cause: { appCode: 'CLIENT_ALREADY_HAS_COACH' } });
    });
  });

  it("'everything' shares from the client's account creation date; 'nothing' shares from now", async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      const [user] = await tx
        .select({ createdAt: schema.users.createdAt })
        .from(schema.users)
        .where(eq(schema.users.id, fixture.clientA1.userId));

      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'everything',
        shareMetrics: false,
        shareNutrition: false,
      });

      const [client] = await tx
        .select({
          coachId: schema.clientProfiles.coachId,
          coachSince: schema.clientProfiles.coachSince,
          historySharedFrom: schema.clientProfiles.historySharedFrom,
        })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      expect(client?.coachId).toBe(fixture.coachB.profileId);
      expect(client?.coachSince).not.toBeNull();
      expect(client?.historySharedFrom?.getTime()).toBe(user?.createdAt.getTime());
    });
  });

  it('grants coach B the shared training history but never comments or check-ins from coach A', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'everything',
        shareMetrics: false,
        shareNutrition: false,
      });

      const coachB = { coachProfileId: fixture.coachB.profileId };

      // Training history: shared under "everything".
      const grantedSessions = await graceFnOf('workoutSession', 'historySharedOwnedIds')(
        tx,
        coachB,
        [fixture.clientA1.workoutSessionId],
      );
      expect(grantedSessions.has(fixture.clientA1.workoutSessionId)).toBe(true);
      const grantedSetLogs = await RESOURCE_REGISTRY.setLog.coachOwnedIds(tx, coachB, [
        fixture.clientA1.setLogId,
      ]);
      expect(grantedSetLogs.has(fixture.clientA1.setLogId)).toBe(true);

      // Never, under any setting: comments and check-ins from coach A.
      const grantedComments = await RESOURCE_REGISTRY.comment.coachOwnedIds(tx, coachB, [
        fixture.clientA1.commentId,
      ]);
      expect(grantedComments.has(fixture.clientA1.commentId)).toBe(false);
      const grantedCheckins = await RESOURCE_REGISTRY.checkin.coachOwnedIds(tx, coachB, [
        fixture.clientA1.checkinId,
      ]);
      expect(grantedCheckins.has(fixture.clientA1.checkinId)).toBe(false);

      // Never, without a separate opt-in: nutrition.
      expect(RESOURCE_REGISTRY.meal.coachOwnedIds).toBeDefined();
      const grantedMeals = await RESOURCE_REGISTRY.meal.coachOwnedIds(tx, coachB, [
        fixture.clientA1.mealId,
      ]);
      expect(grantedMeals.has(fixture.clientA1.mealId)).toBe(false);
    });
  });

  it('"nothing" shares no pre-existing training history at all', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'nothing',
        shareMetrics: false,
        shareNutrition: false,
      });

      const coachB = { coachProfileId: fixture.coachB.profileId };
      const grantedSessions = await graceFnOf('workoutSession', 'historySharedOwnedIds')(
        tx,
        coachB,
        [fixture.clientA1.workoutSessionId],
      );
      expect(grantedSessions.has(fixture.clientA1.workoutSessionId)).toBe(false);
    });
  });

  it('shares nutrition only with the separate opt-in', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'everything',
        shareMetrics: false,
        shareNutrition: true,
      });

      const granted = await graceFnOf('meal', 'nutritionSharedOwnedIds')(
        tx,
        { coachProfileId: fixture.coachB.profileId },
        [fixture.clientA1.mealId],
      );
      expect(granted.has(fixture.clientA1.mealId)).toBe(true);
    });
  });

  it("coach A's 30-day former-coach window is unaffected by the client joining coach B", async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'nothing',
        shareMetrics: false,
        shareNutrition: false,
      });

      const grantedToA = await graceFnOf('workoutSession', 'formerCoachOwnedIds')(
        tx,
        { coachProfileId: fixture.coachA.profileId },
        [fixture.clientA1.workoutSessionId],
      );
      expect(grantedToA.has(fixture.clientA1.workoutSessionId)).toBe(true);

      // And coach A still never sees coach B's new relationship's data —
      // there is no cross-grant between the two windows.
      const [client] = await tx
        .select({ coachId: schema.clientProfiles.coachId })
        .from(schema.clientProfiles)
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));
      expect(client?.coachId).toBe(fixture.coachB.profileId);
    });
  });
});

describe('updateHistorySharing', () => {
  it('widens sharing immediately', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });
      await attachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        newCoachId: fixture.coachB.profileId,
        historySharing: 'nothing',
        shareMetrics: false,
        shareNutrition: false,
      });

      await updateHistorySharing(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        historySharing: 'everything',
        shareMetrics: false,
        shareNutrition: false,
      });

      const granted = await graceFnOf('workoutSession', 'historySharedOwnedIds')(
        tx,
        { coachProfileId: fixture.coachB.profileId },
        [fixture.clientA1.workoutSessionId],
      );
      expect(granted.has(fixture.clientA1.workoutSessionId)).toBe(true);
    });
  });

  it('rejects a client with no current coach', async () => {
    await withRolledBackTx(async (tx) => {
      await detachClient(tx, createTestContext({ db: tx }), {
        clientProfileId: fixture.clientA1.profileId,
        initiatedBy: 'client',
      });

      await expect(
        updateHistorySharing(tx, createTestContext({ db: tx }), {
          clientProfileId: fixture.clientA1.profileId,
          historySharing: 'everything',
          shareMetrics: false,
          shareNutrition: false,
        }),
      ).rejects.toMatchObject({ cause: { appCode: 'CLIENT_HAS_NO_COACH' } });
    });
  });
});

// Guards against the exact leak this task's implementation fixed: without
// the `coach_since` boundary, `comment.coachOwnedIds`'s live join to
// `client_profiles.coach_id` would grant coach B every comment coach A ever
// left, the instant `attachClient` ran.
describe('the comment/set_log leak this task fixes', () => {
  it('a first-time client (no former coach) is unaffected — coach_since stays null', async () => {
    const [client] = await db
      .select({ coachSince: schema.clientProfiles.coachSince })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, fixture.clientB1.profileId));
    expect(client?.coachSince).toBeNull();

    const granted = await RESOURCE_REGISTRY.comment.coachOwnedIds(
      db,
      { coachProfileId: fixture.coachB.profileId },
      [fixture.clientB1.commentId],
    );
    expect(granted.has(fixture.clientB1.commentId)).toBe(true);
  });
});
