// Real Postgres (`testing` skill §4) — the whole point of this resolver is
// what the database does on a repeat insert, and a mocked Drizzle would
// only test the mock. The two behaviours worth proving are that the first
// acknowledgment's timestamp survives a second tap, and that a second
// wording is a separate row rather than an overwrite
// (`phase-06-onboarding/onboarding-infrastructure/03`).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { acknowledgeMedicalDisclaimer as AcknowledgeMedicalDisclaimer } from './medical-disclaimer.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let acknowledgeMedicalDisclaimer: typeof AcknowledgeMedicalDisclaimer;

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
  ({ acknowledgeMedicalDisclaimer } = await import('./medical-disclaimer.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

async function insertUser(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `user-${seq}@medical-disclaimer-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `User ${seq}`,
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  return user.id;
}

function rowsFor(userId: string) {
  return db
    .select()
    .from(schema.medicalDisclaimerAcknowledgements)
    .where(eq(schema.medicalDisclaimerAcknowledgements.userId, userId));
}

describe('acknowledgeMedicalDisclaimer', () => {
  it('records a timestamp against the version the user was shown', async () => {
    const userId = await insertUser();

    const at = await acknowledgeMedicalDisclaimer(db, userId, '2026-09-placeholder');

    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe('2026-09-placeholder');
    expect(rows[0]?.acknowledgedAt.getTime()).toBe(at.getTime());
  });

  it('is idempotent — a repeat tap keeps the first moment and adds no row', async () => {
    const userId = await insertUser();

    const first = await acknowledgeMedicalDisclaimer(db, userId, '2026-09-placeholder');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await acknowledgeMedicalDisclaimer(db, userId, '2026-09-placeholder');

    expect(second.getTime()).toBe(first.getTime());
    expect(await rowsFor(userId)).toHaveLength(1);
  });

  it('records a second wording separately, so neither is rewritten under the user', async () => {
    const userId = await insertUser();

    await acknowledgeMedicalDisclaimer(db, userId, '2026-09-placeholder');
    // The shape of what happens after §21.3's legal review: a new version
    // is a new row, and the old acknowledgment stays exactly as recorded.
    await acknowledgeMedicalDisclaimer(db, userId, '2027-01-reviewed');

    const rows = await rowsFor(userId);
    expect(rows.map((r) => r.version).sort()).toEqual(['2026-09-placeholder', '2027-01-reviewed']);
  });

  it('goes when the user goes — no acknowledgment outlives its account (DB§19.2)', async () => {
    const userId = await insertUser();
    await acknowledgeMedicalDisclaimer(db, userId, '2026-09-placeholder');

    await db.delete(schema.users).where(eq(schema.users.id, userId));

    expect(await rowsFor(userId)).toHaveLength(0);
  });

  it('keeps one user’s acknowledgment out of another’s', async () => {
    const mine = await insertUser();
    const theirs = await insertUser();
    await acknowledgeMedicalDisclaimer(db, mine, '2026-09-placeholder');

    const [theirRow] = await db
      .select()
      .from(schema.medicalDisclaimerAcknowledgements)
      .where(
        and(
          eq(schema.medicalDisclaimerAcknowledgements.userId, theirs),
          eq(schema.medicalDisclaimerAcknowledgements.version, '2026-09-placeholder'),
        ),
      );
    expect(theirRow).toBeUndefined();
  });
});
