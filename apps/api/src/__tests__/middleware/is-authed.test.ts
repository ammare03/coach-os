// No Postgres needed — `01-is-authed.md`'s Verification section: this
// middleware's whole value is the guard clause and the type narrowing, and
// neither needs a real database. A scratch router built on the real
// `protectedProcedure` (so the actual middleware chain runs, including
// `databaseErrorBoundary`), fed by `createTestContext` with a poisoned
// `db` — if `isAuthed` ever touches `ctx.db`, the resolver below fails.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { DbClient } from '@coachos/db';

import { router } from '../../trpc/init.ts';
import { protectedProcedure, publicProcedure } from '../../trpc/procedures.ts';
import { createTestContext } from '../test-context.ts';

// Records property access rather than throwing, so the assertion reads as
// "zero queries" (the acceptance criterion's own words) instead of "did not
// crash" — a proxy that throws would make a genuine touch look like an
// unrelated failure.
function createUntouchedDb(): { db: DbClient; touchedProps: string[] } {
  const touchedProps: string[] = [];
  const db = new Proxy(() => undefined, {
    get(_target, prop) {
      touchedProps.push(String(prop));
      return undefined;
    },
  });
  return { db: db as unknown as DbClient, touchedProps };
}

const scratchRouter = router({
  whoAmI: protectedProcedure.query(({ ctx }) => ({ userId: ctx.user.id })),
});

const coachA = {
  id: '00000000-0000-7000-8000-00000000c0a1',
  email: 'coach-a@is-authed-test.com',
  role: 'coach' as const,
  timezone: 'UTC',
  locale: 'en',
  coachProfileId: '00000000-0000-7000-8000-00000000c0a2',
  clientProfileId: null,
  deletedAt: null,
};

describe('isAuthed', () => {
  it('rejects a null user with UNAUTHORIZED / AUTH_REQUIRED', async () => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(createTestContext({ db, user: null }));

    await expect(caller.whoAmI()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: 'AUTH_REQUIRED' },
    });
  });

  it('lets the resolver run and receive the same user object when ctx.user is populated', async () => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(createTestContext({ db, user: coachA }));

    const result = await caller.whoAmI();

    expect(result.userId).toBe(coachA.id);
  });

  it('issues zero database queries', async () => {
    const { db, touchedProps } = createUntouchedDb();
    const caller = scratchRouter.createCaller(createTestContext({ db, user: coachA }));

    await caller.whoAmI();

    expect(touchedProps).toEqual([]);
  });

  it('does not run for publicProcedure — health.ping style resolvers stay reachable with no token', async () => {
    const publicScratch = router({
      ping: publicProcedure.query(() => ({ ok: true })),
    });
    const { db } = createUntouchedDb();
    const caller = publicScratch.createCaller(createTestContext({ db, user: null }));

    await expect(caller.ping()).resolves.toEqual({ ok: true });
  });
});

// `01-is-authed.md` acceptance criteria: "No resolver anywhere in
// `apps/api` contains an `if (!ctx.user)` guard; a grep confirms it." A
// resolver re-checking auth inline is dead code once `isAuthed` is
// attached, and it's the exact pattern that lets someone later move the
// resolver onto `publicProcedure` and believe it's still guarded.
describe('no resolver re-checks authentication inline', () => {
  it('contains no "if (!ctx.user)" guard anywhere under apps/api/src/routers', () => {
    // Scoped to `routers/` deliberately — `isAuthed` itself is the one
    // sanctioned place this guard exists (`trpc/middleware/is-authed.ts`).
    const root = path.join(__dirname, '..', '..', 'routers');
    const files = globSync('**/*.ts', { cwd: root });

    const offenders = files.filter((file) =>
      readFileSync(path.join(root, file), 'utf8').includes('if (!ctx.user)'),
    );

    expect(offenders).toEqual([]);
  });
});
