// Real Postgres (`testing` skill §4). Every assertion here is about an
// ordering or an authorisation boundary — "no row exists after a rejected
// call", "the row is `uploading` before any URL is handed out", "a coach
// cannot scope an upload to another coach's client" — and none of those
// lives in application logic a mock could observe.
//
// R2 is split deliberately: `createMultipartUpload` is the one genuine
// network call in the path and is mocked, while `getSignedUploadPartUrl`
// runs for real. SigV4 signing is pure local crypto, so the URLs asserted
// below are the same ones production mints, not fixtures shaped like them.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { media } from '@coachos/schemas';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import { mediaOriginalKey } from '../../lib/r2-keys.ts';
import { createMultipartUpload, completeMultipartUpload } from '../../lib/storage/r2-client.ts';
import { TIER_STORAGE_BYTES } from '../../lib/storage-quota.ts';
import { recordAssetStored } from '../../lib/storage-usage.ts';
import { enqueueMediaTranscode } from '../../queues/enqueue.ts';
import type { Context, ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

// Hoisted above every import above, including the one it replaces.
jest.mock('../../lib/storage/r2-client.ts', () => ({
  ...jest.requireActual('../../lib/storage/r2-client.ts'),
  createMultipartUpload: jest.fn(async () => 'test-multipart-upload-id'),
  completeMultipartUpload: jest.fn(async () => undefined),
}));

// The queue, not Redis: importing `queues/registry.ts` for real opens a
// BullMQ connection this suite has no server for. Counting calls here is
// also how the idempotency criterion is proven *directly* rather than
// inferred from BullMQ's own `jobId` dedup — that dedup is real (and
// covered against a live Redis by `queues/enqueue.test.ts`), but a
// procedure that enqueues twice and is saved by it is still a procedure
// that double-counts bytes.
jest.mock('../../queues/enqueue.ts', () => ({
  enqueueMediaTranscode: jest.fn(async () => undefined),
}));

// Real by default — the counter's own arithmetic is the thing under test —
// and replaceable for the one case that has to fail mid-transaction.
jest.mock('../../lib/storage-usage.ts', () => {
  const actual = jest.requireActual('../../lib/storage-usage.ts');
  return { ...actual, recordAssetStored: jest.fn(actual.recordAssetStored) };
});

const createMultipartUploadMock = createMultipartUpload as jest.MockedFunction<
  typeof createMultipartUpload
>;
const completeMultipartUploadMock = completeMultipartUpload as jest.MockedFunction<
  typeof completeMultipartUpload
>;
const enqueueMediaTranscodeMock = enqueueMediaTranscode as jest.MockedFunction<
  typeof enqueueMediaTranscode
>;
const recordAssetStoredMock = recordAssetStored as jest.MockedFunction<typeof recordAssetStored>;

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

beforeEach(() => {
  createMultipartUploadMock.mockClear();
  createMultipartUploadMock.mockResolvedValue('test-multipart-upload-id');
  completeMultipartUploadMock.mockClear();
  completeMultipartUploadMock.mockResolvedValue(undefined);
  enqueueMediaTranscodeMock.mockClear();
  recordAssetStoredMock.mockClear();
});

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

function clientA1User(): ContextUser {
  return {
    id: fixture.clientA1.userId,
    email: 'client-a1@two-coaches-fixture.com',
    role: 'client',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: null,
    clientProfileId: fixture.clientA1.profileId,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

function callerFor(user: ContextUser) {
  const ctx: Context = createTestContext({ db, user });
  return appRouter.createCaller(ctx);
}

/**
 * Every `media_assets` row minted during this run, so a rejection test can
 * assert "none of mine exist" without the fixture's own seeded assets
 * counting against it.
 */
async function assetCountFor(ownerUserId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.mediaAssets.id })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.ownerUserId, ownerUserId));
  return rows.length;
}

