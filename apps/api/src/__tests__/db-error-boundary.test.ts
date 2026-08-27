// Real Postgres via Testcontainers, not mocked — `testing` skill §4: "the
// whole subject is what the driver actually throws, and a mocked error
// object is a guess about that." Scratch tables and a scratch router built
// directly with `router()`/`publicProcedure` (the one exported from
// `../trpc/procedures.ts`, so the real `databaseErrorBoundary` middleware
// is attached) — never the real migrated schema or `appRouter`, matching
// `output-redaction.test.ts`'s own pattern. Some scratch constraints
// deliberately reuse a real production constraint name so
// `constraint-map.ts`'s lookups fire against the actual code paths this
// task ships, not a parallel copy of them.
import { createDbClient, type DbClient } from '@coachos/db';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { z } from 'zod';

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

  // A scratch schema, not the committed one — this feature is about the
  // boundary mechanism, not any specific product table, and building it
  // fresh keeps this test independent of coach/client/program FK setup.
  await db.execute(sql`CREATE TABLE scratch_parent (id uuid PRIMARY KEY)`);
  await db.execute(sql`
    CREATE TABLE scratch_item (
      id uuid PRIMARY KEY,
      parent_id uuid NOT NULL REFERENCES scratch_parent(id),
      short_name varchar(5) NOT NULL,
      amount integer NOT NULL CHECK (amount >= 0)
    )
  `);
  // Constraint name borrowed from identity.ts's real one on purpose — see
  // file header — so CONSTRAINT_ERROR_MAP's actual lookup table is what
  // fires, not a parallel test-only copy of it.
  await db.execute(sql`
    CREATE TABLE scratch_mapped_unique (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      CONSTRAINT client_profiles_one_active_coach UNIQUE (owner_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE scratch_unmapped_unique (
      id uuid PRIMARY KEY,
      tag text NOT NULL,
      CONSTRAINT scratch_unmapped_unique_tag_key UNIQUE (tag)
    )
  `);
  await db.execute(sql`CREATE TABLE scratch_lock (id integer PRIMARY KEY, value integer NOT NULL)`);
  await db.execute(sql`INSERT INTO scratch_lock (id, value) VALUES (1, 0), (2, 0)`);
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

// Re-spied fresh every test, not once at module load — Jest reinstalls its
// own instrumentation per test, which silently orphans a spy installed
// earlier (its `.mock.calls` stays empty even though the visible transcript
// still shows the call going through Jest's own instrumentation).
//
// `../lib/app-error.ts`'s `logDatabaseError` writes through
// `../lib/logger.ts` (`observability/01-structured-logging.md`), whose only
// sink is `process.stdout.write` — spying there, not on `console.error`, is
// what actually observes it now.
let stdoutWriteSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => stdoutWriteSpy.mockRestore());

const uuidInput = z.object({ id: z.string() });

// Neither deadlock resolver proceeds to its *second* lock until both have
// taken their *first* — see the resolvers below for why a fixed sleep
// won't do. Reassigned per-test (`createDeadlockBarrier()`) rather than a
// single top-level instance, so the pattern survives a second test reusing
// it without the Promises already being settled.
interface DeadlockBarrier {
  aLocked1: Promise<void>;
  bLocked2: Promise<void>;
  resolveALocked1: () => void;
  resolveBLocked2: () => void;
}
function createDeadlockBarrier(): DeadlockBarrier {
  let resolveALocked1!: () => void;
  let resolveBLocked2!: () => void;
  const aLocked1 = new Promise<void>((resolve) => (resolveALocked1 = resolve));
  const bLocked2 = new Promise<void>((resolve) => (resolveBLocked2 = resolve));
  return { aLocked1, bLocked2, resolveALocked1, resolveBLocked2 };
}
let deadlockBarrier = createDeadlockBarrier();

