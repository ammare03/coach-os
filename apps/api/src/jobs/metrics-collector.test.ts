// Real Postgres via Testcontainers, running the actual `migrate.ts` script
// (`../lib/audit-log.test.ts`'s pattern) — `countDuplicateSessions` and
// `maxWebhookLagSeconds` are real SQL against the migrated schema, not
// something a mock could stand in for.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { collectAndStoreMetrics, collectMetrics } from './metrics-collector.ts';

let container: StartedTestContainer;
let db: DbClient;

const fakeRedis = {} as Redis; // never touched directly — sumRequestOutcome/pingRedisDep are what call Redis, and this suite stubs both.

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
});

afterEach(async () => {
  await db.delete(schema.workoutSessions);
  await db.delete(schema.webhookEvents);
  await db.delete(schema.metricSamples);
});

describe('collectMetrics', () => {
  it('reports zero duplicate sessions when none exist', async () => {
    const metrics = await collectMetrics(
      db,
      fakeRedis,
      async () => 'ok',
      async () => 'ok',
    );
    expect(metrics).toContainEqual({ metric: 'integrity.duplicate_sessions', value: 0 });
  });

  it('reports db/redis reachability from the injected probes, not a real ping', async () => {
    const metrics = await collectMetrics(
      db,
      fakeRedis,
      async () => 'degraded',
      async () => 'ok',
    );
    expect(metrics).toContainEqual({ metric: 'service.db_reachable', value: 0 });
    expect(metrics).toContainEqual({ metric: 'service.redis_reachable', value: 1 });
  });

  it('reports zero webhook lag when no webhook events are pending', async () => {
    const metrics = await collectMetrics(
      db,
      fakeRedis,
      async () => 'ok',
      async () => 'ok',
    );
    expect(metrics).toContainEqual({ metric: 'service.webhook_lag_seconds', value: 0 });
  });

  it('reports webhook lag as the age of the oldest unprocessed event', async () => {
    const receivedAt = new Date(Date.now() - 120_000); // 2 minutes ago
    await db.insert(schema.webhookEvents).values({
      provider: 'stripe',
      eventId: 'evt_1',
      eventType: 'test',
      payload: {},
      receivedAt,
    });

    const metrics = await collectMetrics(
      db,
      fakeRedis,
      async () => 'ok',
      async () => 'ok',
    );
    const lag = metrics.find((m) => m.metric === 'service.webhook_lag_seconds');
    expect(lag?.value).toBeGreaterThanOrEqual(100);
  });

  it('never surfaces a metric for a data source this codebase does not have yet', async () => {
    const metrics = await collectMetrics(
      db,
      fakeRedis,
      async () => 'ok',
      async () => 'ok',
    );
    const names = metrics.map((m) => m.metric);
    expect(names).not.toContain('integrity.outbox_failure_rate');
    expect(names).not.toContain('commitment.report_sla');
  });
});

describe('collectAndStoreMetrics', () => {
  it('persists every collected metric as a row in platform.metric_samples', async () => {
    const metrics = await collectAndStoreMetrics(db, fakeRedis);

    const rows = await db.select().from(schema.metricSamples);
    expect(rows).toHaveLength(metrics.length);
    expect(rows.map((r) => r.metric).sort()).toEqual(metrics.map((m) => m.metric).sort());
  });
});
