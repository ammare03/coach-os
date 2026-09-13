// Real Postgres, real migrated schema (`testing` skill §4). Everything this
// module promises is a property of the database rather than of the
// TypeScript: the `ON CONFLICT (user_id)` upsert, the row lock that makes 20
// concurrent increments all land, `GREATEST(..., 0)`'s clamp, and migration
// 0021's `touch_updated_at` trigger. A mock proves none of them — and a
// lost-update bug is invisible to one.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { logger } from './logger.ts';
import {
  decrementStorageUsage,
  incrementStorageUsage,
  recordAssetRemoved,
  recordAssetStored,
} from './storage-usage.ts';

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

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // Subprocess, matching `workout-session-upsert.test.ts` — `migrate.ts`
  // reads `import.meta.url`, which ts-jest's CommonJS transpile cannot run.
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
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

/** A bare `identity.users` row — `storage_usage.user_id` FKs to it and nothing else. */
async function makeUser(role: 'coach' | 'client'): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${role}-${randomUUID()}@storage.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture User',
      role,
    })
    .returning();
  if (!user) throw new Error('fixture: users insert returned no row');
  return user.id;
}

type Counter = { bytesUsed: number; assetCount: number } | undefined;

async function readCounter(userId: string): Promise<Counter> {
  const [row] = await db
    .select({
      bytesUsed: schema.storageUsage.bytesUsed,
      assetCount: schema.storageUsage.assetCount,
    })
    .from(schema.storageUsage)
    .where(eq(schema.storageUsage.userId, userId));
  return row;
}

describe('incrementStorageUsage', () => {
  it('creates the counter row on the first increment', async () => {
    const userId = await makeUser('coach');

    await incrementStorageUsage(db, userId, 1_024);

    expect(await readCounter(userId)).toEqual({ bytesUsed: 1_024, assetCount: 1 });
  });

  it('adds to an existing row rather than replacing it', async () => {
    const userId = await makeUser('coach');

    await incrementStorageUsage(db, userId, 1_024);
    await incrementStorageUsage(db, userId, 2_048);

    expect(await readCounter(userId)).toEqual({ bytesUsed: 3_072, assetCount: 2 });
  });

  it('rejects a negative byte count instead of corrupting the meter', async () => {
    const userId = await makeUser('coach');

    await expect(incrementStorageUsage(db, userId, -1)).rejects.toThrow(/non-negative/);
    expect(await readCounter(userId)).toBeUndefined();
  });

  it('rejects a non-integer byte count', async () => {
    const userId = await makeUser('coach');

    await expect(incrementStorageUsage(db, userId, 1.5)).rejects.toThrow(/integer/);
  });

  // The acceptance criterion the atomic-upsert choice exists for, verified
  // directly rather than assumed: a read-then-write would lose updates here.
  it('lands every one of 20 concurrent increments on the same row', async () => {
    const coachUserId = await makeUser('coach');
    const sizes = Array.from({ length: 20 }, (_, i) => 1_000 + i);
    const expectedBytes = sizes.reduce((sum, size) => sum + size, 0);

    await Promise.all(sizes.map((size) => incrementStorageUsage(db, coachUserId, size)));

    expect(await readCounter(coachUserId)).toEqual({
      bytesUsed: expectedBytes,
      assetCount: 20,
    });
  }, 30_000);
});