const VIDEO = {
  kind: 'video',
  mimeType: 'video/mp4',
  sizeBytes: 12 * 1024 * 1024,
  durationSeconds: 42,
} as const;

describe('media.createUploadUrl — the happy path', () => {
  it("writes the row in 'uploading' and returns one presigned URL per 5MB part", async () => {
    const result = await callerFor(clientA1User()).media.createUploadUrl({
      ...VIDEO,
      workoutSessionId: fixture.clientA1.workoutSessionId,
    });

    expect(result.partSizeBytes).toBe(5 * 1024 * 1024);
    // 12MB over 5MB parts is three parts: 5 + 5 + 2.
    expect(result.uploadUrls).toHaveLength(3);
    expect(result.uploadUrls.map((part) => part.partNumber)).toEqual([1, 2, 3]);

    const [row] = await db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, result.assetId));

    expect(row).toBeDefined();
    expect(row?.processingStatus).toBe('uploading');
    expect(row?.visibility).toBe('coach_only');
    expect(row?.kind).toBe('video');
    expect(row?.ownerUserId).toBe(fixture.clientA1.userId);
    expect(row?.clientId).toBe(fixture.clientA1.profileId);
    expect(row?.coachId).toBe(fixture.coachA.profileId);
    expect(row?.workoutSessionId).toBe(fixture.clientA1.workoutSessionId);
    expect(row?.sizeBytes).toBe(VIDEO.sizeBytes);
  });

  it('produces a storage key only the keyspace module could have built', async () => {
    const result = await callerFor(clientA1User()).media.createUploadUrl(VIDEO);

    const [row] = await db
      .select({ storageKey: schema.mediaAssets.storageKey })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, result.assetId));

    expect(row?.storageKey).toBe(mediaOriginalKey(fixture.clientA1.userId, result.assetId, 'mp4'));
  });

  it('returns well-formed presigned R2 URLs, one per part, each carrying the upload id', async () => {
    const result = await callerFor(clientA1User()).media.createUploadUrl(VIDEO);

    for (const part of result.uploadUrls) {
      const url = new URL(part.url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname.endsWith('r2.cloudflarestorage.com')).toBe(true);
      expect(url.searchParams.get('partNumber')).toBe(String(part.partNumber));
      expect(url.searchParams.get('uploadId')).toBe('test-multipart-upload-id');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Credential')).toBeTruthy();
      // security-and-privacy §4's ceiling: never longer than an hour.
      expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(3600);
    }
  });

  it('lets a coach upload a demo video with no client behind it', async () => {
    const result = await callerFor(coachAUser()).media.createUploadUrl({
      kind: 'image',
      mimeType: 'image/jpeg',
      sizeBytes: 400 * 1024,
    });

    const [row] = await db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, result.assetId));

    expect(row?.ownerUserId).toBe(fixture.coachA.userId);
    expect(row?.coachId).toBe(fixture.coachA.profileId);
    expect(row?.clientId).toBeNull();
    expect(row?.visibility).toBe('coach_only');
    // Under 5MB is a single part, never zero.
    expect(result.uploadUrls).toHaveLength(1);
  });
});

