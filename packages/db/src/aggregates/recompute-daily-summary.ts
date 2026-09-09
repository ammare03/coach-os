// PLACEHOLDER — DB§8.2. Real adherence-aware logic belongs to
// phase-13-nutrition/nutrition-summary/01-recompute-daily-summary.md, not
// here. See README.md for the full pairing requirement and which write
// paths must call this.
//
// F6 (pre-phase-09 audit): throws rather than upserting a zeroed row.
// `v_client_overview.nutrition_adherence_7d` (DATABASE.md) averages this
// table directly — a zeroed row reads as "this client ate nothing," not as
// "not computed yet," and the adherence dashboard would show every client
// as non-compliant. Matching recompute-personal-records.ts's precedent: no
// safe placeholder value, so this writes nothing at all.
import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction as any insert, update, or
 * delete against `nutrition.meal_items` for this client/date. Never call
 * outside a transaction, and never open a new transaction inside this
 * function — `tx` is always the caller's own handle.
 */
export async function recomputeDailySummary(
  _tx: Transaction,
  clientId: string,
  loggedDate: string,
): Promise<void> {
  throw new Error(
    `recomputeDailySummary(${clientId}, ${loggedDate}) is unimplemented — ` +
      'phase-13-nutrition/nutrition-summary/01-recompute-daily-summary.md owns the real ' +
      'adherence formula. Do not call this stub from a real write path.',
  );
}
