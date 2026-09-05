// `account-lifecycle/12` — the guardian and operator export paths, against a
// real Postgres (`testing` skill §4). `request.test.ts` already covers the
// dedupe/rate-limit gate these two reuse; this file proves the eligibility
// checks each layers on top, and that the two subjects rate-limit
// independently.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import type { ContextUser } from '../../trpc/context.ts';

import type {
  isConfirmedGuardianOf as IsConfirmedGuardianOf,
  requestExportForDependent as RequestExportForDependent,
  requestExportForSubject as RequestExportForSubject,
} from './delegated.ts';

const enqueueDataExport = jest.fn().mockResolvedValue(undefined);
jest.mock('../../queues/enqueue.ts', () => ({
  enqueueDataExport: (...args: unknown[]) => enqueueDataExport(...args),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let requestExportForDependent: typeof RequestExportForDependent;
let requestExportForSubject: typeof RequestExportForSubject;
let isConfirmedGuardianOf: typeof IsConfirmedGuardianOf;
let createTestContext: typeof CreateTestContext;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
  ({ requestExportForDependent, requestExportForSubject, isConfirmedGuardianOf } =
    await import('./delegated.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

beforeEach(() => {
  enqueueDataExport.mockClear();
});

async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${crypto.randomUUID()}@delegated-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture User',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('no user row');
  return user;
}

function ctxFor(user: typeof schema.users.$inferSelect): ReturnType<typeof CreateTestContext> {
  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    locale: user.locale,
    coachProfileId: null,
    clientProfileId: null,
    deletedAt: null,
  };
  return createTestContext({ db, user: contextUser });
}

async function insertMinor(
  guardianEmail: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  return insertUser({
    isMinor: true,
    guardianEmail,
    guardianConsentAt: new Date(),
    ...overrides,
  });
}

describe('requestExportForDependent', () => {
  it('succeeds for a confirmed guardian and records the relationship, destination, and requester', async () => {
    const guardian = await insertUser();
    const minor = await insertMinor(guardian.email);

    const result = await requestExportForDependent(db, ctxFor(guardian), minor.id);

    expect(result.status).toBe('queued');
    expect(enqueueDataExport).toHaveBeenCalledWith({ exportId: result.exportId });

    const [row] = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.id, result.exportId));
    expect(row?.userId).toBe(minor.id);
    expect(row?.requestedByUserId).toBe(guardian.id);

    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, minor.id));
    expect(audit?.actorUserId).toBe(guardian.id);
    expect(audit?.metadata).toMatchObject({
      relationship: 'guardian',
      destination: guardian.email,
    });
  });

  it('rejects a caller whose email does not match guardian_email, with DEPENDENT_NOT_FOUND', async () => {
    const guardian = await insertUser();
    const impostor = await insertUser();
    const minor = await insertMinor(guardian.email);

    await expect(requestExportForDependent(db, ctxFor(impostor), minor.id)).rejects.toMatchObject({
      cause: { appCode: 'DEPENDENT_NOT_FOUND' },
    });
    expect(enqueueDataExport).not.toHaveBeenCalled();
  });

  it('rejects a subject who is not a minor, with DEPENDENT_NOT_FOUND', async () => {
    const guardian = await insertUser();
    const adult = await insertUser();

    await expect(requestExportForDependent(db, ctxFor(guardian), adult.id)).rejects.toMatchObject({
      cause: { appCode: 'DEPENDENT_NOT_FOUND' },
    });
  });

  it('rejects a minor with no guardian consent recorded yet', async () => {
    const guardian = await insertUser();
    const minor = await insertMinor(guardian.email, { guardianConsentAt: null });

    await expect(requestExportForDependent(db, ctxFor(guardian), minor.id)).rejects.toMatchObject({
      cause: { appCode: 'DEPENDENT_NOT_FOUND' },
    });
  });

  it('returns DEPENDENT_NOT_FOUND once the dependent ages out of minor status', async () => {
    const guardian = await insertUser();
    const formerMinor = await insertMinor(guardian.email, { isMinor: false });

    await expect(
      requestExportForDependent(db, ctxFor(guardian), formerMinor.id),
    ).rejects.toMatchObject({
      cause: { appCode: 'DEPENDENT_NOT_FOUND' },
    });
  });

  it('rejects a guardian whose own email is unverified', async () => {
    const guardian = await insertUser({ emailVerifiedAt: null });
    const minor = await insertMinor(guardian.email);

    await expect(requestExportForDependent(db, ctxFor(guardian), minor.id)).rejects.toMatchObject({
      cause: { appCode: 'DEPENDENT_NOT_FOUND' },
    });
  });

  it('gives a guardian with two minors two independent daily allowances', async () => {
    const guardian = await insertUser();
    const first = await insertMinor(guardian.email);
    const second = await insertMinor(guardian.email);

    const firstResult = await requestExportForDependent(db, ctxFor(guardian), first.id);
    const secondResult = await requestExportForDependent(db, ctxFor(guardian), second.id);

    expect(firstResult.status).toBe('queued');
    expect(secondResult.status).toBe('queued');
    expect(enqueueDataExport).toHaveBeenCalledTimes(2);
  });
});

describe('requestExportForSubject (operator)', () => {
  it('succeeds and records the reason, ticket, and destination as the subject own email', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser();

    const result = await requestExportForSubject(db, ctxFor(operator), subject.id, {
      reason: 'User lost access to their account and emailed support.',
      ticketReference: 'ZD-1234',
    });

    expect(result.status).toBe('queued');
    const [row] = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.id, result.exportId));
    expect(row?.userId).toBe(subject.id);
    expect(row?.requestedByUserId).toBe(operator.id);

    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, subject.id));
    expect(audit?.metadata).toMatchObject({
      relationship: 'operator',
      reason: 'User lost access to their account and emailed support.',
      ticketReference: 'ZD-1234',
      destination: subject.email,
    });
  });

  it('rejects a soft-deleted subject with DEPENDENT_NOT_FOUND', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser({ deletedAt: new Date() });

    await expect(
      requestExportForSubject(db, ctxFor(operator), subject.id, {
        reason: 'test',
        ticketReference: 'ZD-1',
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'DEPENDENT_NOT_FOUND' } });
  });
});

describe('isConfirmedGuardianOf', () => {
  it('is false for an operator, even one who triggered the subject export', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser();

    expect(await isConfirmedGuardianOf(db, operator.id, subject.id)).toBe(false);
  });
});
