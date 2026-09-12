// No Postgres and no Redis, for the same reason
// `../../../__tests__/middleware/guardian-consent.test.ts` needs neither:
// the gate's whole content is one predicate over a field the context
// factory has already resolved. What needs proving is which builders carry
// it — and, more than anything else in this task, which builder does NOT
// (`02-delete-account.md` Risks: "attaching the gate to `protectedProcedure`
// would block `me.cancelDeletion` and the export — the two things a person
// in this state is entitled to").
//
// The scratch router below is built on the real exported builders, so the
// actual middleware chain runs, and `ctx.db` is a proxy that records any
// access: a gate that ever issued a query would show up as a non-empty
// `touchedProps`.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { DbClient } from '@coachos/db';
import { APP_ERROR_TRPC_CODE } from '@coachos/schemas';

import { createTestContext } from '../../../__tests__/test-context.ts';
import type { ContextUser } from '../../context.ts';
import { router } from '../../init.ts';
import {
  clientProcedure,
  coachOrClientProcedure,
  coachProcedure,
  protectedProcedure,
  publicProcedure,
} from '../../procedures.ts';

const ROUTERS_DIR = path.join(__dirname, '..', '..', '..', 'routers');
const PROCEDURES_FILE = path.join(__dirname, '..', '..', 'procedures.ts');

// Same recorder as `guardian-consent.test.ts` — records rather than throws,
// so "zero queries" reads as an assertion instead of an unrelated crash.
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
  // Gated: everything that constitutes using the product.
  gatedClient: clientProcedure.query(() => ({ reached: true })),
  gatedCoach: coachProcedure.query(() => ({ reached: true })),
  gatedEither: coachOrClientProcedure.query(() => ({ reached: true })),
  // Ungated, deliberately: `me.*` (the pending screen, the cancel, the
  // whole export path) hangs off `protectedProcedure`, and `auth.refresh` /
  // `auth.signOut` off `publicProcedure` (`../../procedures.ts`). These two
  // rows are the three exits the blocking screen offers.
  ungatedProtected: protectedProcedure.query(() => ({ reached: true })),
  ungatedPublic: publicProcedure.query(() => ({ reached: true })),
});

const GATED = ['gatedClient', 'gatedCoach', 'gatedEither'] as const;
const UNGATED = ['ungatedProtected', 'ungatedPublic'] as const;

const SCHEDULED_PURGE_AT = new Date('2026-09-19T00:00:00Z');

function userWith(role: 'coach' | 'client', deletionScheduledFor: Date | null): ContextUser {
  return {
    id: '00000000-0000-7000-8000-00000000d111',
    email: 'leaving@pending-deletion-test.com',
    role,
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: role === 'coach' ? '00000000-0000-7000-8000-00000000d112' : null,
    clientProfileId: role === 'client' ? '00000000-0000-7000-8000-00000000d113' : null,
    deletedAt: null,
    deletionScheduledFor,
  };
}

// `gatedCoach` only admits a coach and `gatedClient` only a client, so each
// state is probed as whichever role the procedure under test accepts —
// otherwise `hasRole` answers first and the gate is never reached.
function roleFor(procedure: (typeof GATED)[number] | (typeof UNGATED)[number]) {
  return procedure === 'gatedCoach' ? ('coach' as const) : ('client' as const);
}

const STATES = [
  { label: 'an account with no deletion pending', scheduledFor: null, blocked: false },
  {
    label: 'an account inside its 7-day grace period',
    scheduledFor: SCHEDULED_PURGE_AT,
    blocked: true,
  },
];

describe.each(STATES)('$label', ({ scheduledFor, blocked }) => {
  it.each(GATED)('gets the right answer from %s', async (procedure) => {
    const { db } = createUntouchedDb();
    const user = userWith(roleFor(procedure), scheduledFor);
    const caller = scratchRouter.createCaller(createTestContext({ db, user }));

    if (blocked) {
      await expect(caller[procedure]()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        cause: { appCode: 'ACCOUNT_PENDING_DELETION' },
      });
    } else {
      await expect(caller[procedure]()).resolves.toEqual({ reached: true });
    }
  });

  it.each(UNGATED)('reaches %s regardless', async (procedure) => {
    const { db } = createUntouchedDb();
    const user = userWith(roleFor(procedure), scheduledFor);
    const caller = scratchRouter.createCaller(createTestContext({ db, user }));

    await expect(caller[procedure]()).resolves.toEqual({ reached: true });
  });
});

