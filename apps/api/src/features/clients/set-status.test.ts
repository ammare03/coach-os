// `relationship-controls/01` — real Postgres (`testing` skill §4), and here
// that is not a preference: the headline claim of this suite is that
// `client_status_timestamps` (DB§5.1) never trips on any path, and a mocked
// Drizzle has no CHECK constraint to trip. The last describe block walks
// every (from, to) pair there is and asserts exactly that.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, desc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import { appRouter } from '../../routers/index.ts';
import type { ContextUser } from '../../trpc/context.ts';

import { setClientStatus } from './set-status.ts';

type ClientStatus = 'invited' | 'active' | 'paused' | 'archived';
type ClientStatusTarget = 'active' | 'paused' | 'archived';

const ALL_STATUSES: readonly ClientStatus[] = ['invited', 'active', 'paused', 'archived'];
const ALL_TARGETS: readonly ClientStatusTarget[] = ['active', 'paused', 'archived'];

let container: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  fixture = await createTwoCoachesFixture(db);
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

// Every test writes; every test is undone. `setClientStatus` opens its own
// transaction, which nests as a SAVEPOINT inside this one — so a refusal
// (including a Postgres CHECK violation, which is what the last block is
// hunting for) rolls back the inner work and leaves this transaction usable.
const ROLLBACK = Symbol('set-status-test-rollback');
async function withRolledBackTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as unknown as DbClient);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return out as T;
}

const ACTIVATED_AT = new Date('2026-01-05T09:00:00Z');
const PAUSED_AT = new Date('2026-02-10T09:00:00Z');
const ARCHIVED_AT = new Date('2026-03-15T09:00:00Z');

/**
 * Puts a fixture client into `status`, with the timestamps that status
 * legitimately carries. Every combination here already satisfies
 * `client_status_timestamps` — the point of the suite is what happens next,
 * not whether the setup is legal.
 *
 * `paused` deliberately keeps a non-null `activated_at`; the one case where
 * it is null has its own test, because it is the case that would otherwise
 * trip the check on resume.
 */
async function putInStatus(
  tx: DbClient,
  clientProfileId: string,
  status: ClientStatus,
): Promise<void> {
  const columns: Record<
    ClientStatus,
    { activatedAt: Date | null; pausedAt: Date | null; archivedAt: Date | null }
  > = {
    invited: { activatedAt: null, pausedAt: null, archivedAt: null },
    active: { activatedAt: ACTIVATED_AT, pausedAt: null, archivedAt: null },
    paused: { activatedAt: ACTIVATED_AT, pausedAt: PAUSED_AT, archivedAt: null },
    archived: { activatedAt: ACTIVATED_AT, pausedAt: null, archivedAt: ARCHIVED_AT },
  };

  await tx
    .update(schema.clientProfiles)
    .set({ status, ...columns[status] })
    .where(eq(schema.clientProfiles.id, clientProfileId));
}

async function readRow(tx: DbClient, clientProfileId: string) {
  const [row] = await tx
    .select({
      status: schema.clientProfiles.status,
      activatedAt: schema.clientProfiles.activatedAt,
      pausedAt: schema.clientProfiles.pausedAt,
      archivedAt: schema.clientProfiles.archivedAt,
    })
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.id, clientProfileId));
  if (!row) throw new Error('test setup: client_profiles row missing');
  return row;
}

async function auditRowsFor(tx: DbClient, clientProfileId: string) {
  return tx
    .select({
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      metadata: schema.auditLog.metadata,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.targetType, 'client_profile'),
        eq(schema.auditLog.targetId, clientProfileId),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt));
}

