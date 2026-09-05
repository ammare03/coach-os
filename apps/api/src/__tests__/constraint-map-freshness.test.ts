// The defence the plan's own Risks section asks for by name: a P01
// migration that renames `checkins_client_period_unique` (or any other
// constraint `../db/constraint-map.ts` names) turns a friendly product
// error into a silent `INTERNAL_ERROR`/`UNKNOWN_CONFLICT` downgrade, with
// no test failure and no compile error — unless this file's own query
// against the *live, migrated* schema catches it. Real Postgres, real
// migrations (not the scratch tables `db-error-boundary.test.ts` uses —
// this test is about schema drift, not the boundary's runtime behaviour).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, type DbClient } from '@coachos/db';
import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  CONSTRAINT_ERROR_MAP,
  IGNORED_CONSTRAINTS,
  REPLAY_CONSTRAINTS,
} from '../db/constraint-map.ts';

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
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

async function liveConstraintNames(): Promise<Set<string>> {
  const rows = await db.execute(
    sql`SELECT conname FROM pg_constraint UNION SELECT indexname AS conname FROM pg_indexes`,
  );
  return new Set(rows.map((r) => (r as { conname: string }).conname));
}

describe('every constraint name this feature depends on still exists in the live schema', () => {
  it('CONSTRAINT_ERROR_MAP', async () => {
    const live = await liveConstraintNames();
    for (const name of Object.keys(CONSTRAINT_ERROR_MAP)) {
      expect(live.has(name)).toBe(true);
    }
  });

  it('REPLAY_CONSTRAINTS', async () => {
    const live = await liveConstraintNames();
    for (const name of REPLAY_CONSTRAINTS) {
      expect(live.has(name)).toBe(true);
    }
  });

  it('IGNORED_CONSTRAINTS', async () => {
    const live = await liveConstraintNames();
    for (const name of IGNORED_CONSTRAINTS) {
      expect(live.has(name)).toBe(true);
    }
  });
});
