// `auth-server/07`'s Verification: "set a fixture's birthdate to
// yesterday-minus-18-years, run the sweep, and assert minor status
// clears... and both emails send." Real Postgres; `sendEmail` stubbed at
// the boundary `auth-server/06` established.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

import { sendEmail } from '../../lib/email/client.ts';
import { runAgeSweep } from '../age-sweep.ts';

const sendEmailMock = sendEmail as jest.Mock;

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
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

beforeEach(() => {
  sendEmailMock.mockClear();
});

function isoDateYearsAgo(years: number, offsetDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

async function seedMinorClient(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `minor-${Date.now()}-${Math.random()}@age-sweep-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: 'Minor Client',
      role: 'client',
      timezone: 'UTC',
      dateOfBirth: isoDateYearsAgo(17),
      isMinor: true,
      guardianEmail: 'guardian@age-sweep-test.com',
      guardianConsentAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('seed insert did not return a row');
  return user;
}

describe('runAgeSweep', () => {
  it('clears is_minor and emails both parties for a client who turned 18 yesterday', async () => {
    const user = await seedMinorClient({ dateOfBirth: isoDateYearsAgo(18, 1) });

    const result = await runAgeSweep(db);

    expect(result.minorStatusCleared).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row?.isMinor).toBe(false);

    const recipients = sendEmailMock.mock.calls.map((call) => call[0]?.to);
    expect(recipients).toContain(user.email);
    expect(recipients).toContain('guardian@age-sweep-test.com');
  });

  it('leaves a genuinely 17-year-old client untouched', async () => {
    const user = await seedMinorClient({ dateOfBirth: isoDateYearsAgo(17) });
    await runAgeSweep(db);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row?.isMinor).toBe(true);
    expect(sendEmailMock.mock.calls.some((call) => call[0]?.to === user.email)).toBe(false);
  });

  it('clears an expired suspension', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `suspended-${Date.now()}@age-sweep-test.com`,
        passwordHash: 'argon2id$placeholder',
        name: 'Suspended User',
        role: 'coach',
        timezone: 'UTC',
        dateOfBirth: isoDateYearsAgo(30),
        suspendedUntil: new Date(Date.now() - 60_000),
      })
      .returning();
    if (!user) throw new Error('seed insert did not return a row');

    const result = await runAgeSweep(db);
    expect(result.suspensionsExpired).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row?.suspendedUntil).toBeNull();
  });
});
