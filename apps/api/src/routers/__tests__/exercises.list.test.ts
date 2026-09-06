// Real Postgres (`testing` skill §4). Every acceptance criterion in
// `exercise-library/01` is a `WHERE`, an `ORDER BY`, or a keyset — none of
// which a mocked Drizzle can demonstrate, because a mock returns whatever
// it was told to regardless of the clause under test.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, isNull } from 'drizzle-orm';
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

  // The DB§21 seed, against the freshly migrated database — `exercise-
  // library/01`'s Verification step 2 ("confirm the seed is actually
  // reachable"). Run through the script rather than by importing
  // `seedExercises`, because `@coachos/db` deliberately does not export its
  // seed modules and this test is not a reason to widen that surface.
  const seedScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'seed.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', seedScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

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
      email: `coach-${seq}@exercises-router-test.com`,
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
      equipment: 'Barbell',
      movementPattern: 'squat',
      ...overrides,
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

describe('exercises.list — visibility', () => {
  it('returns the global library plus the caller own rows, and no other coach rows', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const suffix = `visibility-${seq}`;
    const globalName = `Global Movement ${seq}`;
    await insertExercise(globalName, { equipment: suffix });
    await insertExercise(`Custom Mine ${seq}`, { coachId: mine.profileId, equipment: suffix });
    const theirsName = `Custom Theirs ${seq}`;
    await insertExercise(theirsName, { coachId: theirs.profileId, equipment: suffix });

    const page = await appRouter
      .createCaller(mine.ctx)
      .exercises.list({ equipment: suffix, limit: 100 });
    const names = page.items.map((item) => item.name);

    expect(names).toContain(globalName);
    expect(names.some((name) => name.startsWith('Custom Mine'))).toBe(true);
    expect(names).not.toContain(theirsName);
  });

  it('never returns coachId, and reports ownership as isCustom instead', async () => {
    const coach = await insertCoach();
    const suffix = `shape-${seq}`;
    const customName = `Shape Custom ${seq}`;
    await insertExercise(customName, { coachId: coach.profileId, equipment: suffix });
    const globalName = `Shape Global ${seq}`;
    await insertExercise(globalName, { equipment: suffix });

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 100 });
    const custom = page.items.find((item) => item.name === customName);
    const globalRow = page.items.find((item) => item.name === globalName);

    expect(custom?.isCustom).toBe(true);
    expect(globalRow?.isCustom).toBe(false);
    expect(custom).not.toHaveProperty('coachId');
  });

  it('excludes archived exercises', async () => {
    const coach = await insertCoach();
    const suffix = `archived-${seq}`;
    const archivedName = `Retired ${seq}`;
    await insertExercise(archivedName, {
      coachId: coach.profileId,
      equipment: suffix,
      archivedAt: new Date(),
    });

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 100 });

    expect(page.items.map((item) => item.name)).not.toContain(archivedName);
  });

  it('returns defaultIncrementKg as a number on every row, defaulting to 2.5', async () => {
    const coach = await insertCoach();
    const suffix = `increment-${seq}`;
    await insertExercise(`Increment Default ${seq}`, {
      coachId: coach.profileId,
      equipment: suffix,
    });
    const explicitName = `Increment Explicit ${seq}`;
    await insertExercise(explicitName, {
      coachId: coach.profileId,
      equipment: suffix,
      defaultIncrementKg: '1.25',
    });

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 100 });

    for (const item of page.items) {
      expect(typeof item.defaultIncrementKg).toBe('number');
    }
    expect(page.items.find((i) => i.name.startsWith('Increment Default'))?.defaultIncrementKg).toBe(
      2.5,
    );
    expect(page.items.find((i) => i.name === explicitName)?.defaultIncrementKg).toBe(1.25);
  });
});

describe('exercises.list — filters', () => {
  it('composes primaryMuscle, equipment and movementPattern as an intersection', async () => {
    const coach = await insertCoach();
    const match = `Filter Match ${seq}`;
    await insertExercise(match, {
      coachId: coach.profileId,
      primaryMuscle: `hamstrings-${seq}`,
      equipment: `Kettlebell-${seq}`,
      movementPattern: 'hinge',
    });
    await insertExercise(`Filter Wrong Pattern ${seq}`, {
      coachId: coach.profileId,
      primaryMuscle: `hamstrings-${seq}`,
      equipment: `Kettlebell-${seq}`,
      movementPattern: 'pull',
    });
    await insertExercise(`Filter Wrong Equipment ${seq}`, {
      coachId: coach.profileId,
      primaryMuscle: `hamstrings-${seq}`,
      equipment: `Barbell-${seq}`,
      movementPattern: 'hinge',
    });

    const page = await appRouter.createCaller(coach.ctx).exercises.list({
      primaryMuscle: `hamstrings-${seq}`,
      equipment: `Kettlebell-${seq}`,
      movementPattern: 'hinge',
      limit: 100,
    });

    expect(page.items.map((item) => item.name)).toEqual([match]);
  });
});

