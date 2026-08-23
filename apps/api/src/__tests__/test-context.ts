import type { DbClient } from '@coachos/db';

import { redis } from '../lib/redis.ts';
import { createOwnershipCache } from '../trpc/authz/ownership-cache.ts';
import type { Context, ContextUser } from '../trpc/context.ts';

// The shared helper every procedure test imports (`testing` skill §4):
// `const ctx = await createTestContext({ db, user: coachA })`. `db` is
// required — there's no shared global test database yet, so each test
// file supplies the connection its own Testcontainers `beforeAll` created
// (see `context.test.ts` for the pattern). A future phase that adds one
// global test database can default `db` from it without changing this
// signature for existing callers.
export function createTestContext(opts: {
  db: DbClient;
  user?: ContextUser | null;
  requestId?: string;
}): Context {
  return {
    user: opts.user ?? null,
    db: opts.db,
    // The real singleton (`lib/redis.ts`), `lazyConnect`-ed — importing it
    // does not open a connection, so this stays safe for every test in this
    // suite that never touches Redis. A test that does needs Redis running
    // (`redis-fail-open.test.ts`'s dead-port client is a separate instance,
    // not this one).
    redis,
    requestId: opts.requestId ?? '00000000-0000-7000-8000-000000000000',
    request: { ip: null, userAgent: null, receivedAt: new Date('2026-01-01T00:00:00Z') },
    ownershipCache: createOwnershipCache(),
  };
}
