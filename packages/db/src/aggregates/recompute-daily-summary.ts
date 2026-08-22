// PLACEHOLDER — DB§8.2. Real adherence-aware logic belongs to
// phase-13-nutrition/nutrition-summary/01, not here. See README.md for
// the full pairing requirement and which write paths must call this.
//
// This stub proves the transactional SHAPE only: it upserts a zeroed row
// inside the caller's own transaction, so once the real formula replaces
// this body, a thrown error anywhere inside it rolls back together with
// whatever meal write triggered the call — never partially applied.
import { dailyNutritionSummary } from '../schema/nutrition.ts';

import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction as any insert, update, or
 * delete against `nutrition.meal_items` for this client/date. Never call
 * outside a transaction, and never open a new transaction inside this
 * function — `tx` is always the caller's own handle.
 */
export async function recomputeDailySummary(
  tx: Transaction,
  clientId: string,
  loggedDate: string,
): Promise<void> {
  await tx
    .insert(dailyNutritionSummary)
    .values({
      clientId,
      date: loggedDate,
      // PLACEHOLDER values — real sums arrive with the adherence formula.
      totalCalories: '0',
      totalProteinG: '0',
      totalCarbsG: '0',
      totalFatG: '0',
    })
    .onConflictDoUpdate({
      target: [dailyNutritionSummary.clientId, dailyNutritionSummary.date],
      set: {
        totalCalories: '0',
        totalProteinG: '0',
        totalCarbsG: '0',
        totalFatG: '0',
        updatedAt: new Date(),
      },
    });
}
