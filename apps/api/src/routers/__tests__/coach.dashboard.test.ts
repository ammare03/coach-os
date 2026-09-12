// Real Postgres (`testing` skill §4). The assertion this suite exists for is
// the query count: §8.2's acceptance criterion is "computed server-side in
// one query, not N+1", and the natural-looking wrong implementation — a
// per-client adherence call in a loop — is correct, readable, and fails that
// criterion the moment a coach has thirty clients. Nothing but a counted
// query can catch it, so the count is asserted at 100-client scale and
// against a 2-client coach in the same run: equal counts are the property,
// not a low number.
//
// Located here rather than at `apps/api/src/routers/coach.test.ts` (the path
// `adherence-engine/02`'s Files table names) to match every other procedure
// test in the repo.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import {
  NEEDS_REVIEW_CAP,
  checkinsDueQuery,
  clientOverviewQuery,
  needsReviewQuery,
} from '../../features/coach/dashboard.ts';
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
  await seedWorld();
  // Without fresh statistics the planner still believes every table is
  // empty and picks a plan that flatters the EXPLAIN assertions below
  // (`exercises.search.test.ts` establishes the same precaution).
  await db.execute(sql`ANALYZE`);
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

// ---------------------------------------------------------------------------
// The seed, and the reference the counters are checked against
// ---------------------------------------------------------------------------

/**
 * One client's intended shape. The expectations below are computed from
 * these plans rather than from a second query, so the test's reference is
 * independent of the implementation it checks — a shared query would agree
 * with a wrong resolver.
 */
interface ClientPlan {
  index: number;
  profileId: string;
  status: 'invited' | 'active' | 'paused' | 'archived';
  scheduledSessions: number;
  completedSessions: number;
  /** `null` when the client logged no food at all in the window. */
  nutritionScore: number | null;
  /** Completed sessions the coach has not opened — DB§22 branch 1. */
  unreviewedSessions: number;
  /** Ready, undeleted, uncommented videos — DB§22 branch 2. */
  unreviewedVideos: number;
  hasPendingCheckin: boolean;
  hasSubmittedCheckin: boolean;
}

interface CoachWorld {
  profileId: string;
  ctx: Context;
  plans: ClientPlan[];
}

let coachA: CoachWorld;
let coachB: CoachWorld;

let seq = 0;

async function insertCoach(label: string): Promise<{ profileId: string; ctx: Context }> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${label}-${seq}@dashboard-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${label}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');

  const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');

  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: 'coach',
    timezone: user.timezone,
    locale: user.locale,
    isMinor: user.isMinor,
    guardianConsentAt: user.guardianConsentAt,
    coachProfileId: profile.id,
    clientProfileId: null,
    deletionScheduledFor: null,
    deletedAt: null,
  };

  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

/** `current_date - offset`, as the `date` literal the schema's columns take. */
function dayOffset(offset: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - offset);
  const iso = at.toISOString().slice(0, 10);
  return iso;
}

/**
 * Ten shapes, repeated ten times, so every branch the resolver has to get
 * right appears at 100-client scale rather than once:
 *
 * | bucket | roster | training | nutrition | overall | colour |
 * |---|---|---|---|---|---|
 * | 0,1,2 | active | 100% | 95 | 98 | green |
 * | 3,4 | active | 80% | 80 | 80 | amber |
 * | 5,6 | active | 50% | 60 | 54 | **red** |
 * | 7 | active | 0% | none | 0 | **red** |
 * | 8 | active/invited | none | none | null | grey — never off-track |
 * | 9 | paused/archived | — | — | — | off the roster entirely |
 */
