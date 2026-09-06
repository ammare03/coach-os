// Real Postgres (`testing` skill §4). Cross-coach edit rejection and global
// immutability are authorisation assertions, and neither can be tested with
// a mock — the guarantee lives in a `WHERE` clause and a partial unique
// index, not in application logic a spy could observe.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
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

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
}, 180_000);

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
      email: `coach-${seq}@exercises-mutations-test.com`,
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

function draft(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    primaryMuscle: 'quadriceps',
    equipment: 'barbell',
    movementPattern: 'squat' as const,
    cues: ['Brace before you descend'],
    defaultIncrementKg: 2.5,
    isUnilateral: false,
    isBodyweight: false,
    ...overrides,
  };
}

describe('exercises.create', () => {
  it('creates a custom exercise owned by the caller, visible in their list', async () => {
    const coach = await insertCoach();
    const name = `Created Movement ${seq}`;
    const suffix = `create-${seq}`;

    const created = await appRouter
      .createCaller(coach.ctx)
      .exercises.create(draft(name, { equipment: suffix }));

    expect(created.isCustom).toBe(true);
    expect(created.cues).toEqual(['Brace before you descend']);
    expect(created.defaultIncrementKg).toBe(2.5);

    const page = await appRouter
      .createCaller(coach.ctx)
      .exercises.list({ equipment: suffix, limit: 30 });
    expect(page.items.map((item) => item.name)).toContain(name);
  });

  it('takes coach_id from the session — the input schema has no coach field', async () => {
    const coach = await insertCoach();
    const name = `Session Owned ${seq}`;

    const caller = appRouter.createCaller(coach.ctx);
    // TypeScript already refuses this object — the input type has no
    // `coachId` — so the cast is what lets the test compile. The threat
    // model is a patched client sending raw JSON, which has no typechecker,
    // and this asserts the runtime guard: `strictObject` REJECTS the extra
    // key rather than silently stripping it, so a privilege-escalation
    // attempt is a 400 and not a no-op.
    const escalation = {
      ...draft(name),
      coachId: '00000000-0000-7000-8000-000000000001',
    } as Parameters<typeof caller.exercises.create>[0];

    await expect(caller.exercises.create(escalation)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const rows = await db
      .select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(eq(schema.exercises.name, name));
    expect(rows).toHaveLength(0);
  });

  it('rejects a name that collides with the caller own live exercise, with the existing id', async () => {
    const coach = await insertCoach();
    const name = `Collides ${seq}`;
    const caller = appRouter.createCaller(coach.ctx);
    const first = await caller.exercises.create(draft(name));

    await expect(caller.exercises.create(draft(name))).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'EXERCISE_NAME_TAKEN', details: { existingExerciseId: first.id } },
    });
  });

  it('treats the collision as case-insensitive, as DB§5.2 does', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    await caller.exercises.create(draft(`Case Test ${seq}`));

    await expect(caller.exercises.create(draft(`case test ${seq}`))).rejects.toMatchObject({
      cause: { appCode: 'EXERCISE_NAME_TAKEN' },
    });
  });

  it('survives a double submit — one row, and the second attempt is EXERCISE_NAME_TAKEN', async () => {
    const coach = await insertCoach();
    const name = `Double Tapped ${seq}`;
    const caller = appRouter.createCaller(coach.ctx);

    // Fired together, not sequentially: a pre-check-then-insert
    // implementation passes the sequential version of this test and fails
    // this one with a raw constraint error.
    const results = await Promise.allSettled([
      caller.exercises.create(draft(name)),
      caller.exercises.create(draft(name)),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: 'CONFLICT', cause: { appCode: 'EXERCISE_NAME_TAKEN' } },
    });

    const rows = await db
      .select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(eq(schema.exercises.name, name));
    expect(rows).toHaveLength(1);
  });

  it('allows a name that matches a global exercise — a different namespace', async () => {
    const coach = await insertCoach();
    const name = `Shared With Global ${seq}`;
    await db.insert(schema.exercises).values({
      name,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat',
    });

    const created = await appRouter.createCaller(coach.ctx).exercises.create(draft(name));

    expect(created.isCustom).toBe(true);
  });

  it('allows a name that matches the caller own ARCHIVED exercise', async () => {
    const coach = await insertCoach();
    const name = `Recreated After Archive ${seq}`;
    const caller = appRouter.createCaller(coach.ctx);
    const original = await caller.exercises.create(draft(name));
    await caller.exercises.archive({ exerciseId: original.id });

    const recreated = await caller.exercises.create(draft(name));

    expect(recreated.id).not.toBe(original.id);
  });
});

