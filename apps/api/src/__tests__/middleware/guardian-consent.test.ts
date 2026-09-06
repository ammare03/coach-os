// No Postgres and no Redis (`guardian-consent/03`'s Verification: "all
// pure, no navigator and no HTTP"). The gate's whole content is one
// predicate over two fields the context factory has already resolved, so
// what needs proving is which builders carry it and what each of the four
// account states gets back — neither of which needs a database. The scratch
// router below is built on the real exported builders, so the actual
// middleware chain runs, and `ctx.db` is a proxy that records any access:
// a gate that ever issued a query would show up as a non-empty
// `touchedProps`.
//
// The end-to-end half — accept as a 15-year-old, get blocked, confirm, and
// succeed on the *same access token* — lives in
// `../../features/invites/confirm-guardian-consent.test.ts`, next to the
// unblock it depends on and inside the containers that suite already runs.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { DbClient } from '@coachos/db';
import { APP_ERROR_TRPC_CODE } from '@coachos/schemas';

import type { ContextUser } from '../../trpc/context.ts';
import { router } from '../../trpc/init.ts';
import {
  clientProcedure,
  coachOrClientProcedure,
  coachProcedure,
  protectedProcedure,
  publicProcedure,
} from '../../trpc/procedures.ts';
import { createTestContext } from '../test-context.ts';

// Same recorder as `./is-authed.test.ts` — records rather than throws, so
// "zero queries" reads as an assertion instead of an unrelated crash.
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

// The logger writes one JSON object per line to stdout, so the emitted
// level is only observable there — spying on `logger.info` would prove the
// call, not the line.
function parseLogLines(
  chunks: string[],
): { level: string; msg: string; userId?: string; procedure?: string }[] {
  return chunks
    .join('')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{'))
    .map(
      (line) =>
        JSON.parse(line) as { level: string; msg: string; userId?: string; procedure?: string },
    );
}

const scratchRouter = router({
  // Gated.
  gatedClient: clientProcedure.query(() => ({ reached: true })),
  gatedEither: coachOrClientProcedure.query(() => ({ reached: true })),
  // Ungated, deliberately: `me.get` and the deletion path hang off
  // `protectedProcedure`, and `auth.refresh` / `auth.signOut` off
  // `publicProcedure` (`../../trpc/procedures.ts`).
  ungatedProtected: protectedProcedure.query(() => ({ reached: true })),
  ungatedPublic: publicProcedure.query(() => ({ reached: true })),
  coachOnly: coachProcedure.query(() => ({ reached: true })),
});

const GATED = ['gatedClient', 'gatedEither'] as const;
const UNGATED = ['ungatedProtected', 'ungatedPublic'] as const;

function clientUser(overrides: Pick<ContextUser, 'isMinor' | 'guardianConsentAt'>): ContextUser {
  return {
    id: '00000000-0000-7000-8000-00000000c111',
    email: 'teen@guardian-consent-test.com',
    role: 'client',
    timezone: 'UTC',
    locale: 'en',
    coachProfileId: null,
    clientProfileId: '00000000-0000-7000-8000-00000000c112',
    deletedAt: null,
    ...overrides,
  };
}

const CONSENTED_AT = new Date('2026-03-01T00:00:00Z');

// The four states an account can be in on this axis. The adult and the
// aged-out minor are deliberately identical field-for-field: that identity
// *is* the guarantee `jobs/age-sweep.ts` relies on — clearing `is_minor` on
// the 18th birthday unblocks the account without any consent row ever
// being written, and without this middleware needing to know the sweep
// exists.
const STATES = [
  { label: 'an adult client', isMinor: false, guardianConsentAt: null, blocked: false },
  { label: 'a consented minor', isMinor: true, guardianConsentAt: CONSENTED_AT, blocked: false },
  { label: 'an unconsented minor', isMinor: true, guardianConsentAt: null, blocked: true },
  {
    label: 'a minor whose is_minor was cleared by age-sweep.ts',
    isMinor: false,
    guardianConsentAt: null,
    blocked: false,
  },
];

describe.each(STATES)('$label', ({ isMinor, guardianConsentAt, blocked }) => {
  const user = clientUser({ isMinor, guardianConsentAt });

  it.each(GATED)('gets the right answer from %s', async (procedure) => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(createTestContext({ db, user }));

    if (blocked) {
      await expect(caller[procedure]()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        cause: { appCode: 'GUARDIAN_CONSENT_PENDING' },
      });
    } else {
      await expect(caller[procedure]()).resolves.toEqual({ reached: true });
    }
  });

  it.each(UNGATED)('reaches %s regardless', async (procedure) => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(createTestContext({ db, user }));

    await expect(caller[procedure]()).resolves.toEqual({ reached: true });
  });
});

