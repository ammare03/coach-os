// PLACEHOLDER — DB§8.2. Real byte-counting logic belongs to
// phase-11-media-pipeline/retention-and-quota, not here. See README.md.
import { storageUsage } from '../schema/platform.ts';

import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction as any `coaching.media_assets`
 * insert or (soft-)delete for this user.
 */
export async function recomputeStorageUsage(tx: Transaction, userId: string): Promise<void> {
  await tx
    .insert(storageUsage)
    .values({
      userId,
      // PLACEHOLDER values — real counters arrive with the quota-tracking logic.
      bytesUsed: 0,
      assetCount: 0,
    })
    .onConflictDoUpdate({
      target: storageUsage.userId,
      set: { bytesUsed: 0, assetCount: 0, updatedAt: new Date() },
    });
}