function coachAUser(): ContextUser {
  return {
    id: fixture.coachA.userId,
    email: 'coach-a@two-coaches-fixture.com',
    role: 'coach',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: fixture.coachA.profileId,
    clientProfileId: null,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

/** The CHECK, restated in JS — DB§5.1, verbatim. */
function satisfiesStatusTimestamps(row: {
  status: ClientStatus;
  activatedAt: Date | null;
  archivedAt: Date | null;
}): boolean {
  return (
    (row.status !== 'active' || row.activatedAt !== null) &&
    (row.status !== 'archived' || row.archivedAt !== null)
  );
}

describe('setClientStatus — legal transitions', () => {
  it('active -> paused sets paused_at, keeps activated_at, and audits the pause', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'active');

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'paused',
      });

      expect(result.status).toBe('paused');
      expect(result.pausedAt).toBeInstanceOf(Date);
      expect(result.activatedAt).toEqual(ACTIVATED_AT);
      expect(result.archivedAt).toBeNull();

      const row = await readRow(tx, clientId);
      expect(row.status).toBe('paused');
      expect(row.pausedAt).toBeInstanceOf(Date);

      const audit = await auditRowsFor(tx, clientId);
      expect(audit[0]).toMatchObject({
        action: 'coaching.client_paused',
        targetType: 'client_profile',
        targetId: clientId,
        metadata: { from: 'active', to: 'paused' },
      });
    });
  });

  it('paused -> active clears paused_at, keeps the original activated_at, and audits the resume', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'paused');

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'active',
      });

      expect(result.status).toBe('active');
      expect(result.pausedAt).toBeNull();
      // "When this client became active" is a fact about the relationship,
      // not about the most recent resume.
      expect(result.activatedAt).toEqual(ACTIVATED_AT);

      const audit = await auditRowsFor(tx, clientId);
      expect(audit[0]).toMatchObject({
        action: 'coaching.client_resumed',
        metadata: { from: 'paused', to: 'active' },
      });
    });
  });

  it('active -> archived sets archived_at and audits the archive', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'active');

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'archived',
      });

      expect(result.status).toBe('archived');
      expect(result.archivedAt).toBeInstanceOf(Date);

      const row = await readRow(tx, clientId);
      expect(row.archivedAt).toBeInstanceOf(Date);
      expect(satisfiesStatusTimestamps(row)).toBe(true);

      const audit = await auditRowsFor(tx, clientId);
      expect(audit[0]).toMatchObject({
        action: 'coaching.client_archived',
        metadata: { from: 'active', to: 'archived' },
      });
    });
  });

  it('paused -> archived sets archived_at and leaves paused_at as the record it is', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'paused');

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'archived',
      });

      expect(result.status).toBe('archived');
      expect(result.archivedAt).toBeInstanceOf(Date);
      expect(result.pausedAt).toEqual(PAUSED_AT);
    });
  });

  it('invited -> archived is legal: a never-accepted invite can be archived away', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA2.profileId;
      await putInStatus(tx, clientId, 'invited');

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'archived',
      });

      expect(result.status).toBe('archived');
      expect(result.archivedAt).toBeInstanceOf(Date);
      // Never activated, and archiving does not pretend otherwise.
      expect(result.activatedAt).toBeNull();
      expect(satisfiesStatusTimestamps(result)).toBe(true);
    });
  });

  it('fills activated_at when resuming a client that was paused before it was ever activated', async () => {
    // Legal under the CHECK (it constrains only `active` and `archived`), and
    // the one row shape that would make a naive resume write `active` with a
    // null `activated_at`.
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA2.profileId;
      await tx
        .update(schema.clientProfiles)
        .set({ status: 'paused', activatedAt: null, pausedAt: PAUSED_AT, archivedAt: null })
        .where(eq(schema.clientProfiles.id, clientId));

      const result = await setClientStatus(tx, createTestContext({ db: tx }), {
        clientProfileId: clientId,
        status: 'active',
      });

      expect(result.status).toBe('active');
      expect(result.activatedAt).toBeInstanceOf(Date);
      expect(satisfiesStatusTimestamps(result)).toBe(true);
    });
  });
});

describe('setClientStatus — idempotent replay', () => {
  it.each(['active', 'paused'] as const)(
    'asking for the status a %s client already has is a no-op and writes no audit row',
    async (status) => {
      await withRolledBackTx(async (tx) => {
        const clientId = fixture.clientA1.profileId;
        await putInStatus(tx, clientId, status);
        const before = await readRow(tx, clientId);

        const result = await setClientStatus(tx, createTestContext({ db: tx }), {
          clientProfileId: clientId,
          status,
        });

        expect(result.status).toBe(status);
        expect(await readRow(tx, clientId)).toEqual(before);
        expect(await auditRowsFor(tx, clientId)).toHaveLength(0);
      });
    },
  );
});