describe('pendingDeletionGate', () => {
  it('issues zero database queries when it blocks', async () => {
    const { db, touchedProps } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: userWith('client', SCHEDULED_PURGE_AT) }),
    );

    await expect(caller.gatedClient()).rejects.toThrow();

    expect(touchedProps).toEqual([]);
  });

  it('uses ER§1.1 copy — it names the restore, and never the purge date', async () => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: userWith('client', SCHEDULED_PURGE_AT) }),
    );

    const message = await caller.gatedClient().then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : ''),
    );

    expect(message).toBe(
      'This account is scheduled for deletion. Restore it to keep using CoachOS.',
    );
    // The date belongs to `me.get`'s `deletionScheduledFor`, rendered in the
    // user's own timezone by the pending screen. A date formatted into an
    // error message would be formatted in the server's.
    expect(message).not.toMatch(/2026|Sep|September/);
    // `COPY.md` §CO6's no-shame rule: this is a state the person chose, and
    // nothing here may read as a punishment.
    expect(message).not.toMatch(/\byou (are|'re) not\b|not allowed|blocked|denied/i);
  });

  it('carries no payload — the purge date is read from me.get, never an error', async () => {
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: userWith('client', SCHEDULED_PURGE_AT) }),
    );

    const cause = await caller.gatedClient().then(
      () => undefined,
      (error: unknown) =>
        (error as { cause?: { details?: Record<string, unknown> } }).cause?.details,
    );

    expect(cause).toEqual({});
  });

  it('logs the block once, at info level, with the user id and the tRPC path', async () => {
    const { db } = createUntouchedDb();
    const user = userWith('client', SCHEDULED_PURGE_AT);
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

    const blocked = parseLogLines(chunks).filter((line) => line.msg === 'pending_deletion.blocked');

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
  // `../../error-formatter.ts` reports only `INTERNAL_ERROR`, and
  // `ACCOUNT_PENDING_DELETION` maps to `FORBIDDEN`. A coach who spends a
  // week in this state would otherwise consume the whole 5k/month free tier
  // (`CLAUDE.md` §3.4.3) by themselves.
  it('is not reported to Sentry', () => {
    expect(APP_ERROR_TRPC_CODE.ACCOUNT_PENDING_DELETION).toBe('FORBIDDEN');
  });

  it('leaves the wrong-role answer to hasRole — a client never sees a deletion error', async () => {
    // Ordered after `hasRole`, never before, for the same reason
    // `guardianConsentGate` is: a caller whose role is wrong must get
    // `ROLE_REQUIRED`, not a statement about the account's lifecycle.
    const { db } = createUntouchedDb();
    const caller = scratchRouter.createCaller(
      createTestContext({ db, user: userWith('client', SCHEDULED_PURGE_AT) }),
    );

    await expect(caller.gatedCoach()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
  });
});

// Placement is the allowlist. These assertions are the whole reason the
// gate is safe to attach at all: there is no maintained list of exempt
// procedure names anywhere in this codebase, so the only thing keeping the
// three exits reachable is which builder each one is written on.
describe('placement — the gate is on the coaching builders and nowhere else', () => {
  it('is attached to clientProcedure, coachProcedure and coachOrClientProcedure', () => {
    const source = readFileSync(PROCEDURES_FILE, 'utf8');

    for (const builder of ['coachProcedure', 'clientProcedure', 'coachOrClientProcedure']) {
      const declaration = source.match(new RegExp(`export const ${builder} =[\\s\\S]*?;`))?.[0];
      expect(declaration).toBeDefined();
      expect(declaration).toContain('pendingDeletionGate');
    }
  });

  // The single biggest failure mode in this task. `protectedProcedure` is
  // what `me.cancelDeletion`, `me.requestExport` and the rest of the export
  // path are built on — gating it would lock a person out of the two things
  // §21.4 and §21.3 guarantee them while their account is winding down.
  it('is NOT attached to protectedProcedure, authProcedure or publicProcedure', () => {
    const source = readFileSync(PROCEDURES_FILE, 'utf8');

    for (const builder of ['publicProcedure', 'authProcedure', 'protectedProcedure']) {
      const declaration = source.match(new RegExp(`export const ${builder} =[\\s\\S]*?;`))?.[0];
      expect(declaration).toBeDefined();
      expect(declaration).not.toContain('pendingDeletionGate');
    }
  });

  it.each([
    ['me.get', 'me.ts', 'get', 'protectedProcedure'],
    ['me.cancelDeletion', 'me.ts', 'cancelDeletion', 'protectedProcedure'],
    ['me.requestExport', 'me.ts', 'requestExport', 'protectedProcedure'],
    ['me.exportStatus', 'me.ts', 'exportStatus', 'protectedProcedure'],
    ['me.exportDownloadUrl', 'me.ts', 'exportDownloadUrl', 'protectedProcedure'],
    ['me.exportHistory', 'me.ts', 'exportHistory', 'protectedProcedure'],
    ['auth.refresh', 'auth.ts', 'refresh', 'publicProcedure'],
    ['auth.signOut', 'auth.ts', 'signOut', 'publicProcedure'],
  ])('%s is built on an ungated builder', (_label, file, procedure, builder) => {
    const source = readFileSync(path.join(ROUTERS_DIR, file), 'utf8');

    expect(source).toMatch(new RegExp(`\\b${procedure}:\\s*${builder}\\b`));
  });
});
