// Real Postgres via Testcontainers (`./audit-log.test.ts`'s pattern) — this
// is a real column read, not something a mock could stand in for.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { isOperator } from './is-operator.ts';

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
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

async function insertUser(overrides: {
  internalOperator?: boolean;
  deletedAt?: Date | null;
}): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({
      email: `is-operator-${crypto.randomUUID()}@fixture.com`,
      passwordHash: 'x',
      name: 'Fixture',
      role: 'coach',
      internalOperator: overrides.internalOperator ?? false,
      ...(overrides.deletedAt !== undefined ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('seed insert into users did not return a row');
  return row.id;
}

describe('isOperator', () => {
  it('is false for an ordinary user', async () => {
    const userId = await insertUser({ internalOperator: false });
    expect(await isOperator(db, userId)).toBe(false);
  });

  it('is true for a user with internal_operator set', async () => {
    const userId = await insertUser({ internalOperator: true });
    expect(await isOperator(db, userId)).toBe(true);
  });

  it('is false for a deleted user, even with internal_operator set', async () => {
    const userId = await insertUser({ internalOperator: true, deletedAt: new Date() });
    expect(await isOperator(db, userId)).toBe(false);
  });

  it('is false for an id that does not exist, never throwing', async () => {
    await expect(isOperator(db, '00000000-0000-7000-8000-000000000000')).resolves.toBe(false);
  });
});
