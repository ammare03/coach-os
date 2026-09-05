// DB§14.1 step 4: a unique violation on `client_local_id` is a success, not
// an error, both through the upsert path (`.onConflictDoUpdate()` — never
// raises 23505 at all) and the catch path (a plain `INSERT` + `isReplayViolation()`
// + a re-select, `../db/error-boundary.ts`'s documented fallback for a
// resolver that hasn't adopted the upsert yet). CLAUDE.md §25.12: if this is
// wrong, the offline outbox retries forever and a client loses a training
// session — the single riskiest behaviour in this feature, verified here
// against real Postgres, including the concurrent case the catch path
// exists for.
import { createDbClient, type DbClient } from '@coachos/db';
import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

import { isReplayViolation } from '../db/error-boundary.ts';
import { router } from '../trpc/init.ts';
import { publicProcedure } from '../trpc/procedures.ts';

import { createTestContext } from './test-context.ts';

let container: StartedTestContainer;
let db: DbClient;

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

  db = createDbClient({ connectionString, sslMode: false });

  // Scratch tables, each named with a *real* REPLAY_CONSTRAINTS entry so
  // `isReplayViolation()` recognises the violation via the actual code
  // path this task ships, not a parallel test-only copy of it.
  await db.execute(sql`
    CREATE TABLE scratch_upsert_replay (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      client_local_id uuid NOT NULL,
      value text NOT NULL,
      CONSTRAINT set_logs_client_local UNIQUE (owner_id, client_local_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE scratch_catch_replay (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      client_local_id uuid NOT NULL,
      value text NOT NULL,
      CONSTRAINT meals_client_local UNIQUE (owner_id, client_local_id)
    )
  `);
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

const replayInput = z.object({
  id: z.string(),
  ownerId: z.string(),
  clientLocalId: z.string(),
  value: z.string(),
});

const scratchRouter = router({
  // The primary defence (step 4): the row this returns is the row that
  // exists after the call, whether this was the first attempt or the
  // tenth — Postgres resolves the conflict inline, never raising 23505.
  upsertItem: publicProcedure.input(replayInput).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db.execute(sql`
      INSERT INTO scratch_upsert_replay (id, owner_id, client_local_id, value)
      VALUES (${input.id}, ${input.ownerId}, ${input.clientLocalId}, ${input.value})
      ON CONFLICT (owner_id, client_local_id) DO UPDATE SET value = EXCLUDED.value
      RETURNING id, owner_id, client_local_id, value
    `);
    return row;
  }),

  // The net (step 4): a resolver that issues a plain INSERT catches the
  // replay specifically via `isReplayViolation()` and re-selects the row
  // it already wrote — success either way, never surfaced as an error.
  catchAndReselectItem: publicProcedure.input(replayInput).mutation(async ({ ctx, input }) => {
    try {
      const [row] = await ctx.db.execute(sql`
        INSERT INTO scratch_catch_replay (id, owner_id, client_local_id, value)
        VALUES (${input.id}, ${input.ownerId}, ${input.clientLocalId}, ${input.value})
        RETURNING id, owner_id, client_local_id, value
      `);
      return row;
    } catch (e) {
      if (!isReplayViolation(e)) {
        throw e;
      }
      const [row] = await ctx.db.execute(sql`
        SELECT id, owner_id, client_local_id, value FROM scratch_catch_replay
        WHERE owner_id = ${input.ownerId} AND client_local_id = ${input.clientLocalId}
      `);
      return row;
    }
  }),
});

function caller() {
  return scratchRouter.createCaller(createTestContext({ db }));
}