const scratchRouter = router({
  insertParent: publicProcedure.input(uuidInput).mutation(async ({ ctx, input }) => {
    await ctx.db.execute(sql`INSERT INTO scratch_parent (id) VALUES (${input.id})`);
    return { ok: true };
  }),

  // No ON CONFLICT — deliberately, to provoke 23505 rather than avoid it.
  // `id` and `ownerId` are separate inputs so two calls can collide on the
  // named `owner_id` unique constraint specifically, without also
  // colliding on the primary key (a different, uninteresting error).
  insertMappedUnique: publicProcedure
    .input(z.object({ id: z.string(), ownerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`INSERT INTO scratch_mapped_unique (id, owner_id) VALUES (${input.id}, ${input.ownerId})`,
      );
      return { ok: true };
    }),

  insertUnmappedUnique: publicProcedure
    .input(z.object({ id: z.string(), tag: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`INSERT INTO scratch_unmapped_unique (id, tag) VALUES (${input.id}, ${input.tag})`,
      );
      return { ok: true };
    }),

  insertMissingParent: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, ${input.parentId}, 'ok', 1)`,
      );
      return { ok: true };
    }),

  insertNegativeAmount: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, ${input.parentId}, 'ok', -1)`,
      );
      return { ok: true };
    }),

  insertNullName: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Raw SQL, past any application-level required-field check — this
      // boundary is the net under `03-validation-conventions.md`, not a
      // substitute for it.
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, ${input.parentId}, NULL, 1)`,
      );
      return { ok: true };
    }),

  insertLongName: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, ${input.parentId}, 'way too long', 1)`,
      );
      return { ok: true };
    }),

  insertMalformedParentId: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // `parent_id` is `uuid` — a plain non-UUID string sent as a bind
      // parameter fails on the wire with 22P02, before any FK check runs.
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, 'not-a-uuid', 'ok', 1)`,
      );
      return { ok: true };
    }),

  slowQuery: publicProcedure.mutation(async ({ ctx }) => {
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '1ms'`);
      await tx.execute(sql`SELECT pg_sleep(1)`);
    });
    return { ok: true };
  }),

  // A fixed sleep between the two locks is exactly as flaky as it sounds —
  // an explicit barrier instead: neither side attempts its *second* lock
  // until both have taken their *first*, so the deadlock is guaranteed
  // (Postgres's own detector, not this test, decides which side loses),
  // never a coin flip on scheduler timing.
  deadlockA: publicProcedure.mutation(async ({ ctx }) => {
    callCounts.deadlockA += 1;
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE scratch_lock SET value = value + 1 WHERE id = 1`);
      deadlockBarrier.resolveALocked1();
      await deadlockBarrier.bLocked2;
      await tx.execute(sql`UPDATE scratch_lock SET value = value + 1 WHERE id = 2`);
    });
    return { ok: true };
  }),

  deadlockB: publicProcedure.mutation(async ({ ctx }) => {
    callCounts.deadlockB += 1;
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE scratch_lock SET value = value + 1 WHERE id = 2`);
      deadlockBarrier.resolveBLocked2();
      await deadlockBarrier.aLocked1;
      await tx.execute(sql`UPDATE scratch_lock SET value = value + 1 WHERE id = 1`);
    });
    return { ok: true };
  }),

  // Throws a *real* `postgres.PostgresError` (same class the driver itself
  // throws — `is-database-error.ts` narrows on nothing else) rather than
  // provoking a genuine concurrent SERIALIZABLE conflict, which is exactly
  // as flaky in a fast unit test as it is in production. What's under test
  // here is the middleware's retry-once behaviour, not Postgres's own
  // conflict detector — that part is real, not simulated.
  retryThenSucceed: publicProcedure.mutation(() => {
    callCounts.retryThenSucceed += 1;
    if (callCounts.retryThenSucceed === 1) {
      throw serializationFailureError();
    }
    return { ok: true };
  }),

  alwaysSerializationFailure: publicProcedure.mutation(() => {
    callCounts.alwaysSerializationFailure += 1;
    throw serializationFailureError();
  }),

  alwaysCheckViolation: publicProcedure
    .input(z.object({ id: z.string(), parentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      callCounts.alwaysCheckViolation += 1;
      await ctx.db.execute(
        sql`INSERT INTO scratch_item (id, parent_id, short_name, amount) VALUES (${input.id}, ${input.parentId}, 'ok', -1)`,
      );
      return { ok: true };
    }),
});

// The declared constructor type only accepts `(message?, options?)` — the
// package's actual runtime constructor (`Object.assign(this, x)`, verified
// against the installed `postgres` source) takes an options bag instead,
// but the `.d.ts` doesn't say so. Building it in two steps keeps the exact
// same real-class instance `isDatabaseError`'s `instanceof` check wants,
// without a cast lying about the constructor's declared shape.
function serializationFailureError(): postgres.PostgresError {
  return Object.assign(new postgres.PostgresError('could not serialize access'), { code: '40001' });
}

