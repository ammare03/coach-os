// PLACEHOLDER — DB§8.2. Real byte-counting logic (atomic increment/decrement,
// never read-then-write) belongs to
// phase-11-media-pipeline/retention-and-quota/03-storage-usage-counter.md,
// not here. See README.md.
//
// F6 (pre-phase-09 audit): throws rather than upserting 0/0. `storage_usage`
// is read on every upload's quota check (CLAUDE.md §12) — a stub that wrote
// zero would silently pass every quota check instead of failing loudly.
// Matching recompute-personal-records.ts's precedent: no safe placeholder
// value, so this writes nothing at all.
import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction as any `coaching.media_assets`
 * insert or (soft-)delete for this user.
 */
export async function recomputeStorageUsage(_tx: Transaction, userId: string): Promise<void> {
  throw new Error(
    `recomputeStorageUsage(${userId}) is unimplemented — ` +
      'phase-11-media-pipeline/retention-and-quota/03-storage-usage-counter.md owns the real ' +
      'byte-counting logic. Do not call this stub from a real write path.',
  );
}
