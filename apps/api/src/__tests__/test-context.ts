import type { DbClient } from '@coachos/db';

import { createOwnershipCache } from '../trpc/authz/ownership-cache.ts';
import type { Context, ContextUser, RedisLike } from '../trpc/context.ts';

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
    // No test in this feature exercises Redis directly — see
    // `context.test.ts`'s fail-open coverage. A test that does needs a
    // real client, not this throwing placeholder.
    redis: unavailableRedis,
    requestId: opts.requestId ?? '00000000-0000-7000-8000-000000000000',
    request: { ip: null, userAgent: null, receivedAt: new Date('2026-01-01T00:00:00Z') },
    ownershipCache: createOwnershipCache(),
  };
}

const unavailableRedis: RedisLike = {
  async get() {
    throw new Error(
      'createTestContext does not wire up Redis — pass a real client via the test itself',
    );
  },
};