function planFor(index: number): Omit<ClientPlan, 'profileId'> {
  const bucket = index % 10;

  const shape = ((): Pick<
    ClientPlan,
    'status' | 'scheduledSessions' | 'completedSessions' | 'nutritionScore'
  > => {
    if (bucket <= 2) {
      return { status: 'active', scheduledSessions: 3, completedSessions: 3, nutritionScore: 95 };
    }
    if (bucket <= 4) {
      return { status: 'active', scheduledSessions: 5, completedSessions: 4, nutritionScore: 80 };
    }
    if (bucket <= 6) {
      return { status: 'active', scheduledSessions: 4, completedSessions: 2, nutritionScore: 60 };
    }
    if (bucket === 7) {
      return { status: 'active', scheduledSessions: 3, completedSessions: 0, nutritionScore: null };
    }
    if (bucket === 8) {
      return {
        // Half of the no-data bucket is still on an invite, proving an
        // invited client is on the roster (`client_profiles_active_seats`)
        // and still not off-track.
        status: index % 20 === 8 ? 'invited' : 'active',
        scheduledSessions: 0,
        completedSessions: 0,
        nutritionScore: null,
      };
    }
    return {
      status: index < 50 ? 'paused' : 'archived',
      scheduledSessions: 2,
      completedSessions: 1,
      nutritionScore: 40,
    };
  })();

  return {
    index,
    ...shape,
    // A quarter of the book has work the coach has not opened.
    unreviewedSessions: index % 4 === 0 ? shape.completedSessions : 0,
    unreviewedVideos: index % 10 === 0 ? 1 : 0,
    hasPendingCheckin: index % 7 === 0,
    hasSubmittedCheckin: index % 11 === 0,
  };
}

