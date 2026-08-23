// Real Postgres via Testcontainers, and the real `createContext` factory —
// not `createTestContext` with hand-set profile ids. `02-has-role.md`'s
// data-integrity case (step 2) only exists when `coachProfileId` is `null`
// because the context factory's own left join found no matching row; a
// hand-built context can't produce that honestly, since `hasRole` reads
// `ctx.user`'s already-resolved fields and never re-queries the database
// itself (`api-scaffold/02` resolves the profile once, on the hot path).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { schema } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

let container: StartedTestContainer;
// `env.ts` freezes `DATABASE_URL` at module load (same note as
// `context.test.ts`) — `router`/`procedures.ts` transitively import it, so
// every one of these is dynamically imported inside `setup()`, *after* the
// container's connection string lands in `process.env`, never as a static
// top-level import. `Awaited<ReturnType<typeof setup>>` lets everything
// setup() builds (the db handle, the context factory, the scratch router)
// flow out with its real inferred type, with no type hand-written twice.
async function setup() {
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

  // `callerContextFor` below drives every case through the real
  // `createContextFactory`, each with a live-looking token — which means
  // each one exercises `createContext`'s Redis session-cache read
  // (`../../trpc/context.ts`). Deliberately unreachable so those reads
  // fail-open deterministically instead of depending on whether a
  // developer has `docker compose up -d`'s Redis running locally
  // (`context.test.ts` does the same, for the same reason).
  process.env.REDIS_URL = 'redis://127.0.0.1:1';

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

  const { createContextFactory } = await import('../../trpc/context.ts');
  const { router } = await import('../../trpc/init.ts');
  const { clientProcedure, coachOrClientProcedure, coachProcedure } =
    await import('../../trpc/procedures.ts');
  const { redis } = await import('../../lib/redis.ts');

  // The real `retryStrategy` (`lib/redis.ts`) reconnects forever, by
  // design — correct in production, but against the unreachable address
  // above it schedules a new backoff timer after every one of this file's
  // cases. Giving up after the first attempt removes the resulting
  // leaked-timer race with `afterAll`'s `disconnect()` below, instead of
  // trying to win it (`context.test.ts` does the same).
  redis.options.retryStrategy = () => null;

  const db = (await createContextFactory()(new Request('http://localhost/trpc/health.ping'))).db;

  const scratchRouter = router({
    coachOnly: coachProcedure.query(({ ctx }) => ({
      coachProfileId: ctx.user.coachProfileId,
      // Type-level proof (`02-has-role.md`'s acceptance criteria): this
      // compiles with no guard and no `!` only because `coachProcedure`
      // narrows `clientProfileId` to exactly `null`.
      clientProfileIdIsNull: ctx.user.clientProfileId === null,
    })),
    clientOnly: clientProcedure.query(({ ctx }) => ({ clientProfileId: ctx.user.clientProfileId })),
    either: coachOrClientProcedure.query(({ ctx }) => ({ role: ctx.user.role })),
  });

  return { db, redis, createContextFactory, scratchRouter };
}

let world: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  world = await setup();
}, 60_000);

afterAll(async () => {
  await world.db.$client.end();
  // See `context.test.ts`'s `afterAll` for why the listener is dropped
  // before disconnecting rather than after.
  world.redis.removeAllListeners('error');
  world.redis.on('error', () => {});
  world.redis.disconnect();
  await container.stop();
});

async function insertUser(
  role: 'coach' | 'client' | 'assistant',
  emailLocal: string,
): Promise<string> {
  const [row] = await world.db
    .insert(schema.users)
    .values({ email: `${emailLocal}@has-role-test.com`, passwordHash: 'x', name: 'Test', role })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('seed insert into users did not return a row');
  return row.id;
}

// A stub verifier that resolves straight to the given userId, bypassing
// real JWTs — the same seam `context.test.ts` uses (P03 supplies the real
// implementation).
function callerContextFor(userId: string) {
  const factory = world.createContextFactory(() => ({
    userId,
    deviceId: uuidv7(),
    expiresAt: new Date(Date.now() + 60_000),
  }));
  return factory(
    new Request('http://localhost/trpc/x', { headers: { authorization: 'Bearer t' } }),
  );
}

async function callerFor(userId: string) {
  return world.scratchRouter.createCaller(await callerContextFor(userId));
}

describe('hasRole', () => {
  it('rejects a client calling a coachProcedure with FORBIDDEN / ROLE_REQUIRED', async () => {
    const userId = await insertUser('client', 'client-a');
    const caller = await callerFor(userId);

    await expect(caller.coachOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
  });

  it('rejects a coach calling a clientProcedure with FORBIDDEN / ROLE_REQUIRED', async () => {
    const userId = await insertUser('coach', 'coach-a');
    const caller = await callerFor(userId);

    await expect(caller.clientOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
  });

  it('lets a coach with a coach_profiles row through, with coachProfileId populated and clientProfileId null', async () => {
    const userId = await insertUser('coach', 'coach-b');
    const [profile] = await world.db
      .insert(schema.coachProfiles)
      .values({ userId })
      .returning({ id: schema.coachProfiles.id });
    if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
    const caller = await callerFor(userId);

    const result = await caller.coachOnly();

    expect(result).toEqual({ coachProfileId: profile.id, clientProfileIdIsNull: true });
  });

  it("produces INTERNAL_SERVER_ERROR, not FORBIDDEN, for role='coach' with no matching coach_profiles row", async () => {
    // The data-integrity case (`02-has-role.md` step 2) — a half-created
    // account from an interrupted signup, never surfaced as a permissions
    // problem.
    const userId = await insertUser('coach', 'coach-half-created');
    const caller = await callerFor(userId);

    await expect(caller.coachOnly()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('rejects role=assistant on coachProcedure, clientProcedure, and coachOrClientProcedure alike', async () => {
    const userId = await insertUser('assistant', 'assistant-a');
    const caller = await callerFor(userId);

    await expect(caller.coachOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
    await expect(caller.clientOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
    await expect(caller.either()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
  });

  it('coachOrClientProcedure accepts both real roles and leaves ctx.user.role un-narrowed', async () => {
    const coachId = await insertUser('coach', 'coach-c');
    await world.db.insert(schema.coachProfiles).values({ userId: coachId });
    const clientId = await insertUser('client', 'client-c');

    await expect((await callerFor(coachId)).either()).resolves.toEqual({ role: 'coach' });
    await expect((await callerFor(clientId)).either()).resolves.toEqual({ role: 'client' });
  });
});
