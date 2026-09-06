// Real Postgres via Testcontainers — `03-owns-resource.md`'s Verification
// section: the queries *are* the security control, so mocking Drizzle would
// test the mock. Covers the matrix (own / foreign / same-coach-different-
// client / nonexistent / soft-deleted / post-transfer) across a
// representative slice of the ten registry kinds, plus the properties that
// don't vary by kind: response identity, array-batch all-or-nothing, the
// per-request memo, and `coachNote`'s structural absence of a client
// branch.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { schema } from '@coachos/db';
import { eq, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

import { createTwoCoachesFixture } from '../fixtures/two-coaches.ts';

let container: StartedTestContainer;

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

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential
  process.env.DATABASE_URL = connectionString;

  // `callerContextFor` below drives every matrix case through the real
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
  const { coachOrClientProcedure } = await import('../../trpc/procedures.ts');
  const { ownsResource } = await import('../../trpc/middleware/owns-resource.ts');
  const { redis } = await import('../../lib/redis.ts');

  const db = (await createContextFactory()(new Request('http://localhost/trpc/health.ping'))).db;

  // `TInput` on `ownsResource` can't be inferred backward through the
  // `.use()` call the way an *inline* middleware's `input` can — verified
  // against the compiler, not assumed (`03-owns-resource.md`'s own
  // Interfaces note: chain order matters for tRPC's own inference, and a
  // standalone factory sits one call outside of it). An explicit parameter
  // annotation on each selector is what restores it; every router that
  // uses `ownsResource` follows this same one-line convention.
  const scratchRouter = router({
    workoutSessionOwned: coachOrClientProcedure
      .input(z.object({ workoutSessionId: z.string() }))
      .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
      .query(() => ({ ok: true })),
    workoutSessionOwnedTwice: coachOrClientProcedure
      .input(z.object({ workoutSessionId: z.string() }))
      .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
      .use(ownsResource('workoutSession', (i: { workoutSessionId: string }) => i.workoutSessionId))
      .query(() => ({ ok: true })),
    workoutSessionsOwnedBatch: coachOrClientProcedure
      .input(z.object({ workoutSessionIds: z.array(z.string()) }))
      .use(
        ownsResource('workoutSession', (i: { workoutSessionIds: string[] }) => i.workoutSessionIds),
      )
      .query(() => ({ ok: true })),
    setLogOwned: coachOrClientProcedure
      .input(z.object({ setLogId: z.string() }))
      .use(ownsResource('setLog', (i: { setLogId: string }) => i.setLogId))
      .query(() => ({ ok: true })),
    commentOwned: coachOrClientProcedure
      .input(z.object({ commentId: z.string() }))
      .use(ownsResource('comment', (i: { commentId: string }) => i.commentId))
      .query(() => ({ ok: true })),
    mediaAssetOwned: coachOrClientProcedure
      .input(z.object({ mediaAssetId: z.string() }))
      .use(ownsResource('mediaAsset', (i: { mediaAssetId: string }) => i.mediaAssetId))
      .query(() => ({ ok: true })),
    coachNoteOwned: coachOrClientProcedure
      .input(z.object({ coachNoteId: z.string() }))
      .use(ownsResource('coachNote', (i: { coachNoteId: string }) => i.coachNoteId))
      .query(() => ({ ok: true })),
  });

  const fixture = await createTwoCoachesFixture(db);

  return { db, redis, createContextFactory, scratchRouter, fixture };
}

let world: Awaited<ReturnType<typeof setup>>;

beforeAll(async () => {
  world = await setup();
}, 90_000);

afterAll(async () => {
  await world.db.$client.end();
  // See `context.test.ts`'s `afterAll` for why there's no `.disconnect()`
  // and why the listener is dropped anyway.
  world.redis.removeAllListeners('error');
  world.redis.on('error', () => {});
  await container.stop();
}, 90_000);

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

const NONEXISTENT_ID = '00000000-0000-7000-8000-000000000000';