describe('media.createUploadUrl — per-clip limits are checked before any write', () => {
  it('refuses a 91-second clip and leaves no row behind', async () => {
    const before = await assetCountFor(fixture.clientA1.userId);

    await expect(
      callerFor(clientA1User()).media.createUploadUrl({ ...VIDEO, durationSeconds: 91 }),
    ).rejects.toMatchObject({ cause: { appCode: 'MEDIA_DURATION_TOO_LONG' } });

    expect(await assetCountFor(fixture.clientA1.userId)).toBe(before);
    expect(createMultipartUploadMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 90 seconds — the limit is a ceiling, not an exclusion', async () => {
    await expect(
      callerFor(clientA1User()).media.createUploadUrl({ ...VIDEO, durationSeconds: 90 }),
    ).resolves.toMatchObject({ partSizeBytes: 5 * 1024 * 1024 });
  });

  it('refuses a clip over 200MB and leaves no row behind', async () => {
    const before = await assetCountFor(fixture.clientA1.userId);

    await expect(
      callerFor(clientA1User()).media.createUploadUrl({
        ...VIDEO,
        sizeBytes: 200 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({
      cause: { appCode: 'PAYLOAD_TOO_LARGE', details: { maxBytes: 200 * 1024 * 1024 } },
    });

    expect(await assetCountFor(fixture.clientA1.userId)).toBe(before);
    expect(createMultipartUploadMock).not.toHaveBeenCalled();
  });

  it('refuses a video that declares no duration, rather than defaulting one', async () => {
    const before = await assetCountFor(fixture.clientA1.userId);

    await expect(
      callerFor(clientA1User()).media.createUploadUrl({
        kind: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'VALIDATION_FAILED' } });

    expect(await assetCountFor(fixture.clientA1.userId)).toBe(before);
  });

  it('refuses a kind that disagrees with its mime type', async () => {
    await expect(
      callerFor(clientA1User()).media.createUploadUrl({
        kind: 'image',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'VALIDATION_FAILED' } });
  });
});

describe('media.createUploadUrl — the storage quota', () => {
  /**
   * The fixture counter is shared with every `confirmUpload` test below, so
   * each case here snapshots it, overrides it, and puts it back. Restoring a
   * `{0, 0}` row where none existed is indistinguishable downstream —
   * `usageFor` reads both as zero.
   */
  async function withUsage(
    userId: string,
    bytesUsed: number,
    run: () => Promise<void>,
  ): Promise<void> {
    const snapshot = await usageFor(userId);
    await setUsage(userId, bytesUsed, 1);
    try {
      await run();
    } finally {
      await setUsage(userId, snapshot.bytesUsed, snapshot.assetCount);
    }
  }

  it('refuses an upload that would take the coach past their tier limit, and leaves no row behind', async () => {
    // coachA is on the default Starter tier (3 GB, §15.2), so one byte of
    // headroom under a 12MB clip is over.
    await withUsage(
      fixture.coachA.userId,
      TIER_STORAGE_BYTES.starter - VIDEO.sizeBytes + 1,
      async () => {
        const before = await assetCountFor(fixture.clientA1.userId);

        await expect(
          callerFor(clientA1User()).media.createUploadUrl({
            ...VIDEO,
            workoutSessionId: fixture.clientA1.workoutSessionId,
          }),
        ).rejects.toMatchObject({
          cause: {
            appCode: 'STORAGE_QUOTA_EXCEEDED',
            details: {
              usedBytes: TIER_STORAGE_BYTES.starter - VIDEO.sizeBytes + 1,
              limitBytes: TIER_STORAGE_BYTES.starter,
            },
          },
        });

        // Refused before the insert and before any presigning, so there is no
        // orphan row and no live credential to clean up.
        expect(await assetCountFor(fixture.clientA1.userId)).toBe(before);
        expect(createMultipartUploadMock).not.toHaveBeenCalled();
      },
    );
  });

  it('allows an upload that exactly reaches the limit — a ceiling, not an exclusion', async () => {
    await withUsage(
      fixture.coachA.userId,
      TIER_STORAGE_BYTES.starter - VIDEO.sizeBytes,
      async () => {
        await expect(
          callerFor(clientA1User()).media.createUploadUrl({
            ...VIDEO,
            workoutSessionId: fixture.clientA1.workoutSessionId,
          }),
        ).resolves.toMatchObject({ partSizeBytes: media.UPLOAD_PART_SIZE_BYTES });
      },
    );
  });

  it("gates a coach's own upload too, and tells them about their plan", async () => {
    await withUsage(fixture.coachA.userId, TIER_STORAGE_BYTES.starter, async () => {
      await expect(callerFor(coachAUser()).media.createUploadUrl(VIDEO)).rejects.toMatchObject({
        cause: { appCode: 'STORAGE_QUOTA_EXCEEDED' },
        message: expect.stringContaining('your plan'),
      });
    });
  });

  // `product-copy` §3's asymmetry, and §15.4's "never gate anything the
  // client experiences" softened to its enforceable form: storage IS gated,
  // so the client can be refused — but never by being handed their coach's
  // commercial state.
  it("never tells a client about their coach's plan", async () => {
    await withUsage(fixture.coachA.userId, TIER_STORAGE_BYTES.starter, async () => {
      const error = await callerFor(clientA1User())
        .media.createUploadUrl({ ...VIDEO, workoutSessionId: fixture.clientA1.workoutSessionId })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ cause: { appCode: 'STORAGE_QUOTA_EXCEEDED' } });
      const { message } = error as { message: string };
      expect(message).not.toMatch(/plan|upgrade/i);
      expect(message).toContain('Your coach');
    });
  });

  // The tenant meter (P11 README, "Resolved ambiguities"), asserted through
  // the procedure rather than the library: the client's own row is full and
  // the coach's is empty, so an implementation metering the uploader would
  // refuse this.
  it("meters a client's upload against the coach's row, never the client's own", async () => {
    await withUsage(fixture.coachA.userId, 0, async () => {
      await withUsage(fixture.clientA1.userId, TIER_STORAGE_BYTES.starter, async () => {
        await expect(
          callerFor(clientA1User()).media.createUploadUrl({
            ...VIDEO,
            workoutSessionId: fixture.clientA1.workoutSessionId,
          }),
        ).resolves.toMatchObject({ partSizeBytes: media.UPLOAD_PART_SIZE_BYTES });
      });
    });
  });
});

describe('media.createUploadUrl — the row exists before the URLs do', () => {
  it('leaves a discoverable uploading row when presigning fails', async () => {
    createMultipartUploadMock.mockRejectedValueOnce(new Error('R2 unreachable'));
    const before = await assetCountFor(fixture.clientA1.userId);

    await expect(callerFor(clientA1User()).media.createUploadUrl(VIDEO)).rejects.toBeDefined();

    // The whole point of the ordering (`upload-server/01`'s Risks): a client
    // that dies between the insert and the first byte leaves an orphan row
    // DB§16's sweep can find, never silent bytes with nothing pointing at them.
    expect(await assetCountFor(fixture.clientA1.userId)).toBe(before + 1);
  });
});

describe('media.createUploadUrl — ownership', () => {
  it("refuses a client scoping an upload to another coach's client's session", async () => {
    const before = await assetCountFor(fixture.clientA1.userId);

    await expect(
      callerFor(clientA1User()).media.createUploadUrl({
        ...VIDEO,
        workoutSessionId: fixture.clientB1.workoutSessionId,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });

    expect(await assetCountFor(fixture.clientA1.userId)).toBe(before);
  });

  it("refuses a coach scoping an upload to another coach's client's set log", async () => {
    const before = await assetCountFor(fixture.coachA.userId);

    await expect(
      callerFor(coachAUser()).media.createUploadUrl({
        ...VIDEO,
        setLogId: fixture.clientB1.setLogId,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });

    expect(await assetCountFor(fixture.coachA.userId)).toBe(before);
  });

  it("accepts a coach scoping an upload to their own client's session", async () => {
    const result = await callerFor(coachAUser()).media.createUploadUrl({
      ...VIDEO,
      workoutSessionId: fixture.clientA1.workoutSessionId,
    });

    const [row] = await db
      .select({ clientId: schema.mediaAssets.clientId, coachId: schema.mediaAssets.coachId })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, result.assetId));

    expect(row?.coachId).toBe(fixture.coachA.profileId);
    // The session names the client, so the asset is attributed to them even
    // though the coach is the one who uploaded it.
    expect(row?.clientId).toBe(fixture.clientA1.profileId);
  });
});

describe('media.createUploadUrl — schema constants', () => {
  it('states the two §8.6 per-clip limits once, shared with the client', () => {
    expect(media.MAX_CLIP_BYTES).toBe(200 * 1024 * 1024);
    expect(media.MAX_CLIP_DURATION_SECONDS).toBe(90);
    expect(media.UPLOAD_PART_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});

// ── media.confirmUpload ────────────────────────────────────────────────

/**
 * The fixture users are shared across every test in this file and the
 * counter accumulates, so every storage assertion below is a delta. An
 * absolute assertion here would pass alone and fail in suite order.
 */
async function usageFor(userId: string): Promise<{ bytesUsed: number; assetCount: number }> {
  const [row] = await db
    .select({
      bytesUsed: schema.storageUsage.bytesUsed,
      assetCount: schema.storageUsage.assetCount,
    })
    .from(schema.storageUsage)
    .where(eq(schema.storageUsage.userId, userId));
  return row ?? { bytesUsed: 0, assetCount: 0 };
}

/** Puts a counter row at an exact value — the quota tests above drive it directly. */
async function setUsage(userId: string, bytesUsed: number, assetCount: number): Promise<void> {
  await db
    .insert(schema.storageUsage)
    .values({ userId, bytesUsed, assetCount })
    .onConflictDoUpdate({
      target: schema.storageUsage.userId,
      set: { bytesUsed, assetCount },
    });
}

async function statusOf(assetId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ processingStatus: schema.mediaAssets.processingStatus })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.id, assetId));
  return row?.processingStatus;
}

/** Three ETags, in the order a client that uploaded parts 1..3 would send them. */
const PARTS = [
  { partNumber: 1, etag: '"6bcf86bed7a0a6fdd1e0f0a1d0d0a001"' },
  { partNumber: 2, etag: '"6bcf86bed7a0a6fdd1e0f0a1d0d0a002"' },
  { partNumber: 3, etag: '"6bcf86bed7a0a6fdd1e0f0a1d0d0a003"' },
];

/** Anything under 5MB uploads as one part. */
const SINGLE_PART = [{ partNumber: 1, etag: '"6bcf86bed7a0a6fdd1e0f0a1d0d0a0aa"' }];

/** A client's 12MB video, uploaded but not yet confirmed. */
async function startClientUpload(): Promise<{ assetId: string; uploadId: string }> {
  const result = await callerFor(clientA1User()).media.createUploadUrl({
    ...VIDEO,
    workoutSessionId: fixture.clientA1.workoutSessionId,
  });
  createMultipartUploadMock.mockClear();
  return { assetId: result.assetId, uploadId: result.uploadId };
}

describe('media.confirmUpload — the handoff to the worker', () => {
  it('completes the multipart upload with the exact parts the client supplied', async () => {
    const { assetId, uploadId } = await startClientUpload();

    await callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS });

    expect(completeMultipartUploadMock).toHaveBeenCalledTimes(1);
    expect(completeMultipartUploadMock).toHaveBeenCalledWith(
      mediaOriginalKey(fixture.clientA1.userId, assetId, 'mp4'),
      uploadId,
      PARTS,
    );
  });

  it("flips the asset to 'processing' and meters the coach and the client once each", async () => {
    const coachBefore = await usageFor(fixture.coachA.userId);
    const clientBefore = await usageFor(fixture.clientA1.userId);
    const { assetId, uploadId } = await startClientUpload();

    const result = await callerFor(clientA1User()).media.confirmUpload({
      assetId,
      uploadId,
      parts: PARTS,
    });

    expect(result).toEqual({ status: 'processing' });
    expect(await statusOf(assetId)).toBe('processing');

    // The coach's row is the tenant meter and the client's row is
    // attribution (P11 README, "Resolved ambiguities"). Both move; they are
    // never summed.
    const coachAfter = await usageFor(fixture.coachA.userId);
    const clientAfter = await usageFor(fixture.clientA1.userId);
    expect(coachAfter.bytesUsed - coachBefore.bytesUsed).toBe(VIDEO.sizeBytes);
    expect(coachAfter.assetCount - coachBefore.assetCount).toBe(1);
    expect(clientAfter.bytesUsed - clientBefore.bytesUsed).toBe(VIDEO.sizeBytes);
    expect(clientAfter.assetCount - clientBefore.assetCount).toBe(1);
  });

  it('enqueues exactly one transcode job, naming the asset', async () => {
    const { assetId, uploadId } = await startClientUpload();

    await callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS });

    expect(enqueueMediaTranscodeMock).toHaveBeenCalledTimes(1);
    expect(enqueueMediaTranscodeMock).toHaveBeenCalledWith({ assetId });
  });

  it("meters one row for a coach's own upload, not two", async () => {
    const before = await usageFor(fixture.coachA.userId);
    const created = await callerFor(coachAUser()).media.createUploadUrl({
      kind: 'image',
      mimeType: 'image/jpeg',
      sizeBytes: 400 * 1024,
    });

    await callerFor(coachAUser()).media.confirmUpload({
      assetId: created.assetId,
      uploadId: created.uploadId,
      parts: SINGLE_PART,
    });

    const after = await usageFor(fixture.coachA.userId);
    expect(after.bytesUsed - before.bytesUsed).toBe(400 * 1024);
    expect(after.assetCount - before.assetCount).toBe(1);
  });
});