const callCounts = {
  retryThenSucceed: 0,
  alwaysSerializationFailure: 0,
  alwaysCheckViolation: 0,
  deadlockA: 0,
  deadlockB: 0,
};

function caller() {
  return scratchRouter.createCaller(createTestContext({ db }));
}

// Every response, serialised, must be free of the table, constraint,
// column, and value a real Postgres error carries (step 7) — asserted on
// absence, not just on the code being right (Verification section).
function assertNoLeak(payload: unknown, forbidden: string[]) {
  const serialised = JSON.stringify(payload);
  for (const term of forbidden) {
    expect(serialised).not.toContain(term);
  }
}

// `createCaller()` throws the raw `TRPCError` — `appCode` lives at
// `.cause.appCode` (set by `appError()`), not `.data.appCode`, which only
// exists after the wire-level `errorFormatter` runs (the HTTP adapter's
// job, exercised separately by `error-formatter.test.ts`). This boundary
// is what's under test here, so this is the correct property to read.
function appCodeOf(error: unknown): string | undefined {
  return (error as { cause?: { appCode?: string } }).cause?.appCode;
}

describe('databaseErrorBoundary — unique_violation (23505)', () => {
  it('a mapped constraint returns the specific catalogued code, not a bare CONFLICT', async () => {
    const ownerId = '11111111-1111-7111-8111-111111111111';
    await caller().insertMappedUnique({ id: '22222222-2222-7222-8222-222222222222', ownerId });

    let response: unknown;
    try {
      // Different primary key, same owner_id — collides on the named
      // unique constraint specifically, not the primary key.
      await caller().insertMappedUnique({ id: '33333333-3333-7333-8333-333333333333', ownerId });
      throw new Error('expected a unique violation');
    } catch (e) {
      response = e;
      expect(appCodeOf(e)).toBe('CLIENT_ALREADY_HAS_COACH');
    }
    assertNoLeak(response, ['client_profiles_one_active_coach', 'scratch_mapped_unique', ownerId]);
  });

  it('an unmapped constraint returns the generic UNKNOWN_CONFLICT and logs the constraint name server-side', async () => {
    const id = '33333333-3333-7333-8333-333333333333';
    await caller().insertUnmappedUnique({ id, tag: 'same-tag' });

    let response: unknown;
    try {
      await caller().insertUnmappedUnique({
        id: '44444444-4444-7444-8444-444444444444',
        tag: 'same-tag',
      });
      throw new Error('expected a unique violation');
    } catch (e) {
      response = e;
      expect(appCodeOf(e)).toBe('UNKNOWN_CONFLICT');
    }

    assertNoLeak(response, [
      'scratch_unmapped_unique_tag_key',
      'same-tag',
      'scratch_unmapped_unique',
    ]);

    const logged = stdoutWriteSpy.mock.calls.flat().map((c: unknown) => JSON.stringify(c));
    expect(logged.some((l: string) => l.includes('scratch_unmapped_unique_tag_key'))).toBe(true);
  });
});

