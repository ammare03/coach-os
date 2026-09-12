// Real Postgres (`testing` skill §4). `program-templates/03`'s own
// Verification: archive a program, confirm it disappears from
// `listTemplates`; unarchive it, confirm it returns. `ownsResource` refusal
// is a WHERE-clause-shaped guarantee no mock can stand in for either.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { isCatalogedError } from '../../lib/app-error.ts';
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
      email: `coach-${seq}@programs-archive-test.com`,
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
    deletionScheduledFor: null,
    deletedAt: null,
  };
  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

function caller(coach: Coach) {
  return appRouter.createCaller(coach.ctx);
}

/** The catalogued `cause.appCode` of a rejected call — never its message. */
async function appCodeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCError && isCatalogedError(error)) return error.cause.appCode;
    throw error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('programs.archive / programs.unarchive', () => {
  it('sets and clears archived_at', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Archive me' });

    await caller(coach).programs.archive({ programId: id });
    const [archived] = await db
      .select({ archivedAt: schema.programs.archivedAt })
      .from(schema.programs)
      .where(eq(schema.programs.id, id));
    expect(archived?.archivedAt).not.toBeNull();

    await caller(coach).programs.unarchive({ programId: id });
    const [unarchived] = await db
      .select({ archivedAt: schema.programs.archivedAt })
      .from(schema.programs)
      .where(eq(schema.programs.id, id));
    expect(unarchived?.archivedAt).toBeNull();
  });

  it('disappears from listTemplates once archived, and returns once unarchived', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Toggle template' });

    expect((await caller(coach).programs.listTemplates({ limit: 20 })).items).toHaveLength(1);

    await caller(coach).programs.archive({ programId: id });
    expect((await caller(coach).programs.listTemplates({ limit: 20 })).items).toHaveLength(0);

    await caller(coach).programs.unarchive({ programId: id });
    const afterUnarchive = await caller(coach).programs.listTemplates({ limit: 20 });
    expect(afterUnarchive.items.map((item) => item.id)).toEqual([id]);
  });

  it('leaves programs.get reachable on an archived program — get is not a listing query', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Still readable' });
    await caller(coach).programs.archive({ programId: id });

    const program = await caller(coach).programs.get({ programId: id });
    expect(program.name).toBe('Still readable');
  });

  it('is idempotent — archiving twice, or unarchiving a never-archived program, does not error', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Idempotent' });

    await caller(coach).programs.unarchive({ programId: id });
    await caller(coach).programs.archive({ programId: id });
    await caller(coach).programs.archive({ programId: id });

    const [row] = await db
      .select({ archivedAt: schema.programs.archivedAt })
      .from(schema.programs)
      .where(eq(schema.programs.id, id));
    expect(row?.archivedAt).not.toBeNull();
  });

  it('refuses another coach’s program with NOT_YOUR_CLIENT, and changes nothing', async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Not yours' });

    const archiveCode = await appCodeOf(caller(attacker).programs.archive({ programId: id }));
    expect(archiveCode).toBe('NOT_YOUR_CLIENT');

    await caller(coach).programs.archive({ programId: id });
    const unarchiveCode = await appCodeOf(caller(attacker).programs.unarchive({ programId: id }));
    expect(unarchiveCode).toBe('NOT_YOUR_CLIENT');

    const [row] = await db
      .select({ archivedAt: schema.programs.archivedAt })
      .from(schema.programs)
      .where(eq(schema.programs.id, id));
    expect(row?.archivedAt).not.toBeNull();
  });
});