async function insertClient(
  coachProfileId: string,
  label: string,
  plan: Omit<ClientPlan, 'profileId'>,
): Promise<ClientPlan> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${label}-${seq}@dashboard-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${label} ${String(plan.index).padStart(3, '0')}`,
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');

  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: coachProfileId,
      status: plan.status,
      // `client_status_timestamps`: an active row needs `activated_at`, an
      // archived one needs `archived_at`.
      activatedAt: plan.status === 'invited' ? null : new Date(),
      archivedAt: plan.status === 'archived' ? new Date() : null,
      pausedAt: plan.status === 'paused' ? new Date() : null,
    })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  const clientId = profile.id;

  if (plan.scheduledSessions > 0) {
    const reviewedAt = plan.unreviewedSessions > 0 ? null : new Date();
    await db.insert(schema.workoutSessions).values(
      Array.from({ length: plan.scheduledSessions }, (_, i) => {
        const completed = i < plan.completedSessions;
        return {
          clientId,
          coachId: coachProfileId,
          scheduledDate: dayOffset(i),
          status: completed ? ('completed' as const) : ('scheduled' as const),
          // `session_completion` CHECK: a completed session carries both.
          startedAt: completed ? new Date() : null,
          completedAt: completed ? new Date() : null,
          reviewedAt: completed ? reviewedAt : null,
        };
      }),
    );
  }

  if (plan.nutritionScore !== null) {
    // Three identical daily scores, so the view's `avg()` is exactly the
    // score and the expectation needs no floating-point tolerance.
    await db.insert(schema.dailyNutritionSummary).values(
      [1, 2, 3].map((offset) => ({
        clientId,
        date: dayOffset(offset),
        adherenceScore: plan.nutritionScore === null ? null : plan.nutritionScore.toFixed(1),
        mealsLogged: 3,
      })),
    );
  }

  if (plan.unreviewedVideos > 0) {
    await db.insert(schema.mediaAssets).values({
      ownerUserId: user.id,
      coachId: coachProfileId,
      clientId,
      kind: 'video',
      storageKey: `dashboard-test/${label}/${String(plan.index)}/unreviewed`,
      mimeType: 'video/mp4',
      sizeBytes: 2048,
      processingStatus: 'ready',
    });
  }

  // Three negative controls for DB§22's video branch, so the count proves
  // the filters rather than the join: a ready video that already has a
  // comment, one still processing, and one soft-deleted. None may count.
  if (plan.index % 10 === 1) {
    const [commented] = await db
      .insert(schema.mediaAssets)
      .values({
        ownerUserId: user.id,
        coachId: coachProfileId,
        clientId,
        kind: 'video',
        storageKey: `dashboard-test/${label}/${String(plan.index)}/commented`,
        mimeType: 'video/mp4',
        sizeBytes: 2048,
        processingStatus: 'ready',
      })
      .returning();
    if (!commented) throw new Error('seed insert into media_assets did not return a row');
    await db.insert(schema.comments).values({
      authorUserId: user.id,
      targetType: 'media_asset',
      targetId: commented.id,
      clientId,
      body: 'Already reviewed',
    });
  }
  if (plan.index % 10 === 2) {
    await db.insert(schema.mediaAssets).values({
      ownerUserId: user.id,
      coachId: coachProfileId,
      clientId,
      kind: 'video',
      storageKey: `dashboard-test/${label}/${String(plan.index)}/processing`,
      mimeType: 'video/mp4',
      sizeBytes: 2048,
      processingStatus: 'processing',
    });
  }
  if (plan.index % 10 === 3) {
    await db.insert(schema.mediaAssets).values({
      ownerUserId: user.id,
      coachId: coachProfileId,
      clientId,
      kind: 'video',
      storageKey: `dashboard-test/${label}/${String(plan.index)}/deleted`,
      mimeType: 'video/mp4',
      sizeBytes: 2048,
      processingStatus: 'ready',
      deletedAt: new Date(),
    });
  }

  const checkins: (typeof schema.checkins.$inferInsert)[] = [];
  if (plan.hasPendingCheckin) {
    checkins.push({
      clientId,
      coachId: coachProfileId,
      templateSnapshot: {},
      periodStart: dayOffset(6),
      periodEnd: dayOffset(0),
      status: 'pending',
    });
  }
  if (plan.hasSubmittedCheckin) {
    checkins.push({
      clientId,
      coachId: coachProfileId,
      templateSnapshot: {},
      periodStart: dayOffset(13),
      periodEnd: dayOffset(7),
      status: 'submitted',
      submittedAt: new Date(),
    });
  }
  // A reviewed check-in is due to nobody, and a missed one is not a task —
  // neither may reach either counter.
  checkins.push({
    clientId,
    coachId: coachProfileId,
    templateSnapshot: {},
    periodStart: dayOffset(20),
    periodEnd: dayOffset(14),
    status: 'reviewed',
    submittedAt: new Date(),
    reviewedAt: new Date(),
  });
  await db.insert(schema.checkins).values(checkins);

  return { ...plan, profileId: clientId };
}

/**
 * Ten thousand clients belonging to ten other coaches, plus their sessions,
 * check-ins, videos, comments, and daily summaries.
 *
 * Without this the EXPLAIN assertions below are decorative: at a hundred
 * clients every table this query touches fits in three pages, and a
 * sequential scan of three pages genuinely *is* the cheaper plan — the
 * planner would be wrong to use an index, and a test asserting it does
 * would only be asserting that the tables are tiny. §5.8's rule is about
 * tables over 10k rows, so the check has to be run against one.
 *
 * Set-based inserts rather than 80,000 round trips: this is the difference
 * between ten seconds and ten minutes.
 */
async function seedOtherCoachesAtScale(): Promise<void> {
  await db.execute(sql`
    INSERT INTO identity.users (email, password_hash, name, role, timezone)
    SELECT format('filler-coach-%s@dashboard-test.com', g), 'x', 'Filler Coach', 'coach', 'UTC'
      FROM generate_series(1, 10) g
  `);
  await db.execute(sql`
    INSERT INTO identity.coach_profiles (user_id)
    SELECT id FROM identity.users WHERE email LIKE 'filler-coach-%'
  `);
  await db.execute(sql`
    INSERT INTO identity.users (email, password_hash, name, role, timezone)
    SELECT format('filler-client-%s@dashboard-test.com', g), 'x', format('Filler %s', g), 'client', 'UTC'
      FROM generate_series(1, 10000) g
  `);
  await db.execute(sql`
    WITH coaches AS (
      SELECT cp.id, row_number() OVER (ORDER BY cp.id) - 1 AS n
        FROM identity.coach_profiles cp
        JOIN identity.users cu ON cu.id = cp.user_id
       WHERE cu.email LIKE 'filler-coach-%'
    ), clients AS (
      SELECT u.id AS user_id, row_number() OVER (ORDER BY u.id) - 1 AS n
        FROM identity.users u WHERE u.email LIKE 'filler-client-%'
    )
    INSERT INTO identity.client_profiles (user_id, coach_id, status, activated_at)
    SELECT c.user_id, co.id, 'active', now()
      FROM clients c JOIN coaches co ON co.n = c.n % 10
  `);

  // Every filler row is somebody else's, and every one is already handled
  // (reviewed session, commented video, reviewed check-in) — volume that
  // must not move a single counter.
  await db.execute(sql`
    INSERT INTO training.workout_sessions
      (client_id, coach_id, scheduled_date, status, started_at, completed_at, reviewed_at)
    SELECT cp.id, cp.coach_id, current_date - (g % 30), 'completed', now(), now(), now()
      FROM identity.client_profiles cp
      JOIN identity.users u ON u.id = cp.user_id AND u.email LIKE 'filler-client-%'
      CROSS JOIN generate_series(1, 2) g
  `);
  await db.execute(sql`
    INSERT INTO coaching.checkins
      (client_id, coach_id, template_snapshot, period_start, period_end, status, submitted_at, reviewed_at)
    SELECT cp.id, cp.coach_id, '{}'::jsonb, current_date - (7 * g), current_date - (7 * g) + 6,
           'reviewed', now(), now()
      FROM identity.client_profiles cp
      JOIN identity.users u ON u.id = cp.user_id AND u.email LIKE 'filler-client-%'
      CROSS JOIN generate_series(1, 2) g
  `);
  await db.execute(sql`
    INSERT INTO coaching.media_assets
      (owner_user_id, coach_id, client_id, kind, storage_key, mime_type, size_bytes, processing_status)
    SELECT u.id, cp.coach_id, cp.id, 'video', format('filler/%s', cp.id), 'video/mp4', 1024, 'ready'
      FROM identity.client_profiles cp
      JOIN identity.users u ON u.id = cp.user_id AND u.email LIKE 'filler-client-%'
  `);
  await db.execute(sql`
    INSERT INTO coaching.comments (author_user_id, target_type, target_id, client_id, body)
    SELECT ma.owner_user_id, 'media_asset', ma.id, ma.client_id, 'filler'
      FROM coaching.media_assets ma WHERE ma.storage_key LIKE 'filler/%'
  `);
  await db.execute(sql`
    INSERT INTO nutrition.daily_nutrition_summary (client_id, date, adherence_score, meals_logged)
    SELECT cp.id, current_date - g, 80.0, 3
      FROM identity.client_profiles cp
      JOIN identity.users u ON u.id = cp.user_id AND u.email LIKE 'filler-client-%'
      CROSS JOIN generate_series(1, 3) g
  `);
  await db.execute(sql`
    INSERT INTO coaching.body_metrics (client_id, recorded_at, recorded_date, weight_kg)
    SELECT cp.id, now() - (g || ' days')::interval, current_date - g, 80.00
      FROM identity.client_profiles cp
      JOIN identity.users u ON u.id = cp.user_id AND u.email LIKE 'filler-client-%'
      CROSS JOIN generate_series(1, 2) g
  `);
}

async function seedWorld(): Promise<void> {
  const a = await insertCoach('a');
  const aPlans: ClientPlan[] = [];
  for (let index = 0; index < 100; index += 1) {
    aPlans.push(await insertClient(a.profileId, 'a', planFor(index)));
  }
  coachA = { ...a, plans: aPlans };

  // A second coach, small enough that every counter has an exact,
  // uncapped reference — and present at all so the scoping assertions have
  // somebody else's data to fail to see.
  const b = await insertCoach('b');
  const bPlans: ClientPlan[] = [];
  for (let index = 0; index < 2; index += 1) {
    bPlans.push(
      await insertClient(b.profileId, 'b', {
        index,
        status: 'active',
        scheduledSessions: 4,
        completedSessions: 2,
        nutritionScore: null,
        unreviewedSessions: 2,
        unreviewedVideos: 1,
        hasPendingCheckin: true,
        hasSubmittedCheckin: false,
      }),
    );
  }
  coachB = { ...b, plans: bPlans };

  await seedOtherCoachesAtScale();
}

const ROSTER_STATUSES = new Set(['active', 'invited']);

/** DB§22's three branches, summed from the seed plans — not from a query. */
function expectedNeedsReview(plans: readonly ClientPlan[]): number {
  const raw = plans.reduce(
    (total, plan) =>
      total + plan.unreviewedSessions + plan.unreviewedVideos + (plan.hasSubmittedCheckin ? 1 : 0),
    0,
  );
  return Math.min(raw, NEEDS_REVIEW_CAP);
}

function expectedCheckinsDue(plans: readonly ClientPlan[]): number {
  return plans.filter((plan) => plan.hasPendingCheckin).length;
}

function expectedRoster(plans: readonly ClientPlan[]): ClientPlan[] {
  return plans.filter((plan) => ROSTER_STATUSES.has(plan.status));
}

/** `0.6 * training + 0.4 * nutrition`, weighting only the side that exists. */
function expectedOverall(plan: ClientPlan): number | null {
  const training =
    plan.scheduledSessions > 0 ? (plan.completedSessions / plan.scheduledSessions) * 100 : null;
  if (training === null && plan.nutritionScore === null) return null;
  if (plan.nutritionScore === null) return training;
  if (training === null) return plan.nutritionScore;
  return 0.6 * training + 0.4 * plan.nutritionScore;
}

function expectedOffTrack(plans: readonly ClientPlan[]): number {
  return expectedRoster(plans).filter((plan) => {
    const overall = expectedOverall(plan);
    return overall !== null && overall < 70;
  }).length;
}

// ---------------------------------------------------------------------------
// The counting proxy
// ---------------------------------------------------------------------------

/**
 * `db.select` and friends are overloaded, and TypeScript cannot express a
 * wrapper that keeps a set of overloads — so each replacement is asserted
 * back to the method's own type. Narrowing to exactly what it replaces,
 * never widening to `any`.
 */
function countedMethod<TKey extends keyof DbClient>(
  real: DbClient,
  key: TKey,
  onCall: () => void,
): DbClient[TKey] {
  const original = real[key];
  if (typeof original !== 'function') throw new Error(`db.${String(key)} is not a method`);
  const call = original.bind(real) as (...args: unknown[]) => unknown;
  return ((...args: unknown[]) => {
    onCall();
    return call(...args);
  }) as DbClient[TKey];
}

/**
 * Counts statements *started* on the client, which is what "one query, not
 * N+1" is a claim about — an implementation that loops over clients calls
 * `select` once per client whatever the wire protocol does with it.
 *
 * `Object.create` rather than `new Proxy`: everything not listed (`$client`,
 * the relational `query` builder) is still reached through the prototype
 * chain unchanged, and the shadowing is explicit rather than a trap that has
 * to decide what to do with every property access.
 */
function countingDb(real: DbClient): { db: DbClient; queries: () => number } {
  let queries = 0;
  const onCall = (): void => {
    queries += 1;
  };

  const counted: DbClient = Object.create(real) as DbClient;
  counted.select = countedMethod(real, 'select', onCall);
  counted.selectDistinct = countedMethod(real, 'selectDistinct', onCall);
  counted.execute = countedMethod(real, 'execute', onCall);
  counted.insert = countedMethod(real, 'insert', onCall);
  counted.update = countedMethod(real, 'update', onCall);
  counted.delete = countedMethod(real, 'delete', onCall);
  counted.transaction = countedMethod(real, 'transaction', onCall);

  return { db: counted, queries: () => queries };
}

async function callDashboard(world: CoachWorld, dbOverride?: DbClient) {
  const ctx = dbOverride ? { ...world.ctx, db: dbOverride } : world.ctx;
  return appRouter.createCaller(ctx).coach.dashboard();
}

// ---------------------------------------------------------------------------

describe('coach.dashboard — query count', () => {
  it('issues exactly three database queries for a coach with 100 clients', async () => {
    const counted = countingDb(db);

    await callDashboard(coachA, counted.db);

    expect(counted.queries()).toBe(3);
  });

  it('issues the same three queries for a coach with two clients — the count does not grow with N', async () => {
    const hundred = countingDb(db);
    const two = countingDb(db);

    await callDashboard(coachA, hundred.db);
    await callDashboard(coachB, two.db);

    expect(hundred.queries()).toBe(two.queries());
    expect(two.queries()).toBe(3);
  });
});

describe('coach.dashboard — counters', () => {
  it('counts needs-review as DB§22 does: unreviewed sessions, uncommented ready videos, submitted check-ins', async () => {
    const result = await callDashboard(coachB);

    // 2 clients × (2 unreviewed sessions + 1 uncommented ready video), and
    // no submitted check-ins. The commented, processing, and soft-deleted
    // videos seeded alongside are the reason this is 6 and not 9.
    expect(result.needsReview).toBe(6);
    expect(result.needsReview).toBe(expectedNeedsReview(coachB.plans));
  });

  it('caps needs-review at the DB§22 inbox limit rather than counting an unbounded table', async () => {
    const uncapped = coachA.plans.reduce(
      (total, plan) =>
        total +
        plan.unreviewedSessions +
        plan.unreviewedVideos +
        (plan.hasSubmittedCheckin ? 1 : 0),
      0,
    );

    const result = await callDashboard(coachA);

    expect(uncapped).toBeGreaterThan(NEEDS_REVIEW_CAP);
    expect(result.needsReview).toBe(NEEDS_REVIEW_CAP);
  });

  it('counts check-ins due as pending only — never submitted, reviewed, or missed', async () => {
    const result = await callDashboard(coachA);

    expect(result.checkinsDue).toBe(expectedCheckinsDue(coachA.plans));
    expect(result.checkinsDue).toBeGreaterThan(0);
  });

  it('counts off-track clients from the fetched rows, matching the hand-computed reference', async () => {
    const result = await callDashboard(coachA);

    expect(result.offTrack).toBe(expectedOffTrack(coachA.plans));
    expect(result.offTrack).toBe(30);
  });

  it('never counts a client with no data as off-track', async () => {
    const result = await callDashboard(coachA);

    const noData = result.clients.filter((row) => row.overallAdherence === null);
    expect(noData).toHaveLength(10);
    for (const row of noData) {
      expect(row.adherenceColor).toBe('grey');
    }
    // Ten grey clients, and the off-track count is still only the red ones.
    expect(result.offTrack).toBe(result.clients.filter((r) => r.adherenceColor === 'red').length);
  });
});

describe('coach.dashboard — client rows', () => {
  it('returns one row per rostered client, excluding paused and archived', async () => {
    const result = await callDashboard(coachA);

    expect(result.clients).toHaveLength(expectedRoster(coachA.plans).length);
    expect(result.clients).toHaveLength(90);
    expect(result.clients.map((row) => row.status).sort()).toEqual(
      expect.arrayContaining(['active', 'invited']),
    );
    expect(result.clients.some((row) => row.status === 'paused')).toBe(false);
    expect(result.clients.some((row) => row.status === 'archived')).toBe(false);
  });

  it('carries the same two figures the off-track counter used, parsed as numbers', async () => {
    const result = await callDashboard(coachA);

    const green = result.clients.find((row) => row.adherenceColor === 'green');
    if (!green) throw new Error('expected at least one on-track client in the seed');

    expect(green.trainingAdherence).toBe(100);
    expect(green.nutritionAdherence).toBe(95);
    expect(green.overallAdherence).toBeCloseTo(98, 6);
    expect(typeof green.sessionsScheduled7d).toBe('number');
  });

  it("never returns another coach's client", async () => {
    const result = await callDashboard(coachA);

    const foreign = new Set(coachB.plans.map((plan) => plan.profileId));
    expect(result.clients.some((row) => foreign.has(row.clientId))).toBe(false);
    expect(result.clients).toHaveLength(90);
  });

  it('scopes every counter to the calling coach', async () => {
    const a = await callDashboard(coachA);
    const b = await callDashboard(coachB);

    expect(b.clients).toHaveLength(2);
    expect(b.checkinsDue).toBe(2);
    expect(b.offTrack).toBe(2);
    expect(a.checkinsDue).not.toBe(b.checkinsDue);
  });
});

describe('coach.dashboard — authorisation', () => {
  it('rejects an unauthenticated caller', async () => {
    const caller = appRouter.createCaller(createTestContext({ db, user: null }));

    await expect(caller.coach.dashboard()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a client', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `dashboard-client-caller@dashboard-test.com`,
        passwordHash: 'argon2id$placeholder',
        name: 'Client Caller',
        role: 'client',
        timezone: 'UTC',
        emailVerifiedAt: new Date(),
      })
      .returning();
    if (!user) throw new Error('seed insert into users did not return a row');
    const [profile] = await db
      .insert(schema.clientProfiles)
      .values({
        userId: user.id,
        coachId: coachA.profileId,
        status: 'active',
        activatedAt: new Date(),
      })
      .returning();
    if (!profile) throw new Error('seed insert into client_profiles did not return a row');

    const caller = appRouter.createCaller(
      createTestContext({
        db,
        user: {
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
        },
      }),
    );

    await expect(caller.coach.dashboard()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('coach.dashboard — query plans at 100-client scale', () => {
  interface PlanNode {
    nodeType: string;
    relation: string | null;
    index: string | null;
  }

  /** Every scan in the plan tree, including subplans and the view's inlined ones. */
  function scans(node: unknown, seen: PlanNode[] = []): PlanNode[] {
    if (Array.isArray(node)) {
      for (const child of node) scans(child, seen);
      return seen;
    }
    if (typeof node !== 'object' || node === null) return seen;

    const record = node as Record<string, unknown>;
    const nodeType = record['Node Type'];
    if (typeof nodeType === 'string') {
      const relation = record['Relation Name'];
      const index = record['Index Name'];
      seen.push({
        nodeType,
        relation: typeof relation === 'string' ? relation : null,
        index: typeof index === 'string' ? index : null,
      });
    }
    for (const value of Object.values(record)) scans(value, seen);
    return seen;
  }

  async function explain(query: SQLWrapper): Promise<PlanNode[]> {
    // `DUMP_PLANS=1` prints the readable plan next to the assertion that
    // reads it — the next person to argue with the planner about an index
    // needs the tree, not a list of node types.
    if (process.env.DUMP_PLANS) {
      const text = await db.execute(sql`EXPLAIN (ANALYZE) ${query.getSQL()}`);
      const lines = text.map((r) => String((r as Record<string, unknown>)['QUERY PLAN']));
      process.stdout.write(`===PLAN===\n${lines.join('\n')}\n===END===\n`);
    }
    const rows = await db.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query.getSQL()}`);
    const first: unknown = rows[0];
    if (typeof first !== 'object' || first === null) throw new Error('EXPLAIN returned no plan');
    const nodes = scans((first as Record<string, unknown>)['QUERY PLAN']);
    if (nodes.length === 0) throw new Error('EXPLAIN returned an empty plan tree');
    return nodes;
  }

  function sequentiallyScanned(nodes: readonly PlanNode[]): string[] {
    return [
      ...new Set(
        nodes.filter((n) => n.nodeType === 'Seq Scan').map((n) => n.relation ?? '(unnamed)'),
      ),
    ].sort();
  }

  it('reaches the client roster through a DB§7 coach index, never a sequential scan of the table', async () => {
    const nodes = await explain(clientOverviewQuery(db, coachA.profileId));

    // Either of DB§7's two coach-leading indexes is a pass. The planner
    // picks `client_profiles_active_seats` here — the partial one, whose
    // predicate is `status IN ('active','invited')`, which is this query's
    // roster filter exactly — over the wider `client_profiles_coach`.
    const used = nodes.map((n) => n.index).filter((name): name is string => name !== null);
    expect(
      used.some((name) => ['client_profiles_coach', 'client_profiles_active_seats'].includes(name)),
    ).toBe(true);
    expect(sequentiallyScanned(nodes)).not.toContain('client_profiles');
  });

  it("resolves each row's session, nutrition, and weight figures through an index", async () => {
    const nodes = await explain(clientOverviewQuery(db, coachA.profileId));

    // The four view subqueries that DO have an index to reach for.
    for (const table of ['workout_sessions', 'daily_nutrition_summary', 'body_metrics']) {
      expect(sequentiallyScanned(nodes)).not.toContain(table);
    }
  });

  it('sequentially scans only what v_client_overview leaves no index for', async () => {
    const nodes = await explain(clientOverviewQuery(db, coachA.profileId));

    // Both are properties of DB§9's view text, not of this query, and both
    // need a migration this task does not own:
    //
    // - `media_assets` has NO index on `client_id` at all, despite DB§7's
    //   "every FK is indexed, no exceptions" — the three indexes it carries
    //   lead with `owner_user_id`, `coach_id`, and `expires_at`.
    // - `comments_target` is PARTIAL on `deleted_at IS NULL`, and the view's
    //   `NOT EXISTS` does not repeat that predicate, so Postgres cannot use
    //   it. `needsReviewQuery` does repeat it, which is why the same shape
    //   is an index scan there and a sequential scan here.
    //
    // Pinned by name so a third sequentially-scanned table fails this test
    // rather than arriving unnoticed, and so fixing either one is visible.
    expect(sequentiallyScanned(nodes)).toEqual(['comments', 'media_assets', 'users']);
  });

  it('reads the needs-review inbox through an index, never a sequential scan', async () => {
    const nodes = await explain(needsReviewQuery(coachA.profileId));

    expect(sequentiallyScanned(nodes)).toEqual([]);
  });

  it('reads the pending check-in count through checkins_coach_pending', async () => {
    const nodes = await explain(checkinsDueQuery(db, coachA.profileId));

    expect(nodes.map((n) => n.index)).toEqual(expect.arrayContaining(['checkins_coach_pending']));
    expect(sequentiallyScanned(nodes)).toEqual([]);
  });
});