describe('guardianConsentGate', () => {
  it('issues zero database queries when it blocks', async () => {
    const { db, touchedProps } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: clientUser({ isMinor: true, guardianConsentAt: null }) }),
    );

    await expect(caller.gatedClient()).rejects.toThrow();

    expect(touchedProps).toEqual([]);
  });

  it('names the guardian, not the client, as the party being waited on', async () => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: clientUser({ isMinor: true, guardianConsentAt: null }) }),
    );

    // ER§1.2's copy. `COPY.md` §CO1's no-shame rule: the minor did nothing
    // wrong and cannot fix this themselves, so nothing here may read as
    // "you are not allowed".
    const message = await caller.gatedClient().then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : ''),
    );

    expect(message).toBe(
      "We're waiting on your guardian's confirmation. We'll email you when it's done.",
    );
    expect(message).toMatch(/guardian/i);
    expect(message).not.toMatch(/\byou (are|'re) not\b|not allowed|blocked|denied/i);
  });

  it('logs the block once, at info level, with the user id and the tRPC path', async () => {
    const { db } = createUntouchedDb();
    const user = clientUser({ isMinor: true, guardianConsentAt: null });
    const caller = scratchRouter.createCaller(createTestContext({ db, user }));
    const chunks: string[] = [];
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    try {
      await expect(caller.gatedClient()).rejects.toThrow();
    } finally {
      stdout.mockRestore();
    }

    const blocked = parseLogLines(chunks).filter((line) => line.msg === 'guardian_consent.blocked');

    expect(blocked).toHaveLength(1);
    // `info`, never `error`: an expected state, not a fault. It gets no
    // threshold and no alert (`observability-ops` §4's "never alert" list).
    expect(blocked[0]).toMatchObject({
      level: 'info',
      userId: user.id,
      procedure: 'gatedClient',
    });
  });

  // Not reported to Sentry, and structurally so rather than by convention:
  // `../../trpc/error-formatter.ts` reports only `INTERNAL_ERROR`, and
  // `GUARDIAN_CONSENT_PENDING` maps to `FORBIDDEN`
  // (`packages/schemas/src/errors.ts`). Asserting the guard rather than
  // mocking the Sentry client keeps this true for every catalogued
  // `FORBIDDEN` code, not just this one.
  it('is not reported to Sentry', () => {
    expect(APP_ERROR_TRPC_CODE.GUARDIAN_CONSENT_PENDING).toBe('FORBIDDEN');

    const formatter = readFileSync(
      path.join(__dirname, '..', '..', 'trpc', 'error-formatter.ts'),
      'utf8',
    );
    const sentryCalls = formatter.match(/reportUncaughtError\(/g) ?? [];

    expect(sentryCalls).toHaveLength(2);
    // The catalogued-error branch reports only when the code is
    // `INTERNAL_ERROR`; the other call site is the uncaught branch, which a
    // catalogued error never reaches.
    expect(formatter).toMatch(/appCode === 'INTERNAL_ERROR'\)\s*\{\s*reportUncaughtError\(/);
  });

  it('leaves the wrong-role answer to hasRole — a coach never sees a consent error', async () => {
    // Ordered after `hasRole` deliberately: a caller whose role is wrong
    // must get `ROLE_REQUIRED`, never a message about somebody's guardian,
    // which would leak a fact about another account to whoever's session
    // is making the call.
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: clientUser({ isMinor: true, guardianConsentAt: null }) }),
    );

    await expect(caller.coachOnly()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
  });
});

// The exemption list, asserted where it is actually decided. It is a
// consequence of which builder each procedure is written on, not a list
// this middleware maintains — so what needs guarding is that nobody moves
// one of these five onto `clientProcedure` later. A blocked minor who
// cannot call `me.requestDeletion` is a store-requirement breach (§21.4);
// one who cannot call `me.get` has nothing for `06`'s pending screen to
// render.
describe('the procedures that must stay reachable while consent is pending', () => {
  it.each([
    ['me.get', 'me.ts', 'get', 'protectedProcedure'],
    ['me.requestDeletion', 'me.ts', 'requestDeletion', 'protectedProcedure'],
    ['me.cancelDeletion', 'me.ts', 'cancelDeletion', 'protectedProcedure'],
    ['auth.refresh', 'auth.ts', 'refresh', 'publicProcedure'],
    ['auth.signOut', 'auth.ts', 'signOut', 'publicProcedure'],
  ])('%s is built on an ungated builder', (_label, file, procedure, builder) => {
    const source = readFileSync(path.join(__dirname, '..', '..', 'routers', file), 'utf8');

    expect(source).toMatch(new RegExp(`\\b${procedure}:\\s*${builder}\\b`));
  });

  // `04`'s resend is forced onto `protectedProcedure` by this task's own
  // decision (`../../trpc/procedures.ts`). Written as a pending
  // expectation rather than a comment so it is asserted the moment that
  // procedure exists, and fails loudly if it lands on `clientProcedure` —
  // a resend the blocked account cannot call is what turns a stalled
  // consent into a dead account.
  it('resendGuardianConsent, once it exists, is not on clientProcedure', () => {
    const source = readFileSync(path.join(__dirname, '..', '..', 'routers', 'invites.ts'), 'utf8');
    const declaration = source.match(/\bresendGuardianConsent:\s*(\w+)/);

    if (declaration) {
      expect(declaration[1]).toBe('protectedProcedure');
    } else {
      expect(source).not.toContain('resendGuardianConsent');
    }
  });
});
