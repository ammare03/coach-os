// Real Postgres, real migrated schema (`testing` skill §4). Everything this
// module promises is a property of the database rather than of the
// TypeScript: that the tier and the counter come back in ONE statement, that
// a coach with no counter row reads as zero rather than as nothing, and —
// the risk this task exists for — that the row read is the COACH's and never
// the uploading client's. A mock proves none of those, and the one that
// matters is invisible to one.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import type { SubscriptionTier } from '@coachos/utils';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { checkStorageQuota, TIER_STORAGE_BYTES } from './storage-quota.ts';

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

  // Subprocess, matching `storage-usage.test.ts` — `migrate.ts` reads
  // `import.meta.url`, which ts-jest's CommonJS transpile cannot run.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeUser(role: 'coach' | 'client'): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${role}-${randomUUID()}@storage-quota.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture User',
      role,
    })
    .returning();
  if (!user) throw new Error('fixture: users insert returned no row');
  return user.id;
}

interface CoachFixture {
  userId: string;
  profileId: string;
}

async function makeCoach(tier: SubscriptionTier): Promise<CoachFixture> {
  const userId = await makeUser('coach');
  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId, subscriptionTier: tier })
    .returning({ id: schema.coachProfiles.id });
  if (!profile) throw new Error('fixture: coach_profiles insert returned no row');
  return { userId, profileId: profile.id };
}

async function seedUsage(userId: string, bytesUsed: number): Promise<void> {
  await db.insert(schema.storageUsage).values({ userId, bytesUsed, assetCount: 1 });
}

/** A `media_assets` row that exists only so a `SUM()` over the table would be wrong. */
async function seedAsset(coach: CoachFixture, sizeBytes: number): Promise<void> {
  await db.insert(schema.mediaAssets).values({
    ownerUserId: coach.userId,
    coachId: coach.profileId,
    kind: 'video',
    storageKey: `media/${coach.userId}/${randomUUID()}/original.mp4`,
    mimeType: 'video/mp4',
    sizeBytes,
  });
}

// ---------------------------------------------------------------------------
// The counting proxy — the technique `coach.dashboard.test.ts` established
// ---------------------------------------------------------------------------

/**
 * `db.select` and friends are overloaded, and TypeScript cannot express a
 * wrapper that keeps a set of overloads — so each replacement is asserted
 * back to the method's own type. Narrowing to exactly what it replaces,
 * never widening to `any`.
 */
function countedMethod<TKey extends keyof DbClient>(
  real: DbClient,
  key: TKey,
  onCall: () => void,
): DbClient[TKey] {
  const original = real[key];
  if (typeof original !== 'function') throw new Error(`db.${String(key)} is not a method`);
  const call = original.bind(real) as (...args: unknown[]) => unknown;
  return ((...args: unknown[]) => {
    onCall();
    return call(...args);
  }) as DbClient[TKey];
}

function countingDb(real: DbClient): { db: DbClient; queries: () => number } {
  let queries = 0;
  const onCall = (): void => {
    queries += 1;
  };

  const counted: DbClient = Object.create(real) as DbClient;
  counted.select = countedMethod(real, 'select', onCall);
  counted.selectDistinct = countedMethod(real, 'selectDistinct', onCall);
  counted.execute = countedMethod(real, 'execute', onCall);
  counted.insert = countedMethod(real, 'insert', onCall);
  counted.update = countedMethod(real, 'update', onCall);
  counted.delete = countedMethod(real, 'delete', onCall);
  counted.transaction = countedMethod(real, 'transaction', onCall);

  return { db: counted, queries: () => queries };
}

const ALL_TIERS: readonly SubscriptionTier[] = ['starter', 'coach', 'pro', 'studio', 'agency'];

// ---------------------------------------------------------------------------

describe('TIER_STORAGE_BYTES', () => {
  // CLAUDE.md §15.2's storage row, in decimal GB — which is both what the
  // task's own Approach step 1 spells out ("3/25/100/250/1000 GB in bytes")
  // and what R2 bills in, so the number a coach is held to is the number
  // their invoice would be computed from.
  it('matches CLAUDE.md §15.2 for all five tiers', () => {
    expect(TIER_STORAGE_BYTES).toEqual({
      starter: 3_000_000_000,
      coach: 25_000_000_000,
      pro: 100_000_000_000,
      studio: 250_000_000_000,
      agency: 1_000_000_000_000,
    });
  });

  it('covers every tier the subscription_tier enum can hold', () => {
    expect(Object.keys(TIER_STORAGE_BYTES).sort()).toEqual(
      [...schema.subscriptionTier.enumValues].sort(),
    );
  });

  it('stays inside the safe-integer range, so byte arithmetic never rounds', () => {
    for (const limit of Object.values(TIER_STORAGE_BYTES)) {
      expect(Number.isSafeInteger(limit)).toBe(true);
    }
  });
});

