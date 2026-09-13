// The gate `media.createUploadUrl` runs before it presigns a single byte
// (`upload-server/03`). Two things about it are acceptance criteria rather
// than implementation detail:
//
//   • It costs ONE indexed row read. `platform.storage_usage` exists
//     precisely so this is not `SUM(size_bytes) FROM media_assets` (DB§5.5's
//     own comment) — a sum gets slower as a coach's library grows, which is
//     exactly when the check has to stay fast. The tier comes back in the
//     same statement via a join on two already-unique keys, so "one read"
//     stays true as the number of facts needed grows.
//
//   • It reads the COACH's row, never the uploading client's (P11 README,
//     "Resolved ambiguities"). Storage is quota'd per coach tier and is
//     mostly filled by clients' videos; metering a client's own row would
//     silently make each client's history the quota unit instead of the
//     coach's whole business.
//
// It checks the DECLARED size before the upload rather than the actual size
// after it. That is what makes this a gate and not an audit — a coach cannot
// discover they are over quota only once the bytes are already paid for.
import { schema, type DbClient, type Transaction } from '@coachos/db';
import type { SubscriptionTier } from '@coachos/utils';
import { eq } from 'drizzle-orm';

import { logger } from './logger.ts';

/** A pool handle or a transaction handle, matching `storage-usage.ts`. */
export type StorageQuotaDb = DbClient | Transaction;

// Decimal GB, not GiB: R2 bills in decimal, so the number a coach is held to
// is the number their storage would be costed from — and it is the reading
// that makes CLAUDE.md §15.2's "1 TB" Agency row and this task's own
// "3/25/100/250/1000 GB" the same figure rather than two.
const BYTES_PER_GB = 1_000_000_000;

/**
 * CLAUDE.md §15.2's storage row, all five tiers.
 *
 * Agency is **finite** here, unlike `deriveClientSeatLimit`'s `Infinity` —
 * §15.2 gives Agency unlimited *clients* but 1 TB of *storage*, and storage
 * is the one that costs money per byte (§22).
 *
 * TODO(phase-20-billing-and-entitlements/entitlement-service/03): fold into
 * the shared tier-constants module alongside `packages/utils`' `TIER_SEATS`.
 * Local until P20 lands, per this task's Approach step 1 — a second copy of
 * a §15.2 figure is a thing to retire, not to keep.
 */
export const TIER_STORAGE_BYTES: Record<SubscriptionTier, number> = {
  starter: 3 * BYTES_PER_GB,
  coach: 25 * BYTES_PER_GB,
  pro: 100 * BYTES_PER_GB,
  studio: 250 * BYTES_PER_GB,
  agency: 1_000 * BYTES_PER_GB,
};

/**
 * `bytesUsed`/`bytesLimit` here; the thrown `STORAGE_QUOTA_EXCEEDED` payload
 * spells them `usedBytes`/`limitBytes` (`@coachos/schemas`' shipped
 * catalogue). The two names differ and both are correct where they sit — the
 * caller maps between them.
 */
export type StorageQuotaResult =
  { ok: true } | { ok: false; bytesUsed: number; bytesLimit: number };

function assertBytes(bytes: number): void {
  if (!Number.isInteger(bytes)) {
    throw new Error('storage quota byte count must be an integer');
  }
  if (bytes < 0) {
    // A negative size would buy quota back, which is a gate a caller could
    // walk through by declaring a smaller upload than it makes.
    throw new Error('storage quota byte count must be non-negative');
  }
}

/**
 * Would storing `additionalBytes` more take this coach past their tier's
 * storage limit?
 *
 * Reaching the limit exactly is allowed; one byte past it is not.
 *
 * @param coachUserId the coach's `identity.users.id` — what
 * `platform.storage_usage` is keyed on. Never a `coach_profiles.id`, and
 * never the uploading client's id.
 */
export async function checkStorageQuota(
  db: StorageQuotaDb,
  coachUserId: string,
  additionalBytes: number,
): Promise<StorageQuotaResult> {
  assertBytes(additionalBytes);

  // One statement, two indexed lookups: `coach_profiles.user_id` is UNIQUE
  // and `storage_usage.user_id` is the primary key. LEFT JOIN because a
  // coach who has never stored anything has no counter row — absent means
  // zero, not "no answer".
  const [row] = await db
    .select({
      tier: schema.coachProfiles.subscriptionTier,
      bytesUsed: schema.storageUsage.bytesUsed,
    })
    .from(schema.coachProfiles)
    .leftJoin(schema.storageUsage, eq(schema.storageUsage.userId, schema.coachProfiles.userId))
    .where(eq(schema.coachProfiles.userId, coachUserId));

  if (row === undefined) {
    // Every caller resolves this id from a coach profile already, so a miss
    // is an invariant violation rather than a user-reachable state. Guessing
    // a tier would either hand out free storage or refuse a paying coach.
    logger.error('storage_quota.coach_profile_missing', { userId: coachUserId });
    throw new Error('storage quota check: no coach profile for that user');
  }

  const bytesUsed = row.bytesUsed ?? 0;
  const bytesLimit = TIER_STORAGE_BYTES[row.tier];

  if (bytesUsed + additionalBytes <= bytesLimit) {
    return { ok: true };
  }
  return { ok: false, bytesUsed, bytesLimit };
}