describe('ownsResource — the matrix', () => {
  it('passes for the owning coach and the owning client (own row)', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);
    const client = await callerFor(world.fixture.clientA1.userId);

    await expect(
      coach.workoutSessionOwned({ workoutSessionId: world.fixture.clientA1.workoutSessionId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.workoutSessionOwned({ workoutSessionId: world.fixture.clientA1.workoutSessionId }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects coach A and client A1 on coach B's client's row, with NOT_YOUR_CLIENT", async () => {
    const coach = await callerFor(world.fixture.coachA.userId);
    const client = await callerFor(world.fixture.clientA1.userId);

    await expect(
      coach.workoutSessionOwned({ workoutSessionId: world.fixture.clientB1.workoutSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
    await expect(
      client.workoutSessionOwned({ workoutSessionId: world.fixture.clientB1.workoutSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('lets the coach reach another of their own clients, but rejects a client reaching a sibling client', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);
    const client = await callerFor(world.fixture.clientA1.userId);

    await expect(
      coach.workoutSessionOwned({ workoutSessionId: world.fixture.clientA2.workoutSessionId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.workoutSessionOwned({ workoutSessionId: world.fixture.clientA2.workoutSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('rejects a well-formed id that has never existed with NOT_YOUR_CLIENT — the same code as a foreign row', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);

    await expect(
      coach.workoutSessionOwned({ workoutSessionId: NONEXISTENT_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('serialises the foreign-row and the nonexistent-row rejection identically — no oracle', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);

    const foreign = await coach
      .workoutSessionOwned({ workoutSessionId: world.fixture.clientB1.workoutSessionId })
      .catch((e: unknown) => e);
    const nonexistent = await coach
      .workoutSessionOwned({ workoutSessionId: NONEXISTENT_ID })
      .catch((e: unknown) => e);

    expect(JSON.stringify(foreign)).toBe(JSON.stringify(nonexistent));
  });

  it('ignores deleted_at — a soft-deleted own row still passes', async () => {
    await world.db
      .update(schema.workoutSessions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workoutSessions.id, world.fixture.clientA1.workoutSessionId));

    const coach = await callerFor(world.fixture.coachA.userId);
    await expect(
      coach.workoutSessionOwned({ workoutSessionId: world.fixture.clientA1.workoutSessionId }),
    ).resolves.toEqual({ ok: true });

    await world.db
      .update(schema.workoutSessions)
      .set({ deletedAt: null })
      .where(eq(schema.workoutSessions.id, world.fixture.clientA1.workoutSessionId));
  });

  it('reflects a client transfer with no cache-expiry delay — the old coach loses access, the new one gains it', async () => {
    // DB§19.2's real transfer procedure isn't built until a later phase;
    // rewriting `coach_id` directly is what it will do under the hood.
    // `training.workout_sessions.coach_id` is protected by a guard trigger
    // (DB§6) that rejects any UPDATE outside `SET LOCAL
    // app.allow_owner_change = true` — the sanctioned escape hatch the real
    // transfer procedure will use — so this whole rewrite runs as one
    // transaction with that flag set, and try/finally guarantees the revert
    // runs even if an assertion below throws, so a failure here can't
    // corrupt every test that follows.
    async function setClientACoach(coachProfileId: string): Promise<void> {
      await world.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.allow_owner_change = true`);
        await tx
          .update(schema.clientProfiles)
          .set({ coachId: coachProfileId })
          .where(eq(schema.clientProfiles.id, world.fixture.clientA1.profileId));
        await tx
          .update(schema.workoutSessions)
          .set({ coachId: coachProfileId })
          .where(eq(schema.workoutSessions.id, world.fixture.clientA1.workoutSessionId));
      });
    }

    await setClientACoach(world.fixture.coachB.profileId);
    try {
      const previousCoach = await callerFor(world.fixture.coachA.userId);
      const newCoach = await callerFor(world.fixture.coachB.userId);

      await expect(
        previousCoach.workoutSessionOwned({
          workoutSessionId: world.fixture.clientA1.workoutSessionId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
      await expect(
        newCoach.workoutSessionOwned({ workoutSessionId: world.fixture.clientA1.workoutSessionId }),
      ).resolves.toEqual({ ok: true });
    } finally {
      await setClientACoach(world.fixture.coachA.profileId);
    }
  });

  it('answers ownership the same way through the join-shaped kinds (setLog, comment) and the dual-condition kind (mediaAsset)', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);
    const client = await callerFor(world.fixture.clientA1.userId);

    await expect(coach.setLogOwned({ setLogId: world.fixture.clientA1.setLogId })).resolves.toEqual(
      {
        ok: true,
      },
    );
    await expect(
      client.commentOwned({ commentId: world.fixture.clientA1.commentId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.mediaAssetOwned({ mediaAssetId: world.fixture.clientA1.mediaAssetId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      coach.setLogOwned({ setLogId: world.fixture.clientB1.setLogId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it("coachNote has no client-side ownership branch — a client is refused even for their own coach's note on them", async () => {
    const coach = await callerFor(world.fixture.coachA.userId);
    const client = await callerFor(world.fixture.clientA1.userId);

    await expect(
      coach.coachNoteOwned({ coachNoteId: world.fixture.coachA.coachNoteId }),
    ).resolves.toEqual({ ok: true });
    await expect(
      client.coachNoteOwned({ coachNoteId: world.fixture.coachA.coachNoteId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'ROLE_REQUIRED' } });
  });

  it('rejects the whole call when an array selector mixes one foreign id among owned ones', async () => {
    const coach = await callerFor(world.fixture.coachA.userId);

    await expect(
      coach.workoutSessionsOwnedBatch({
        workoutSessionIds: [
          world.fixture.clientA1.workoutSessionId,
          world.fixture.clientA2.workoutSessionId,
          world.fixture.clientB1.workoutSessionId,
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });

    await expect(
      coach.workoutSessionsOwnedBatch({
        workoutSessionIds: [
          world.fixture.clientA1.workoutSessionId,
          world.fixture.clientA2.workoutSessionId,
        ],
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('ownsResource — query count', () => {
  // Spies on the registry entry itself rather than the wire protocol — "one
  // statement" is a property of how many times `RESOURCE_REGISTRY.
  // workoutSession.coachOwnedIds` runs, not of how many messages the
  // Postgres extended-query protocol happens to split one call into.
  // Restored after every test so the real function backs every other test
  // in this file.
  async function countCoachOwnedIdsCalls(run: () => Promise<unknown>): Promise<number> {
    const { RESOURCE_REGISTRY } = await import('../../trpc/authz/resource-registry.ts');
    const original = RESOURCE_REGISTRY.workoutSession.coachOwnedIds;
    let calls = 0;
    RESOURCE_REGISTRY.workoutSession.coachOwnedIds = async (...args) => {
      calls += 1;
      return original(...args);
    };

    try {
      await run();
    } finally {
      RESOURCE_REGISTRY.workoutSession.coachOwnedIds = original;
    }
    return calls;
  }

  it('resolves ownership once for two guards on one procedure resolving the same id', async () => {
    const caller = await callerFor(world.fixture.coachA.userId);

    const calls = await countCoachOwnedIdsCalls(() =>
      caller.workoutSessionOwnedTwice({
        workoutSessionId: world.fixture.clientA1.workoutSessionId,
      }),
    );

    expect(calls).toBe(1);
  });

  it('resolves ownership once for an array of ids, not once per id', async () => {
    const caller = await callerFor(world.fixture.coachA.userId);

    const calls = await countCoachOwnedIdsCalls(() =>
      caller.workoutSessionsOwnedBatch({
        workoutSessionIds: [
          world.fixture.clientA1.workoutSessionId,
          world.fixture.clientA2.workoutSessionId,
        ],
      }),
    );

    expect(calls).toBe(1);
  });
});