describe('media.confirmUpload — idempotency', () => {
  it('increments once and enqueues once when called twice on the same asset', async () => {
    const coachBefore = await usageFor(fixture.coachA.userId);
    const clientBefore = await usageFor(fixture.clientA1.userId);
    const { assetId, uploadId } = await startClientUpload();

    const first = await callerFor(clientA1User()).media.confirmUpload({
      assetId,
      uploadId,
      parts: PARTS,
    });
    const second = await callerFor(clientA1User()).media.confirmUpload({
      assetId,
      uploadId,
      parts: PARTS,
    });

    expect(second).toEqual(first);

    // The bug this task exists to not write: an increment outside the
    // `processing_status = 'uploading'` guard double-counts a client's
    // bytes against their coach's quota on any retried confirm.
    const coachAfter = await usageFor(fixture.coachA.userId);
    const clientAfter = await usageFor(fixture.clientA1.userId);
    expect(coachAfter.bytesUsed - coachBefore.bytesUsed).toBe(VIDEO.sizeBytes);
    expect(coachAfter.assetCount - coachBefore.assetCount).toBe(1);
    expect(clientAfter.bytesUsed - clientBefore.bytesUsed).toBe(VIDEO.sizeBytes);

    expect(enqueueMediaTranscodeMock).toHaveBeenCalledTimes(1);
    expect(recordAssetStoredMock).toHaveBeenCalledTimes(1);
  });

  it('increments once when two confirms race the same asset', async () => {
    const coachBefore = await usageFor(fixture.coachA.userId);
    const clientBefore = await usageFor(fixture.clientA1.userId);
    const { assetId, uploadId } = await startClientUpload();

    // Holds both calls past their status read and into the transaction at
    // roughly the same moment. Without it the second call would usually
    // see `processing` on its own read and take the replay path, which
    // proves the early return and says nothing about the guard.
    completeMultipartUploadMock.mockImplementation(
      async () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
    );

    const settled = await Promise.allSettled([
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
    ]);

    expect(settled.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await statusOf(assetId)).toBe('processing');

    // `WHERE processing_status = 'uploading'` is the only thing standing
    // here: both calls read `uploading`, both opened a transaction, and
    // exactly one may increment.
    const coachAfter = await usageFor(fixture.coachA.userId);
    const clientAfter = await usageFor(fixture.clientA1.userId);
    expect(coachAfter.bytesUsed - coachBefore.bytesUsed).toBe(VIDEO.sizeBytes);
    expect(coachAfter.assetCount - coachBefore.assetCount).toBe(1);
    expect(clientAfter.bytesUsed - clientBefore.bytesUsed).toBe(VIDEO.sizeBytes);
    expect(enqueueMediaTranscodeMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-assemble the object in R2 on a replay', async () => {
    const { assetId, uploadId } = await startClientUpload();

    await callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS });
    await callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS });

    // R2 answers `NoSuchUpload` to a second completion of the same upload
    // id, so a replay that reached R2 would fail rather than return the
    // first call's result.
    expect(completeMultipartUploadMock).toHaveBeenCalledTimes(1);
  });
});

