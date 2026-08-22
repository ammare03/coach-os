// DB§21: "meals on ~80% of days with believable macro variance." Runs over
// the same 28-day window `training-history.ts` uses, for the same clients,
// so a coach reviewing a client's week sees consistent training AND
// nutrition history for the same days. Every meal's items are paired, in
// the same transaction, with `recomputeDailySummary` — the exact discipline
// `src/aggregates/README.md` documents and the literal DB§8.2 claim this
// seed is the first realistic proof of ("impossible to write a meal and
// not update the summary").
import { recomputeDailySummary } from '../aggregates/recompute-daily-summary.ts';
import type { Transaction } from '../aggregates/types.ts';
import type { mealType as mealTypeEnum } from '../schema/enums.ts';
import { mealItems, meals } from '../schema/nutrition.ts';

import type { SeededFood } from './foods.ts';
import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

type MealType = (typeof mealTypeEnum.enumValues)[number];

const MEAL_SLOTS: Array<{ type: MealType; hour: number }> = [
  { type: 'breakfast', hour: 8 },
  { type: 'lunch', hour: 13 },
  { type: 'dinner', hour: 20 },
  { type: 'snack', hour: 16 },
];

const LOGGING_RATE = 0.8;
const HISTORY_DAY_OFFSETS = Array.from({ length: 28 }, (_, i) => -28 + i); // -28..-1, matching training-history.ts's window

export type NutritionHistoryResult = {
  mealsCreated: number;
  mealItemsCreated: number;
};

/** Must run after `foods.ts` and `clients.ts`; may run any time relative to `training-history.ts`. */
export async function seedNutritionHistory(
  tx: Transaction,
  coachProfileId: string,
  clientKeys: string[],
  clientIdByKey: Map<string, string>,
  seededFoods: SeededFood[],
): Promise<NutritionHistoryResult> {
  let mealsCreated = 0;
  let mealItemsCreated = 0;

  for (const clientKey of clientKeys) {
    const clientId = clientIdByKey.get(clientKey);
    if (!clientId) throw new Error(`seedNutritionHistory: no client id for ${clientKey}`);

    for (const dayOffset of HISTORY_DAY_OFFSETS) {
      const loggedThisDay =
        faker.number.float({ min: 0, max: 1, fractionDigits: 2 }) < LOGGING_RATE;
      if (!loggedThisDay) continue;

      const loggedDate = dateStringFromAnchor(dayOffset);
      const mealCount = faker.number.int({ min: 2, max: 4 });
      const slotsToday = MEAL_SLOTS.slice(0, mealCount);

      for (const [mealIndex, slot] of slotsToday.entries()) {
        const mealKey = `meal:${clientKey}:${dayOffset}:${mealIndex}`;
        const mealId = seedId(mealKey);

        const loggedAt = timestampFromAnchor(
          dayOffset,
          slot.hour,
          faker.number.int({ min: 0, max: 45 }),
        );

        await tx.insert(meals).values({
          id: mealId,
          clientId,
          coachId: coachProfileId,
          loggedDate,
          mealType: slot.type,
          loggedAt,
          clientLocalId: mealKey,
          // Explicit — see coach.ts's comment on the same pair.
          createdAt: loggedAt,
          updatedAt: loggedAt,
        });

        const itemCount = faker.number.int({ min: 1, max: 3 });
        const itemRows: (typeof mealItems.$inferInsert)[] = [];

        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          const food = faker.helpers.arrayElement(seededFoods);
          const quantityG = faker.number.int({ min: 50, max: 350 });
          const factor = quantityG / 100;

          itemRows.push({
            id: seedId(`${mealKey}:item:${itemIndex}`),
            mealId,
            foodId: food.foodId,
            quantityG: quantityG.toFixed(2),
            calories: (food.caloriesPer100g * factor).toFixed(2),
            proteinG: (food.proteinG * factor).toFixed(2),
            carbsG: (food.carbsG * factor).toFixed(2),
            fatG: (food.fatG * factor).toFixed(2),
            createdAt: loggedAt,
            updatedAt: loggedAt,
          });
        }

        await tx.insert(mealItems).values(itemRows);
        mealsCreated += 1;
        mealItemsCreated += itemRows.length;

        // Paired in the same transaction as the meal_items insert above —
        // the pattern derived-data/03 established. Placeholder zeros until
        // phase-13-nutrition/nutrition-summary/01 replaces the stub; the
        // call site is what matters here, not today's output value.
        await recomputeDailySummary(tx, clientId, loggedDate);
      }
    }
  }

  return { mealsCreated, mealItemsCreated };
}