describe('setClientStatus — archived is terminal', () => {
  it.each(ALL_TARGETS)('archived -> %s is refused with CLIENT_ARCHIVED', async (target) => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'archived');
      const before = await readRow(tx, clientId);

      await expect(
        setClientStatus(tx, createTestContext({ db: tx }), {
          clientProfileId: clientId,
          status: target,
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        cause: { appCode: 'CLIENT_ARCHIVED' },
      });

      // Refusing changed nothing and recorded nothing.
      expect(await readRow(tx, clientId)).toEqual(before);
      expect(await auditRowsFor(tx, clientId)).toHaveLength(0);
    });
  });

  it('says the one thing there is to say, and names the new invite as the way back', async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'archived');

      await expect(
        setClientStatus(tx, createTestContext({ db: tx }), {
          clientProfileId: clientId,
          status: 'active',
        }),
      ).rejects.toMatchObject({
        message: 'This client was archived. Send a new invite to work together again.',
      });
    });
  });
});

describe('setClientStatus — a pending invite is cancelled, not paused', () => {
  it.each(['paused', 'active'] as const)(
    'invited -> %s is refused with CLIENT_STATUS_TRANSITION_INVALID',
    async (target) => {
      await withRolledBackTx(async (tx) => {
        const clientId = fixture.clientA2.profileId;
        await putInStatus(tx, clientId, 'invited');
        const before = await readRow(tx, clientId);

        await expect(
          setClientStatus(tx, createTestContext({ db: tx }), {
            clientProfileId: clientId,
            status: target,
          }),
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          cause: {
            appCode: 'CLIENT_STATUS_TRANSITION_INVALID',
            details: { from: 'invited', to: target },
          },
        });

        expect(await readRow(tx, clientId)).toEqual(before);
        expect(await auditRowsFor(tx, clientId)).toHaveLength(0);
      });
    },
  );
});

describe('client_status_timestamps', () => {
  // The acceptance criterion this suite exists for, as a property rather
  // than a list of cases: every (from, to) pair either succeeds and leaves a
  // row the CHECK accepts, or is refused by one of the two catalogued codes.
  // What must never happen is a raw Postgres 23514 — a constraint violation
  // reaching a coach as an INTERNAL_ERROR.
  const pairs = ALL_STATUSES.flatMap((from) => ALL_TARGETS.map((to) => [from, to] as const));

  it.each(pairs)('%s -> %s never trips the check', async (from, to) => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, from);

      let refusal: unknown;
      try {
        await setClientStatus(tx, createTestContext({ db: tx }), {
          clientProfileId: clientId,
          status: to,
        });
      } catch (error) {
        refusal = error;
      }

      if (refusal === undefined) {
        expect(satisfiesStatusTimestamps(await readRow(tx, clientId))).toBe(true);
        return;
      }

      // A refusal is fine — but only a designed one. A Postgres check
      // violation carries `code: '23514'` and no `cause.appCode`, which is
      // exactly what this assertion fails on.
      expect(refusal).toMatchObject({
        cause: {
          appCode: expect.stringMatching(/^(CLIENT_ARCHIVED|CLIENT_STATUS_TRANSITION_INVALID)$/),
        },
      });
    });
  });
});

describe('coach.clients.setStatus — ownsResource', () => {
  it("refuses another coach's client with NOT_YOUR_CLIENT, and changes nothing", async () => {
    await withRolledBackTx(async (tx) => {
      const foreignClientId = fixture.clientB1.profileId;
      const before = await readRow(tx, foreignClientId);

      const caller = appRouter.createCaller(createTestContext({ db: tx, user: coachAUser() }));

      await expect(
        caller.coach.clients.setStatus({ clientId: foreignClientId, status: 'paused' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: { appCode: 'NOT_YOUR_CLIENT' },
      });

      expect(await readRow(tx, foreignClientId)).toEqual(before);
      expect(await auditRowsFor(tx, foreignClientId)).toHaveLength(0);
    });
  });

  it("pauses the calling coach's own client through the router", async () => {
    await withRolledBackTx(async (tx) => {
      const clientId = fixture.clientA1.profileId;
      await putInStatus(tx, clientId, 'active');

      const caller = appRouter.createCaller(createTestContext({ db: tx, user: coachAUser() }));
      const result = await caller.coach.clients.setStatus({ clientId, status: 'paused' });

      expect(result).toMatchObject({ clientId, status: 'paused' });
      expect(result.pausedAt).toBeInstanceOf(Date);
    });
  });
});
