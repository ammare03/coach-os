// Proves `03-validation-conventions.md` step 5's rule holds — an `.output()`
// schema strips a field it doesn't name — and proves the negative too
// (Verification section): the same resolver, called through a router with
// no `.output()` attached, returns the field verbatim. A test that only
// checks the gated case passes against a broken gate. Two scratch routers
// built directly with `router()`/`publicProcedure`, never registered on the
// real `appRouter` — no Postgres needed, so no Testcontainers here.
import { z } from 'zod';

import type { Context } from '../trpc/context.ts';
import { publicProcedure, router } from '../trpc/init.ts';

// Simulates a resolver that returns a full row (`identity.users`-shaped)
// instead of mapping fields explicitly — exactly the mistake step 6 warns
// against, and exactly what an `.output()` gate exists to catch.
function resolveRow() {
  return { id: 'user_1', email: 'coach@example.com', passwordHash: 'argon2id$...' };
}

const gatedRouter = router({
  get: publicProcedure.output(z.object({ id: z.string(), email: z.string() })).query(resolveRow),
});

const ungatedRouter = router({
  get: publicProcedure.query(resolveRow),
});

describe('.output() as a redaction gate', () => {
  it('strips a field the schema does not name', async () => {
    const caller = gatedRouter.createCaller({} as Context);

    const result = await caller.get();

    expect(result).toEqual({ id: 'user_1', email: 'coach@example.com' });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('passes the same field through verbatim with no gate attached — proving the gate, not luck, did the stripping', async () => {
    const caller = ungatedRouter.createCaller({} as Context);

    const result = await caller.get();

    expect(result).toMatchObject({ passwordHash: 'argon2id$...' });
  });
});