describe('decrementStorageUsage', () => {
  it('subtracts from both counters', async () => {
    const userId = await makeUser('coach');
    await incrementStorageUsage(db, userId, 5_000);
    await incrementStorageUsage(db, userId, 3_000);

    await decrementStorageUsage(db, userId, 3_000);

    expect(await readCounter(userId)).toEqual({ bytesUsed: 5_000, assetCount: 1 });
  });

  it('lands every one of 20 concurrent decrements on the same row', async () => {
    const userId = await makeUser('coach');
    const sizes = Array.from({ length: 20 }, (_, i) => 1_000 + i);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    await Promise.all(sizes.map((size) => incrementStorageUsage(db, userId, size)));

    await Promise.all(sizes.map((size) => decrementStorageUsage(db, userId, size)));

    expect(await readCounter(userId)).toEqual({ bytesUsed: 0, assetCount: 0 });
    expect(total).toBeGreaterThan(0);
  }, 30_000);

  it('clamps at zero and logs a discrepancy rather than going negative', async () => {
    const userId = await makeUser('coach');
    await incrementStorageUsage(db, userId, 100);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      await decrementStorageUsage(db, userId, 500);

      expect(await readCounter(userId)).toEqual({ bytesUsed: 0, assetCount: 0 });
      expect(warn).toHaveBeenCalledWith(
        'storage_usage.decrement_below_zero',
        expect.objectContaining({ userId, bytes: 500 }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('logs a discrepancy and creates nothing when there is no counter row', async () => {
    const userId = await makeUser('coach');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      await decrementStorageUsage(db, userId, 500);

      expect(await readCounter(userId)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'storage_usage.decrement_missing_row',
        expect.objectContaining({ userId, bytes: 500 }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a negative byte count', async () => {
    const userId = await makeUser('coach');

    await expect(decrementStorageUsage(db, userId, -1)).rejects.toThrow(/non-negative/);
  });
});

describe('recordAssetStored — the tenant meter', () => {
  it("increments both the client's own row and the coach's row", async () => {
    const coachUserId = await makeUser('coach');
    const clientUserId = await makeUser('client');

    await recordAssetStored(db, { coachUserId, clientUserId, bytes: 4_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
    expect(await readCounter(clientUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
  });

  it("increments only the coach's row for a coach's own upload", async () => {
    const coachUserId = await makeUser('coach');
    const clientUserId = await makeUser('client');

    await recordAssetStored(db, { coachUserId, clientUserId: null, bytes: 4_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
    expect(await readCounter(clientUserId)).toBeUndefined();
  });

  it('treats an omitted clientUserId the same as null', async () => {
    const coachUserId = await makeUser('coach');

    await recordAssetStored(db, { coachUserId, bytes: 4_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
  });

  it('never double-counts when the two ids are the same user', async () => {
    const coachUserId = await makeUser('coach');

    await recordAssetStored(db, { coachUserId, clientUserId: coachUserId, bytes: 4_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
  });

  it("keeps the coach's meter as the sum of every client's uploads", async () => {
    const coachUserId = await makeUser('coach');
    const clientA = await makeUser('client');
    const clientB = await makeUser('client');

    await recordAssetStored(db, { coachUserId, clientUserId: clientA, bytes: 1_000 });
    await recordAssetStored(db, { coachUserId, clientUserId: clientB, bytes: 2_000 });
    await recordAssetStored(db, { coachUserId, clientUserId: null, bytes: 3_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 6_000, assetCount: 3 });
    expect(await readCounter(clientA)).toEqual({ bytesUsed: 1_000, assetCount: 1 });
    expect(await readCounter(clientB)).toEqual({ bytesUsed: 2_000, assetCount: 1 });
  });
});

describe('recordAssetRemoved', () => {
  it('decrements both rows for a client-owned asset', async () => {
    const coachUserId = await makeUser('coach');
    const clientUserId = await makeUser('client');
    await recordAssetStored(db, { coachUserId, clientUserId, bytes: 4_000 });
    await recordAssetStored(db, { coachUserId, clientUserId, bytes: 1_000 });

    await recordAssetRemoved(db, { coachUserId, clientUserId, bytes: 4_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 1_000, assetCount: 1 });
    expect(await readCounter(clientUserId)).toEqual({ bytesUsed: 1_000, assetCount: 1 });
  });

  it("decrements only the coach's row for a coach-owned asset", async () => {
    const coachUserId = await makeUser('coach');
    const clientUserId = await makeUser('client');
    await recordAssetStored(db, { coachUserId, clientUserId, bytes: 4_000 });
    await recordAssetStored(db, { coachUserId, clientUserId: null, bytes: 1_000 });

    await recordAssetRemoved(db, { coachUserId, clientUserId: null, bytes: 1_000 });

    expect(await readCounter(coachUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
    expect(await readCounter(clientUserId)).toEqual({ bytesUsed: 4_000, assetCount: 1 });
  });
});

describe('transaction participation (DB§8.2)', () => {
  it('rolls the counter back with the transaction that wrote it', async () => {
    const coachUserId = await makeUser('coach');
    const clientUserId = await makeUser('client');

    await expect(
      db.transaction(async (tx) => {
        await recordAssetStored(tx, { coachUserId, clientUserId, bytes: 9_000 });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    expect(await readCounter(coachUserId)).toBeUndefined();
    expect(await readCounter(clientUserId)).toBeUndefined();
  });
});