describe('media.confirmUpload — the counter and the status move together', () => {
  it('leaves the asset in uploading when the counter write fails', async () => {
    const coachBefore = await usageFor(fixture.coachA.userId);
    const { assetId, uploadId } = await startClientUpload();
    recordAssetStoredMock.mockRejectedValueOnce(new Error('counter unavailable'));

    await expect(
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
    ).rejects.toBeDefined();

    // DB§8.2: the derived aggregate and the row it is derived from commit
    // together or not at all.
    expect(await statusOf(assetId)).toBe('uploading');
    expect((await usageFor(fixture.coachA.userId)).bytesUsed).toBe(coachBefore.bytesUsed);
    expect(enqueueMediaTranscodeMock).not.toHaveBeenCalled();
  });

  it('keeps the committed transition when the enqueue fails afterwards', async () => {
    const { assetId, uploadId } = await startClientUpload();
    enqueueMediaTranscodeMock.mockRejectedValueOnce(new Error('redis unreachable'));

    await expect(
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
    ).rejects.toBeDefined();

    // Redis is a separate system, so the enqueue sits outside the SQL
    // transaction — an asset stuck in `processing` with no job is a real
    // failure mode `transcode-worker/` reconciles, not one this procedure
    // can roll back.
    expect(await statusOf(assetId)).toBe('processing');
  });
});