describe('checkStorageQuota — the boundary at every tier', () => {
  it.each(ALL_TIERS)('allows an upload that exactly reaches the %s limit', async (tier) => {
    const coach = await makeCoach(tier);
    const limit = TIER_STORAGE_BYTES[tier];
    await seedUsage(coach.userId, limit - 1_000);

    await expect(checkStorageQuota(db, coach.userId, 1_000)).resolves.toEqual({ ok: true });
  });

  it.each(ALL_TIERS)('rejects one byte past the %s limit', async (tier) => {
    const coach = await makeCoach(tier);
    const limit = TIER_STORAGE_BYTES[tier];
    await seedUsage(coach.userId, limit - 1_000);

    await expect(checkStorageQuota(db, coach.userId, 1_001)).resolves.toEqual({
      ok: false,
      bytesUsed: limit - 1_000,
      bytesLimit: limit,
    });
  });

  it('rejects when the counter is already at the limit and the upload is a single byte', async () => {
    const coach = await makeCoach('starter');
    await seedUsage(coach.userId, TIER_STORAGE_BYTES.starter);

    await expect(checkStorageQuota(db, coach.userId, 1)).resolves.toEqual({
      ok: false,
      bytesUsed: TIER_STORAGE_BYTES.starter,
      bytesLimit: TIER_STORAGE_BYTES.starter,
    });
  });

  it('allows a zero-byte upload for a coach sitting exactly at the limit', async () => {
    const coach = await makeCoach('coach');
    await seedUsage(coach.userId, TIER_STORAGE_BYTES.coach);

    await expect(checkStorageQuota(db, coach.userId, 0)).resolves.toEqual({ ok: true });
  });

  // The tier is read, not assumed. Same bytes, same request, two answers —
  // which is the whole point of the table.
  it('answers the same request differently for two tiers', async () => {
    const starter = await makeCoach('starter');
    const pro = await makeCoach('pro');
    const bytes = TIER_STORAGE_BYTES.starter + 1;

    await expect(checkStorageQuota(db, starter.userId, bytes)).resolves.toMatchObject({
      ok: false,
    });
    await expect(checkStorageQuota(db, pro.userId, bytes)).resolves.toEqual({ ok: true });
  });
});

describe('checkStorageQuota — the counter row', () => {
  it("treats a coach who has never uploaded as zero used, not as 'no answer'", async () => {
    const coach = await makeCoach('starter');

    await expect(checkStorageQuota(db, coach.userId, 1_024)).resolves.toEqual({ ok: true });
  });

  it('reports a fresh coach over quota with bytesUsed 0 rather than a missing field', async () => {
    const coach = await makeCoach('starter');

    await expect(
      checkStorageQuota(db, coach.userId, TIER_STORAGE_BYTES.starter + 1),
    ).resolves.toEqual({ ok: false, bytesUsed: 0, bytesLimit: TIER_STORAGE_BYTES.starter });
  });

  it('refuses a user id that names no coach rather than guessing a tier', async () => {
    const clientUserId = await makeUser('client');

    await expect(checkStorageQuota(db, clientUserId, 1_024)).rejects.toThrow(/no coach profile/);
  });
});

describe('checkStorageQuota — the tenant meter (P11 README, resolved ambiguities)', () => {
  // The bug this task exists not to write. Both rows are near the limit in
  // opposite directions, so an implementation reading the wrong one gives
  // the opposite answer to each assertion.
  it("reads the coach's row and ignores the uploading client's", async () => {
    const coach = await makeCoach('starter');
    const clientUserId = await makeUser('client');

    await seedUsage(coach.userId, 1_000);
    await seedUsage(clientUserId, TIER_STORAGE_BYTES.starter);

    await expect(checkStorageQuota(db, coach.userId, 1_000)).resolves.toEqual({ ok: true });
  });

  it("refuses when the coach's row is full even though the client's is empty", async () => {
    const coach = await makeCoach('starter');
    await makeUser('client');

    await seedUsage(coach.userId, TIER_STORAGE_BYTES.starter);

    await expect(checkStorageQuota(db, coach.userId, 1)).resolves.toMatchObject({ ok: false });
  });
});

