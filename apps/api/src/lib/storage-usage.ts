// `platform.storage_usage` is a counter table, not a `SUM()` over
// `media_assets` (DB§5.5's own comment): a quota check runs on EVERY upload
// and scanning the asset table each time is the first thing that falls over.
// A counter is only worth trusting if every write in the system goes through
// one place, so this module is that place — `upload-server/02`'s
// `confirmUpload` on the way in, `retention-and-quota/04`'s object removal
// and any user-initiated delete on the way out.
//
// ── The tenant meter (P11 README, "Resolved ambiguities") ────────────────
//
// DB§5.5 keys the table by `user_id`, but CLAUDE.md §12 sets storage quotas
// per COACH TIER, and what fills a coach's quota is mostly their clients'
// videos. So one asset touches two rows:
//
//   • the COACH's row  — the tenant meter, and the only row a quota check
//     reads (`upload-server/03`).
//   • the uploader's own row — attribution, read by DB§19.2's per-user purge
//     accounting. For a client's upload that is the client's row; for a
//     coach's own upload (a demo video, an avatar) there is no second row
//     and the coach's row is both.
//
// Hence `recordAssetStored`/`recordAssetRemoved` below, which branch on
// whether the asset has a client behind it. Callers use those; the two
// single-row primitives are exported for the paths that genuinely know
// which one row they mean.
import { schema, type DbClient, type Transaction } from '@coachos/db';
import { sql } from 'drizzle-orm';

import { logger } from './logger.ts';

const { storageUsage } = schema;

/** A pool handle or a transaction handle — DB§8.2 wants the caller's transaction. */
export type StorageUsageDb = DbClient | Transaction;

export type AssetStorageAttribution = {
  /** The coach's `users.id`. Always metered — this is the tenant meter. */
  coachUserId: string;
  /**
   * The client's `users.id` when the asset was uploaded by a client;
   * `null`/omitted for a coach's own upload, which meters one row only.
   */
  clientUserId?: string | null;
  bytes: number;
};

function assertBytes(bytes: number): void {
  if (!Number.isInteger(bytes)) {
    throw new Error('storage usage byte count must be an integer');
  }
  if (bytes < 0) {
    throw new Error('storage usage byte count must be non-negative');
  }
}

/**
 * `INSERT ... ON CONFLICT DO UPDATE`, never a read-then-write. The addition
 * happens inside the statement, so two concurrent uploads for the same user
 * serialise on the row lock and the second one adds to the row the first
 * just committed. Reading the row into JS first and writing back a computed
 * total loses one of them, silently, and only under real load.
 *
 * `updated_at` is left to migration 0021's `touch_updated_at` trigger.
 */
export async function incrementStorageUsage(
  db: StorageUsageDb,
  userId: string,
  bytes: number,
): Promise<void> {
  assertBytes(bytes);

  await db
    .insert(storageUsage)
    .values({ userId, bytesUsed: bytes, assetCount: 1 })
    .onConflictDoUpdate({
      target: storageUsage.userId,
      set: {
        bytesUsed: sql`${storageUsage.bytesUsed} + excluded.bytes_used`,
        assetCount: sql`${storageUsage.assetCount} + excluded.asset_count`,
      },
    });
}

type DecrementRow = { bytes_before: string };

/**
 * The mirror of `incrementStorageUsage`, and deliberately not an upsert: a
 * decrement for a user with no counter row means an increment was missed
 * somewhere, so creating the row here would paper over the bug.
 *
 * `GREATEST(..., 0)` clamps — a negative `bytes_used` would make every
 * subsequent quota check wrong in the coach's favour until someone noticed.
 * But a clamp that fires is itself evidence of a missed increment, so it is
 * logged as a discrepancy rather than absorbed. This module has no
 * reconciliation against `SUM(media_assets.size_bytes)`; these two warnings
 * are the only drift signal that exists today.
 *
 * One statement, not a read followed by a write: `FOR UPDATE` in the first
 * CTE takes the row lock and, under READ COMMITTED, re-reads the latest
 * committed row, so the `bytes_before` the discrepancy check sees is the
 * value the update actually subtracted from.
 */
export async function decrementStorageUsage(
  db: StorageUsageDb,
  userId: string,
  bytes: number,
): Promise<void> {
  assertBytes(bytes);

  const rows = await db.execute<DecrementRow>(sql`
    WITH locked AS (
      SELECT user_id, bytes_used, asset_count
      FROM ${storageUsage}
      WHERE user_id = ${userId}
      FOR UPDATE
    ), updated AS (
      UPDATE ${storageUsage} AS s
      SET bytes_used  = GREATEST(l.bytes_used - ${bytes}::bigint, 0),
          asset_count = GREATEST(l.asset_count - 1, 0)
      FROM locked l
      WHERE s.user_id = l.user_id
      RETURNING s.user_id
    )
    SELECT l.bytes_used::text AS bytes_before
    FROM locked l
    JOIN updated u ON u.user_id = l.user_id
  `);

  const [row] = rows;
  if (row === undefined) {
    logger.warn('storage_usage.decrement_missing_row', { userId, bytes });
    return;
  }

  if (Number(row.bytes_before) < bytes) {
    logger.warn('storage_usage.decrement_below_zero', {
      userId,
      bytes,
      count: Number(row.bytes_before),
    });
  }
}

/**
 * Resolves the attribution to the one or two rows an asset actually meters,
 * in a fixed coach-then-client order. The order is not cosmetic: two
 * transactions touching the same pair in opposite orders deadlock, and a
 * consistent order makes that impossible.
 */
function meteredUserIds({ coachUserId, clientUserId }: AssetStorageAttribution): string[] {
  return clientUserId == null || clientUserId === coachUserId
    ? [coachUserId]
    : [coachUserId, clientUserId];
}

/** `upload-server/02`'s `confirmUpload` — call inside the same transaction as the asset write. */
export async function recordAssetStored(
  db: StorageUsageDb,
  asset: AssetStorageAttribution,
): Promise<void> {
  for (const userId of meteredUserIds(asset)) {
    await incrementStorageUsage(db, userId, asset.bytes);
  }
}

/** Every deletion path — the retention sweep's R2 removal, and user-initiated delete. */
export async function recordAssetRemoved(
  db: StorageUsageDb,
  asset: AssetStorageAttribution,
): Promise<void> {
  for (const userId of meteredUserIds(asset)) {
    await decrementStorageUsage(db, userId, asset.bytes);
  }
}