describe('idempotent replay — the upsert path', () => {
  it('the same clientLocalId twice returns success twice, one row, identical payloads', async () => {
    const args = {
      id: '11111111-1111-7111-8111-111111111111',
      ownerId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      clientLocalId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      value: 'first',
    };

    const first = await caller().upsertItem(args);
    const second = await caller().upsertItem({
      ...args,
      id: '22222222-2222-7222-8222-222222222222',
    });

    expect(first).toBeDefined();
    expect(first).toMatchObject({ owner_id: args.ownerId, client_local_id: args.clientLocalId });
    // Guarded by the assertion above — `RETURNING` on a successful upsert
    // always yields exactly one row.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by the toBeDefined() above
    expect(second).toMatchObject(first!);

    const rows = await db.execute(
      sql`SELECT * FROM scratch_upsert_replay WHERE owner_id = ${args.ownerId} AND client_local_id = ${args.clientLocalId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('two concurrent calls with the same clientLocalId still produce exactly one row', async () => {
    const args = {
      ownerId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      clientLocalId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      value: 'concurrent',
    };

    const results = await Promise.all([
      caller().upsertItem({ ...args, id: '33333333-3333-7333-8333-333333333333' }),
      caller().upsertItem({ ...args, id: '44444444-4444-7444-8444-444444444444' }),
    ]);

    expect(results[0]).toMatchObject({
      owner_id: args.ownerId,
      client_local_id: args.clientLocalId,
    });
    expect(results[1]).toMatchObject({
      owner_id: args.ownerId,
      client_local_id: args.clientLocalId,
    });

    const rows = await db.execute(
      sql`SELECT * FROM scratch_upsert_replay WHERE owner_id = ${args.ownerId} AND client_local_id = ${args.clientLocalId}`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('idempotent replay — the catch-and-reselect path (isReplayViolation)', () => {
  it('the same clientLocalId twice returns success twice, one row, identical payloads', async () => {
    const args = {
      id: '55555555-5555-7555-8555-555555555555',
      ownerId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
      clientLocalId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
      value: 'first',
    };

    const first = await caller().catchAndReselectItem(args);
    const second = await caller().catchAndReselectItem({
      ...args,
      id: '66666666-6666-7666-8666-666666666666',
    });

    expect(first).toBeDefined();
    expect(first).toMatchObject({ owner_id: args.ownerId, client_local_id: args.clientLocalId });
    // Guarded by the assertion above — the insert-or-reselect path always
    // yields exactly one row.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by the toBeDefined() above
    expect(second).toMatchObject(first!);

    const rows = await db.execute(
      sql`SELECT * FROM scratch_catch_replay WHERE owner_id = ${args.ownerId} AND client_local_id = ${args.clientLocalId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('two concurrent calls with the same clientLocalId still produce exactly one row', async () => {
    const args = {
      ownerId: '77777777-7777-7777-8777-777777777777',
      clientLocalId: '88888888-8888-7888-8888-888888888888',
      value: 'concurrent',
    };

    const results = await Promise.all([
      caller().catchAndReselectItem({ ...args, id: '99999999-9999-7999-8999-999999999999' }),
      caller().catchAndReselectItem({ ...args, id: 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee' }),
    ]);

    expect(results[0]).toMatchObject({
      owner_id: args.ownerId,
      client_local_id: args.clientLocalId,
    });
    expect(results[1]).toMatchObject({
      owner_id: args.ownerId,
      client_local_id: args.clientLocalId,
    });

    const rows = await db.execute(
      sql`SELECT * FROM scratch_catch_replay WHERE owner_id = ${args.ownerId} AND client_local_id = ${args.clientLocalId}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('a non-replay error still propagates — isReplayViolation is not a blanket catch', async () => {
    // A malformed UUID never reaches the unique constraint at all — 22P02,
    // not 23505 — so `isReplayViolation` must say no and let it through.
    await expect(
      caller().catchAndReselectItem({
        id: 'bbbbbbbb-cccc-7ddd-8eee-ffffffffffff',
        ownerId: 'not-a-uuid',
        clientLocalId: 'cccccccc-dddd-7eee-8fff-000000000000',
        value: 'x',
      }),
    ).rejects.toBeDefined();
  });
});
