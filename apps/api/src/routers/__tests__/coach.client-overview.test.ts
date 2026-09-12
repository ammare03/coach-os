// Real Postgres (`testing` skill §4). Three things this suite exists for,
// and none of them survives a mocked Drizzle:
//
//   1. **The guard.** `coach.clients.overview` takes a `clientId`, which
//      `CLAUDE.md` §6.2 calls the single most likely place in the project
//      for a catastrophic data leak. The enumeration test
//      (`__tests__/authz.test.ts`) probes it generically; this asserts the
//      answer a coach actually gets.
//   2. **The weekly average.** DB§22 averages the week deliberately, and a
//      raw daily plot passes every type check and every unit test. Only a
//      real `date_trunc` over real rows can tell the two apart.
//   3. **The notes scope.** A note is private to the coach who WROTE it
//      (DB§5.4), which is a different condition from the one `ownsResource`
//      already checked — so it needs its own row in the database to fail
//      against.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import { parseInjuries } from '../../features/coach/client-overview.ts';
import type { ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;

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

  const connectionString = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  fixture = await createTwoCoachesFixture(db);
  await seedOverviewExtras();
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

// ---------------------------------------------------------------------------
// The seed, and the reference the assertions are checked against
// ---------------------------------------------------------------------------

/**
 * Three weigh-ins inside one calendar week and one in the next, chosen so
 * the two shapes disagree: a weekly average yields TWO points (81.0 and
 * 79.4); a raw daily plot yields FOUR. The first week's three readings
 * average to exactly 81.00, which is also not any one of them — so a query
 * that quietly took `max`, `min`, or `last` fails too.
 *
 * Mondays, because `date_trunc('week', …)` buckets on one.
 */
const WEEK_ONE = ['2026-08-03', '2026-08-05', '2026-08-07'] as const;
const WEEK_ONE_WEIGHTS = ['82.00', '81.00', '80.00'] as const;
const WEEK_ONE_AVERAGE = 81;
const WEEK_TWO_DATE = '2026-08-10';
const WEEK_TWO_WEIGHT = '79.40';

const INJURIES = [
  {
    area: 'left knee',
    notes: 'Avoid deep unracked squats.',
    since: '2025-11',
    severity: 'moderate',
  },
  { area: 'right shoulder', notes: null, since: null, severity: null },
];

async function seedOverviewExtras(): Promise<void> {
  // `clientA1` is the populated client; `clientA2` is deliberately left as
  // the fixture made it, so every "absent" assertion has a real subject.
  await db
    .update(schema.clientProfiles)
    .set({ injuries: INJURIES, goal: 'fat_loss' })
    .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

  await db.insert(schema.bodyMetrics).values([
    ...WEEK_ONE.map((date, index) => ({
      clientId: fixture.clientA1.profileId,
      recordedAt: new Date(`${date}T08:00:00Z`),
      recordedDate: date,
      weightKg: WEEK_ONE_WEIGHTS[index] ?? '0',
    })),
    {
      clientId: fixture.clientA1.profileId,
      recordedAt: new Date(`${WEEK_TWO_DATE}T08:00:00Z`),
      recordedDate: WEEK_TWO_DATE,
      weightKg: WEEK_TWO_WEIGHT,
    },
    // A waist-only row: `weight_kg` is nullable, and an all-null week would
    // reach the chart as a point with no value if the query did not exclude
    // it. Placed in its own week so its absence is visible in the count.
    {
      clientId: fixture.clientA1.profileId,
      recordedAt: new Date('2026-08-17T08:00:00Z'),
      recordedDate: '2026-08-17',
      waistCm: '78.0',
    },
  ]);

  await db.insert(schema.assignments).values({
    programId: fixture.coachA.programId,
    clientId: fixture.clientA1.profileId,
    coachId: fixture.coachA.profileId,
    startDate: '2026-08-03',
    currentWeek: 3,
    status: 'active',
  });

  await db.insert(schema.coachClientNotes).values([
    {
      coachId: fixture.coachA.profileId,
      clientId: fixture.clientA1.profileId,
      body: 'Pinned and visible.',
      isPinned: true,
    },
    {
      coachId: fixture.coachA.profileId,
      clientId: fixture.clientA1.profileId,
      body: 'Not pinned.',
      isPinned: false,
    },
    {
      coachId: fixture.coachA.profileId,
      clientId: fixture.clientA1.profileId,
      body: 'Pinned, then deleted.',
      isPinned: true,
      deletedAt: new Date('2026-08-20T00:00:00Z'),
    },
    // Coach B's note about coach A's client. Not reachable in the product —
    // B cannot open this client — but the row can exist (a reassignment,
    // an assistant), and DB§5.4 says A must never read it.
    {
      coachId: fixture.coachB.profileId,
      clientId: fixture.clientA1.profileId,
      body: "Another coach's private note.",
      isPinned: true,
    },
  ]);
}

function coachUser(profileId: string, userId: string): ContextUser {
  return {
    id: userId,
    email: 'coach@two-coaches-fixture.com',
    role: 'coach',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: profileId,
    clientProfileId: null,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

function callAs(coach: { profileId: string; userId: string }, clientId: string) {
  return appRouter
    .createCaller(createTestContext({ db, user: coachUser(coach.profileId, coach.userId) }))
    .coach.clients.overview({ clientId });
}

// ---------------------------------------------------------------------------

describe('coach.clients.overview', () => {
  it('refuses a client belonging to another coach', async () => {
    await expect(callAs(fixture.coachB, fixture.clientA1.profileId)).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
  });

  it('refuses a client id that does not exist at all, with the same code', async () => {
    // The two must be indistinguishable or the pair is an enumeration
    // oracle (`ERRORS.md` ER§2.1).
    await expect(
      callAs(fixture.coachA, '00000000-0000-7000-8000-00000000dead'),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('returns everything Overview needs in one call', async () => {
    const overview = await callAs(fixture.coachA, fixture.clientA1.profileId);

    expect(overview.clientId).toBe(fixture.clientA1.profileId);
    expect(overview.goal).toBe('fat_loss');
    expect(overview.weightTrend.length).toBeGreaterThan(0);
    expect(overview.program).not.toBeNull();
    expect(overview.nextCheckin).not.toBeNull();
    expect(overview.pinnedNotes).toHaveLength(1);
    expect(overview.adherence.trend).toEqual(expect.any(Array));
  });

  it('averages the weight trend by week rather than plotting every reading', async () => {
    const overview = await callAs(fixture.coachA, fixture.clientA1.profileId);

    // Four weigh-ins with a weight, in two calendar weeks — plus one
    // waist-only row in a third, which must not appear at all.
    expect(overview.weightTrend).toEqual([
      { weekStartISO: '2026-08-03', weightKg: WEEK_ONE_AVERAGE },
      { weekStartISO: '2026-08-10', weightKg: Number(WEEK_TWO_WEIGHT) },
    ]);
  });

  it('reports the current program and the week the client is on', async () => {
    const overview = await callAs(fixture.coachA, fixture.clientA1.profileId);

    expect(overview.program).toMatchObject({
      programId: fixture.coachA.programId,
      currentWeek: 3,
      durationWeeks: 4,
      startDate: '2026-08-03',
    });
  });

  it('returns only the caller’s own pinned, undeleted notes', async () => {
    const overview = await callAs(fixture.coachA, fixture.clientA1.profileId);

    expect(overview.pinnedNotes.map((note) => note.body)).toEqual(['Pinned and visible.']);
  });

  describe('the injuries banner is present iff `injuries` is non-empty', () => {
    it('returns the recorded injuries for a client who has them', async () => {
      const overview = await callAs(fixture.coachA, fixture.clientA1.profileId);

      expect(overview.injuries).toEqual([
        {
          area: 'left knee',
          notes: 'Avoid deep unracked squats.',
          since: '2025-11',
          severity: 'moderate',
        },
        { area: 'right shoulder', notes: null, since: null, severity: null },
      ]);
    });

    it('returns an empty array — not a placeholder row — for a client who has none', async () => {
      const overview = await callAs(fixture.coachA, fixture.clientA2.profileId);

      expect(overview.injuries).toEqual([]);
    });
  });
});

// `injuries` is `jsonb` with no `CHECK` behind it, so the parse is the only
// thing between the banner and whatever is in the column. Pure, so it needs
// no container.
describe('parseInjuries', () => {
  it('drops an entry that cannot name a body part', () => {
    expect(parseInjuries([{ notes: 'something' }, { area: 'knee' }])).toEqual([
      { area: 'knee', notes: null, since: null, severity: null },
    ]);
  });

  it('treats a non-array column as no injuries rather than throwing', () => {
    expect(parseInjuries(null)).toEqual([]);
    expect(parseInjuries({ area: 'knee' })).toEqual([]);
    expect(parseInjuries('left knee')).toEqual([]);
  });

  it('drops a blank area, which would render as an unlabelled row', () => {
    expect(parseInjuries([{ area: '   ', notes: 'x' }])).toEqual([]);
  });
});