describe('media.confirmUpload — refusals', () => {
  it("refuses another coach's asset without touching R2", async () => {
    await expect(
      callerFor(coachAUser()).media.confirmUpload({
        assetId: fixture.clientB1.mediaAssetId,
        uploadId: 'test-multipart-upload-id',
        parts: PARTS,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'NOT_YOUR_CLIENT' } });

    expect(completeMultipartUploadMock).not.toHaveBeenCalled();
  });

  it('reports a lost upload when R2 refuses to assemble the parts', async () => {
    const coachBefore = await usageFor(fixture.coachA.userId);
    const { assetId, uploadId } = await startClientUpload();
    const lost = Object.assign(new Error('The specified upload does not exist.'), {
      name: 'NoSuchUpload',
    });
    completeMultipartUploadMock.mockRejectedValueOnce(lost);

    await expect(
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
    ).rejects.toMatchObject({ cause: { appCode: 'MEDIA_UPLOAD_INCOMPLETE' } });

    expect(await statusOf(assetId)).toBe('uploading');
    expect((await usageFor(fixture.coachA.userId)).bytesUsed).toBe(coachBefore.bytesUsed);
    expect(enqueueMediaTranscodeMock).not.toHaveBeenCalled();
  });

  it('does not tell a client to re-upload when R2 was merely unreachable', async () => {
    const { assetId, uploadId } = await startClientUpload();
    completeMultipartUploadMock.mockRejectedValueOnce(new Error('socket hang up'));

    // A transport blip is retryable as-is; `MEDIA_UPLOAD_INCOMPLETE` asks
    // for a fresh 200MB upload and must never be the answer to one.
    await expect(
      callerFor(clientA1User()).media.confirmUpload({ assetId, uploadId, parts: PARTS }),
    ).rejects.not.toMatchObject({ cause: { appCode: 'MEDIA_UPLOAD_INCOMPLETE' } });

    expect(await statusOf(assetId)).toBe('uploading');
  });
});