describe('databaseErrorBoundary — FK, CHECK, not-null, truncation, invalid representation', () => {
  const parentId = '55555555-5555-7555-8555-555555555555';

  beforeAll(async () => {
    await caller().insertParent({ id: parentId });
  });

  it('foreign_key_violation (23503) → VALIDATION_FAILED, no table/column/value leaked', async () => {
    const missingParentId = '66666666-6666-7666-8666-666666666666';
    let response: unknown;
    try {
      await caller().insertMissingParent({
        id: '77777777-7777-7777-8777-777777777777',
        parentId: missingParentId,
      });
      throw new Error('expected a foreign key violation');
    } catch (e) {
      response = e;
      expect(appCodeOf(e)).toBe('VALIDATION_FAILED');
    }
    assertNoLeak(response, ['scratch_item', 'parent_id', missingParentId]);
  });

  it('check_violation (23514) → VALIDATION_FAILED', async () => {
    try {
      await caller().insertNegativeAmount({ id: '88888888-8888-7888-8888-888888888888', parentId });
      throw new Error('expected a check violation');
    } catch (e) {
      expect(appCodeOf(e)).toBe('VALIDATION_FAILED');
    }
  });

  it('not_null_violation (23502) → VALIDATION_FAILED', async () => {
    try {
      await caller().insertNullName({ id: '99999999-9999-7999-8999-999999999999', parentId });
      throw new Error('expected a not-null violation');
    } catch (e) {
      expect(appCodeOf(e)).toBe('VALIDATION_FAILED');
    }
  });

  it('string_data_right_truncation (22001) → VALIDATION_FAILED', async () => {
    try {
      await caller().insertLongName({ id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', parentId });
      throw new Error('expected a truncation violation');
    } catch (e) {
      expect(appCodeOf(e)).toBe('VALIDATION_FAILED');
    }
  });

  it('invalid_text_representation (22P02) → VALIDATION_FAILED, malformed value not echoed back', async () => {
    let response: unknown;
    try {
      await caller().insertMalformedParentId({ id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb' });
      throw new Error('expected an invalid text representation error');
    } catch (e) {
      response = e;
      expect(appCodeOf(e)).toBe('VALIDATION_FAILED');
    }
    assertNoLeak(response, ['not-a-uuid']);
  });
});

describe('databaseErrorBoundary — retry-once behaviour (step 5)', () => {
  it('retries a serialization failure exactly once, then succeeds', async () => {
    callCounts.retryThenSucceed = 0;
    const result = await caller().retryThenSucceed();
    expect(result).toEqual({ ok: true });
    expect(callCounts.retryThenSucceed).toBe(2); // the failing attempt, then the one retry
  });

  it('a serialization failure that never clears surfaces as a catalogued conflict after exactly one retry', async () => {
    callCounts.alwaysSerializationFailure = 0;
    await expect(caller().alwaysSerializationFailure()).rejects.toMatchObject({
      cause: { appCode: 'SYNC_CONFLICT' },
    });
    expect(callCounts.alwaysSerializationFailure).toBe(2); // original attempt + one retry, never a third
  });

  it('a CHECK violation is never retried', async () => {
    callCounts.alwaysCheckViolation = 0;
    await expect(
      caller().alwaysCheckViolation({
        id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        parentId: '55555555-5555-7555-8555-555555555555',
      }),
    ).rejects.toBeDefined();
    expect(callCounts.alwaysCheckViolation).toBe(1);
  });
});

describe('databaseErrorBoundary — a real dual-transaction deadlock', () => {
  it('the side Postgres aborts is retried once (40P01 is retryable, step 5) and both ultimately succeed', async () => {
    deadlockBarrier = createDeadlockBarrier();
    callCounts.deadlockA = 0;
    callCounts.deadlockB = 0;

    const results = await Promise.allSettled([caller().deadlockA(), caller().deadlockB()]);

    // Both succeed: whichever side Postgres's own detector aborts gets
    // exactly one retry via the same mechanism `alwaysSerializationFailure`
    // above already proves — and because the abort rolls back its whole
    // transaction, the retry redoes both of that side's updates cleanly
    // once the winner has released its locks. Neither side is silently
    // dropped or double-applied.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Proof a genuine deadlock actually happened, not two clean runs: one
    // side's resolver ran twice (original + retry), the other once.
    expect(callCounts.deadlockA + callCounts.deadlockB).toBe(3);
    expect([callCounts.deadlockA, callCounts.deadlockB].includes(2)).toBe(true);

    // Each row was updated by both transactions exactly once — the
    // rollback-then-retry did not double-apply the retried side's work.
    const rows = await db.execute(sql`SELECT id, value FROM scratch_lock ORDER BY id`);
    expect(rows.map((r) => (r as { value: number }).value)).toEqual([2, 2]);
  }, 20_000);
});

describe('databaseErrorBoundary — statement timeout (57014)', () => {
  it('query_canceled → INTERNAL_ERROR', async () => {
    await expect(caller().slowQuery()).rejects.toMatchObject({
      cause: { appCode: 'INTERNAL_ERROR' },
    });
  });
});

describe('databaseErrorBoundary — nothing raw ever reaches the log either', () => {
  it('no log line contains detail, where, or internal_query', async () => {
    stdoutWriteSpy.mockClear();
    // Same owner_id the first describe block already used — the row
    // exists, so this collides on the mapped constraint again.
    await expect(
      caller().insertMappedUnique({
        id: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
        ownerId: '11111111-1111-7111-8111-111111111111',
      }),
    ).rejects.toBeDefined();
    const logged = stdoutWriteSpy.mock.calls.flat().map((c: unknown) => JSON.stringify(c));
    for (const line of logged) {
      expect(line).not.toMatch(/"detail"|"where"|"internal_query"/);
    }
  });
});