describe('checkStorageQuota — one indexed read (the feature acceptance criterion)', () => {
  it('issues exactly one database query', async () => {
    const coach = await makeCoach('pro');
    await seedUsage(coach.userId, 1_000);
    const counted = countingDb(db);

    await checkStorageQuota(counted.db, coach.userId, 1_000);

    expect(counted.queries()).toBe(1);
  });

  it('issues the same one query for a coach with no counter row', async () => {
    const coach = await makeCoach('pro');
    const counted = countingDb(db);

    await checkStorageQuota(counted.db, coach.userId, 1_000);

    expect(counted.queries()).toBe(1);
  });

  it('issues the same one query on the rejecting path', async () => {
    const coach = await makeCoach('starter');
    await seedUsage(coach.userId, TIER_STORAGE_BYTES.starter);
    const counted = countingDb(db);

    await checkStorageQuota(counted.db, coach.userId, 1);

    expect(counted.queries()).toBe(1);
  });

  // Directly rules out `SUM(size_bytes) FROM media_assets`: the assets say
  // the coach is far over, the counter says they are nearly empty, and the
  // counter is the only thing a quota check may believe. The query count
  // above proves it is one statement; this proves it is the right one.
  it('believes the counter, not a SUM over media_assets', async () => {
    const coach = await makeCoach('starter');
    await seedUsage(coach.userId, 1_000);
    await seedAsset(coach, TIER_STORAGE_BYTES.starter);
    await seedAsset(coach, TIER_STORAGE_BYTES.starter);

    await expect(checkStorageQuota(db, coach.userId, 1_000)).resolves.toEqual({ ok: true });
  });

  // A coach's library growing must not add a statement, which is what a
  // `count(*)`/`SUM` over `media_assets` — or a per-asset loop — would do.
  it('does not grow the query count with the number of assets', async () => {
    const empty = await makeCoach('pro');
    const full = await makeCoach('pro');
    for (let i = 0; i < 25; i += 1) {
      await seedAsset(full, 1_000);
    }

    const emptyCount = countingDb(db);
    const fullCount = countingDb(db);
    await checkStorageQuota(emptyCount.db, empty.userId, 1_000);
    await checkStorageQuota(fullCount.db, full.userId, 1_000);

    expect(fullCount.queries()).toBe(emptyCount.queries());
    expect(fullCount.queries()).toBe(1);
  });
});

describe('checkStorageQuota — input guards', () => {
  it('rejects a negative byte count rather than letting it buy quota back', async () => {
    const coach = await makeCoach('starter');
    await seedUsage(coach.userId, TIER_STORAGE_BYTES.starter);

    await expect(checkStorageQuota(db, coach.userId, -1_000)).rejects.toThrow(/non-negative/);
  });

  it('rejects a non-integer byte count', async () => {
    const coach = await makeCoach('starter');

    await expect(checkStorageQuota(db, coach.userId, 1.5)).rejects.toThrow(/integer/);
  });
});

describe('checkStorageQuota — what it does not read', () => {
  it('never reads the counter row of a coach it was not asked about', async () => {
    const asked = await makeCoach('starter');
    const other = await makeCoach('agency');
    await seedUsage(asked.userId, TIER_STORAGE_BYTES.starter);
    await seedUsage(other.userId, 0);

    // Agency's headroom must not leak into the starter coach's answer.
    await expect(checkStorageQuota(db, asked.userId, 1)).resolves.toEqual({
      ok: false,
      bytesUsed: TIER_STORAGE_BYTES.starter,
      bytesLimit: TIER_STORAGE_BYTES.starter,
    });
  });

  it('leaves the counter untouched — a check is a read, never a write', async () => {
    const coach = await makeCoach('pro');
    await seedUsage(coach.userId, 4_096);

    await checkStorageQuota(db, coach.userId, 1_000);

    const [row] = await db
      .select({
        bytesUsed: schema.storageUsage.bytesUsed,
        assetCount: schema.storageUsage.assetCount,
      })
      .from(schema.storageUsage)
      .where(eq(schema.storageUsage.userId, coach.userId));
    expect(row).toEqual({ bytesUsed: 4_096, assetCount: 1 });
  });
});
