// `account-lifecycle/12` — the guardian-delivery resolution
// `sendExportReadyEmail` re-derives at send time, independently of whatever
// was true at request time. `data-export.test.ts` already covers the
// self-service case end to end; this file isolates the branch task 12 adds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { sendExportReadyEmail as SendExportReadyEmail } from './send-export-ready-email.ts';

const sendEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/email/client.ts', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let sendExportReadyEmail: typeof SendExportReadyEmail;

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
  ({ sendExportReadyEmail } = await import('./send-export-ready-email.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

beforeEach(() => {
  sendEmail.mockClear();
});

async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${crypto.randomUUID()}@send-export-test.com`,
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

describe('sendExportReadyEmail', () => {
  it('delivers to the subject’s own email for an ordinary self-service export', async () => {
    const user = await insertUser();

    await sendExportReadyEmail(db, { userId: user.id, requestedByUserId: user.id });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
  });

  it('delivers to the confirmed guardian, and separately notifies the minor', async () => {
    const guardian = await insertUser();
    const minor = await insertUser({
      isMinor: true,
      guardianEmail: guardian.email,
      guardianConsentAt: new Date(),
    });

    await sendExportReadyEmail(db, { userId: minor.id, requestedByUserId: guardian.id });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: guardian.email }));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: minor.email }));
  });

  it('never delivers to an operator — the export goes to the subject instead', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser();

    await sendExportReadyEmail(db, { userId: subject.id, requestedByUserId: operator.id });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: subject.email }));
  });

  it('delivers to the subject once guardian status no longer holds, even if requestedByUserId is unchanged', async () => {
    const formerGuardian = await insertUser();
    const formerMinor = await insertUser({
      isMinor: false,
      guardianEmail: formerGuardian.email,
      guardianConsentAt: new Date(),
    });

    await sendExportReadyEmail(db, {
      userId: formerMinor.id,
      requestedByUserId: formerGuardian.id,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: formerMinor.email }));
  });
});