describe('exercises.checkName', () => {
  it('reports none for a name nobody has', async () => {
    const coach = await insertCoach();

    const result = await appRouter
      .createCaller(coach.ctx)
      .exercises.checkName({ name: `Nobody Has This ${seq}` });

    expect(result).toEqual({ kind: 'none' });
  });

  it('reports yours, with the id the form needs to offer "open the existing one"', async () => {
    const coach = await insertCoach();
    const name = `Check Yours ${seq}`;
    const caller = appRouter.createCaller(coach.ctx);
    const existing = await caller.exercises.create(draft(name));

    expect(await caller.exercises.checkName({ name })).toEqual({
      kind: 'yours',
      exerciseId: existing.id,
    });
  });

  it('reports global for a seed-owned name', async () => {
    const coach = await insertCoach();
    const name = `Check Global ${seq}`;
    const [row] = await db
      .insert(schema.exercises)
      .values({
        name,
        primaryMuscle: 'quadriceps',
        equipment: 'barbell',
        movementPattern: 'squat',
      })
      .returning({ id: schema.exercises.id });

    expect(await appRouter.createCaller(coach.ctx).exercises.checkName({ name })).toEqual({
      kind: 'global',
      exerciseId: row?.id,
    });
  });

  it('reports archived, so the form can offer to bring it back with its history', async () => {
    const coach = await insertCoach();
    const name = `Check Archived ${seq}`;
    const caller = appRouter.createCaller(coach.ctx);
    const existing = await caller.exercises.create(draft(name));
    await caller.exercises.archive({ exerciseId: existing.id });

    expect(await caller.exercises.checkName({ name })).toEqual({
      kind: 'archived',
      exerciseId: existing.id,
    });
  });

  it('never reports another coach exercise', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const name = `Theirs Only ${seq}`;
    await appRouter.createCaller(theirs.ctx).exercises.create(draft(name));

    expect(await appRouter.createCaller(mine.ctx).exercises.checkName({ name })).toEqual({
      kind: 'none',
    });
  });
});

describe('exercises.update', () => {
  it('writes the caller own exercise', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const created = await caller.exercises.create(draft(`Editable ${seq}`));

    const updated = await caller.exercises.update({
      exerciseId: created.id,
      ...draft(`Edited ${seq}`, { cues: ['One', 'Two'], defaultIncrementKg: 1.25 }),
    });

    expect(updated.name).toBe(`Edited ${seq}`);
    expect(updated.cues).toEqual(['One', 'Two']);
    expect(updated.defaultIncrementKg).toBe(1.25);
  });

  it('refuses a GLOBAL exercise with EXERCISE_NOT_EDITABLE — one coach must not rewrite a movement for everyone', async () => {
    const coach = await insertCoach();
    const [row] = await db
      .insert(schema.exercises)
      .values({
        name: `Global Immutable ${seq}`,
        primaryMuscle: 'quadriceps',
        equipment: 'barbell',
        movementPattern: 'squat',
      })
      .returning({ id: schema.exercises.id });
    if (!row) throw new Error('seed insert into exercises did not return a row');

    await expect(
      appRouter
        .createCaller(coach.ctx)
        .exercises.update({ exerciseId: row.id, ...draft('Renamed By A Coach') }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'EXERCISE_NOT_EDITABLE' },
    });

    const [after] = await db
      .select({ name: schema.exercises.name })
      .from(schema.exercises)
      .where(eq(schema.exercises.id, row.id));
    expect(after?.name).toBe(`Global Immutable ${seq}`);
  });

  it('refuses another coach exercise with NOT_FOUND, never FORBIDDEN', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const created = await appRouter
      .createCaller(theirs.ctx)
      .exercises.create(draft(`Not Mine ${seq}`));

    await expect(
      appRouter
        .createCaller(mine.ctx)
        .exercises.update({ exerciseId: created.id, ...draft(`Hijacked ${seq}`) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'EXERCISE_NOT_FOUND' } });
  });

  it('refuses a rename onto another of the caller own live exercises', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const taken = await caller.exercises.create(draft(`Taken Name ${seq}`));
    const other = await caller.exercises.create(draft(`Other Name ${seq}`));

    await expect(
      caller.exercises.update({ exerciseId: other.id, ...draft(`Taken Name ${seq}`) }),
    ).rejects.toMatchObject({
      cause: { appCode: 'EXERCISE_NAME_TAKEN', details: { existingExerciseId: taken.id } },
    });
  });
});

