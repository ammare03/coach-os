// Real Postgres, seeded with the DB§21 exercise set (`exercise-library/02`
// Verification). Search quality is entirely a property of two GIN indexes,
// a stemming dictionary, and a similarity threshold — none of which a mock
// has an opinion about.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

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

  const dbSrc = path.join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'src');
  for (const script of ['migrate.ts', 'seed.ts']) {
    execFileSync(process.execPath, ['--experimental-strip-types', path.join(dbSrc, script)], {
      env: { ...process.env },
      stdio: 'inherit',
    });
  }

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
}, 240_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

interface Coach {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<Coach> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@exercises-search-test.com`,
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
    deletedAt: null,
  };
  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

async function insertExercise(
  name: string,
  overrides: Partial<typeof schema.exercises.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.exercises)
    .values({
      name,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat',
      ...overrides,
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

function search(coach: Coach, query: string, limit = 30) {
  return appRouter.createCaller(coach.ctx).exercises.search({ query, limit });
}

describe('exercises.search — the misspelling table', () => {
  // `exercise-library/02` Verification: the cases that matter are written
  // as pairs, because each one is a different tier of the ladder proving
  // it still works.
  const CASES: { label: string; query: string; expectedSubstring: string }[] = [
    {
      label: 'an exact name',
      query: 'Barbell Back Squat',
      expectedSubstring: 'Barbell Back Squat',
    },
    { label: 'an alias', query: 'RDL', expectedSubstring: 'Romanian Deadlift' },
    { label: 'a second alias', query: 'OHP', expectedSubstring: 'Overhead Press' },
    {
      label: 'a transposed-letter misspelling',
      query: 'romainian deadlift',
      expectedSubstring: 'Romanian Deadlift',
    },
    {
      label: 'a missing-letter misspelling',
      query: 'barbel bench pres',
      expectedSubstring: 'Bench Press',
    },
    {
      label: 'a two-word query in the wrong order',
      query: 'squat back',
      expectedSubstring: 'Back Squat',
    },
  ];

  for (const testCase of CASES) {
    it(`resolves ${testCase.label} (${testCase.query})`, async () => {
      const coach = await insertCoach();

      const results = await search(coach, testCase.query);

      expect(results.length).toBeGreaterThan(0);
      expect(results.map((r) => r.name).join(' | ')).toContain(testCase.expectedSubstring);
    });
  }

  it('returns nothing for a query that should match nothing', async () => {
    const coach = await insertCoach();

    const results = await search(coach, 'zxqwvfghjkl');

    expect(results).toEqual([]);
  });
});

describe('exercises.search — the tier ladder', () => {
  it('marks an exact name hit as exact and puts it first', async () => {
    const coach = await insertCoach();

    const results = await search(coach, 'Barbell Back Squat');

    expect(results[0]?.name).toBe('Barbell Back Squat');
    expect(results[0]?.matchKind).toBe('exact');
  });

  it('ranks a custom exercise above a global one at equal relevance', async () => {
    const coach = await insertCoach();
    // The same name in both namespaces — legal under DB§5.2, and the tie
    // the custom-first ordering exists to break.
    const name = `Tie Break Movement ${seq}`;
    await insertExercise(name);
    await insertExercise(name, { coachId: coach.profileId });

    const results = await search(coach, name);

    expect(results).toHaveLength(2);
    expect(results[0]?.isCustom).toBe(true);
    expect(results[1]?.isCustom).toBe(false);
  });

  it('does not run the trigram tier when the exact tier already filled the limit', async () => {
    const coach = await insertCoach();
    const name = `Solo Exact ${seq}`;
    await insertExercise(name, { coachId: coach.profileId });

    const results = await search(coach, name, 1);

    expect(results).toHaveLength(1);
    expect(results[0]?.matchKind).toBe('exact');
  });

  it('does not run the trigram tier for a one-character query', async () => {
    const coach = await insertCoach();
    // 'q' is a substring of nothing in the seeded library and would only
    // ever surface through similarity noise.
    const results = await search(coach, 'q');

    expect(results.every((r) => r.matchKind !== 'fuzzy')).toBe(true);
  });

  it('returns the head of the library for an empty query, so the picker opens with something', async () => {
    const coach = await insertCoach();

    const results = await search(coach, '', 10);

    expect(results).toHaveLength(10);
  });
});

describe('exercises.search — isolation and archival', () => {
  it('never returns another coach custom exercise, even for its exact name', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const distinctive = `Zealous Quokka Press ${seq}`;
    await insertExercise(distinctive, { coachId: theirs.profileId });

    const results = await search(mine, distinctive);

    expect(results).toEqual([]);
  });

  it('never returns an archived exercise, at any tier', async () => {
    const coach = await insertCoach();
    const name = `Retired Movement ${seq}`;
    await insertExercise(name, { coachId: coach.profileId, archivedAt: new Date() });

    // Exact, then a fuzzy variant of the same string — both tiers, one assertion each.
    expect(await search(coach, name)).toEqual([]);
    expect((await search(coach, `Retird Movemnt ${seq}`)).map((r) => r.name)).not.toContain(name);
  });

  it('applies the filters search shares with list', async () => {
    const coach = await insertCoach();
    const suffix = `filtered-${seq}`;
    const wanted = `Filtered Hinge ${seq}`;
    await insertExercise(wanted, {
      coachId: coach.profileId,
      equipment: suffix,
      movementPattern: 'hinge',
    });
    await insertExercise(`Filtered Squat ${seq}`, {
      coachId: coach.profileId,
      equipment: suffix,
      movementPattern: 'squat',
    });

    const results = await appRouter
      .createCaller(coach.ctx)
      .exercises.search({ query: 'Filtered', equipment: suffix, movementPattern: 'hinge' });

    expect(results.map((r) => r.name)).toEqual([wanted]);
  });
});

describe('exercises.search — the §19 budget', () => {
  it('stays well under 100ms server-side against 120 global plus 200 custom exercises', async () => {
    const coach = await insertCoach();
    // The seeded 120 alone bitmap-scan fast enough to hide a planning
    // mistake — `exercise-library/02` Approach step 7 asks for 200 custom
    // rows on top before measuring.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      name: `Custom Movement ${seq}-${String(i).padStart(3, '0')}`,
      coachId: coach.profileId,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat' as const,
    }));
    await db.insert(schema.exercises).values(rows);
    // Without fresh statistics the planner still thinks the table has 121
    // rows and picks a plan that flatters the measurement.
    await db.execute(sql`ANALYZE training.exercises`);

    const samples: number[] = [];
    for (const query of ['squat', 'romainian deadlift', 'Custom Movement', 'bench', 'rdl']) {
      for (let run = 0; run < 4; run += 1) {
        const startedAt = process.hrtime.bigint();
        await search(coach, query);
        samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
      }
    }
    samples.sort((a, b) => a - b);
    const p75 = samples[Math.floor(samples.length * 0.75)] ?? 0;

    expect(p75).toBeLessThan(100);
  }, 60_000);
});