describe('exercises.list — ordering and keyset pagination', () => {
  it('orders case-insensitively, so a lowercase name is not exiled to the end', async () => {
    const coach = await insertCoach();
    const suffix = `ordering-${seq}`;
    await insertExercise(`Zzz upper ${suffix}`, { coachId: coach.profileId, equipment: suffix });
    await insertExercise(`aaa lower ${suffix}`, { coachId: coach.profileId, equipment: suffix });

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 100 });

    expect(page.items.map((item) => item.name)).toEqual([
      `aaa lower ${suffix}`,
      `Zzz upper ${suffix}`,
    ]);
  });

  it('walks every row exactly once across pages, including a duplicated name', async () => {
    const coach = await insertCoach();
    const suffix = `keyset-${seq}`;
    // The same name in both namespaces — legal under DB§5.2's partial
    // unique index, and exactly the tie a name-only keyset would skip.
    await insertExercise('Shared Name', { equipment: suffix });
    await insertExercise('Shared Name', { coachId: coach.profileId, equipment: suffix });
    await insertExercise(`b ${suffix}`, { coachId: coach.profileId, equipment: suffix });
    await insertExercise(`c ${suffix}`, { coachId: coach.profileId, equipment: suffix });
    await insertExercise(`d ${suffix}`, { coachId: coach.profileId, equipment: suffix });

    const caller = appRouter.createCaller(coach.ctx);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result: Awaited<ReturnType<typeof caller.exercises.list>> = await caller.exercises.list(
        cursor ? { equipment: suffix, limit: 2, cursor } : { equipment: suffix, limit: 2 },
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('returns a null cursor on a short page', async () => {
    const coach = await insertCoach();
    const suffix = `short-page-${seq}`;
    await insertExercise(`only ${suffix}`, { coachId: coach.profileId, equipment: suffix });

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 30 });

    expect(page.nextCursor).toBeNull();
  });
});

describe('exercises.list — the DB§21 seed is actually reachable', () => {
  it('walks the whole seeded global library through the keyset, once each', async () => {
    const coach = await insertCoach();
    const seededIds = await db
      .select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(and(isNull(schema.exercises.coachId), isNull(schema.exercises.archivedAt)));
    // DB§21 seeds ~120. If the seed and the product ever disagree about how
    // many exercises exist, that is worth knowing now rather than in three
    // phases' time.
    expect(seededIds.length).toBeGreaterThanOrEqual(120);

    const caller = appRouter.createCaller(coach.ctx);
    const seen: string[] = [];
    let cursor: string | null = null;
    // A bounded walk rather than `while (cursor)`: a keyset bug that fails
    // to advance would hang the suite instead of failing it.
    for (let page = 0; page < 40; page += 1) {
      const result: Awaited<ReturnType<typeof caller.exercises.list>> = await caller.exercises.list(
        cursor ? { limit: 100, cursor } : { limit: 100 },
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(seen.length);
    const missing = seededIds.filter((row) => !seen.includes(row.id));
    expect(missing).toEqual([]);
  }, 60_000);
});

describe('exercises.get', () => {
  it('resolves an archived exercise, because history still points at one', async () => {
    const coach = await insertCoach();
    const id = await insertExercise(`Archived But Resolvable ${seq}`, {
      coachId: coach.profileId,
      archivedAt: new Date(),
    });

    const exercise = await appRouter.createCaller(coach.ctx).exercises.get({ exerciseId: id });

    expect(exercise.id).toBe(id);
    expect(exercise.archivedAt).not.toBeNull();
  });

  it('throws NOT_FOUND for another coach custom exercise, not FORBIDDEN', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const id = await insertExercise(`Theirs By Id ${seq}`, { coachId: theirs.profileId });

    await expect(
      appRouter.createCaller(mine.ctx).exercises.get({ exerciseId: id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws the same NOT_FOUND for an id that names nothing', async () => {
    const coach = await insertCoach();

    await expect(
      appRouter
        .createCaller(coach.ctx)
        .exercises.get({ exerciseId: '00000000-0000-7000-8000-00000000dead' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