describe('exercises.archive / unarchive', () => {
  it('sets archived_at and removes the exercise from list and search', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const suffix = `archive-${seq}`;
    const name = `To Archive ${seq}`;
    const created = await caller.exercises.create(draft(name, { equipment: suffix }));

    const archived = await caller.exercises.archive({ exerciseId: created.id });

    expect(archived.archivedAt).not.toBeNull();
    const page = await caller.exercises.list({ equipment: suffix, limit: 30 });
    expect(page.items.map((i) => i.name)).not.toContain(name);
    expect((await caller.exercises.search({ query: name })).map((i) => i.name)).not.toContain(name);
  });

  it('still resolves the archived exercise by id, because history points at it', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const created = await caller.exercises.create(draft(`Still Resolvable ${seq}`));
    await caller.exercises.archive({ exerciseId: created.id });

    const fetched = await caller.exercises.get({ exerciseId: created.id });

    expect(fetched.id).toBe(created.id);
  });

  it('restores the same row on unarchive — the undo tap keeps the history', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const suffix = `undo-${seq}`;
    const created = await caller.exercises.create(draft(`Undone ${seq}`, { equipment: suffix }));
    await caller.exercises.archive({ exerciseId: created.id });

    const restored = await caller.exercises.unarchive({ exerciseId: created.id });

    expect(restored.id).toBe(created.id);
    expect(restored.archivedAt).toBeNull();
    const page = await caller.exercises.list({ equipment: suffix, limit: 30 });
    expect(page.items.map((i) => i.id)).toContain(created.id);
  });

  it('is idempotent — archiving twice is not an error', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const created = await caller.exercises.create(draft(`Twice Archived ${seq}`));

    await caller.exercises.archive({ exerciseId: created.id });
    const again = await caller.exercises.archive({ exerciseId: created.id });

    expect(again.id).toBe(created.id);
    expect(again.archivedAt).not.toBeNull();
  });

  it('refuses to archive a global exercise', async () => {
    const coach = await insertCoach();
    const [row] = await db
      .insert(schema.exercises)
      .values({
        name: `Global Unarchivable ${seq}`,
        primaryMuscle: 'quadriceps',
        equipment: 'barbell',
        movementPattern: 'squat',
      })
      .returning({ id: schema.exercises.id });
    if (!row) throw new Error('seed insert into exercises did not return a row');

    await expect(
      appRouter.createCaller(coach.ctx).exercises.archive({ exerciseId: row.id }),
    ).rejects.toMatchObject({ cause: { appCode: 'EXERCISE_NOT_EDITABLE' } });
  });

  it('refuses to un-archive onto a name the coach has since reused', async () => {
    const coach = await insertCoach();
    const caller = appRouter.createCaller(coach.ctx);
    const name = `Reused Name ${seq}`;
    const original = await caller.exercises.create(draft(name));
    await caller.exercises.archive({ exerciseId: original.id });
    await caller.exercises.create(draft(name));

    await expect(caller.exercises.unarchive({ exerciseId: original.id })).rejects.toMatchObject({
      cause: { appCode: 'EXERCISE_NAME_TAKEN' },
    });
  });
});
