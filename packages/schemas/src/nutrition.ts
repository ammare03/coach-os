// Input schemas for `nutrition.*` (searchFood, scanBarcode, logMeal,
// updateMeal, diary, summary, plans.*). Filled by phase-13-nutrition. Empty
// for now so the module layout is visible from error-and-validation/01
// onward.
import { z } from 'zod';

import { strictObject } from './primitives.ts';

/**
 * `nutrition.myFoods` lands ahead of P13 because
 * `phase-08-offline-core/prefetch/02` has nothing to fill
 * `local_foods_cache` with without it, and P08 precedes P13 in build order.
 *
 * Not `paginationInput`: this is a bounded cache fill, not a scrollable
 * list — there is no cursor and no second page, because the device only
 * ever wants the top N. The ceiling is DB§13's "~200 foods" for that
 * table; the default is the 100 `CLAUDE.md` §11.2 asks for.
 */
export const MAX_MY_FOODS_LIMIT = 200;

export const myFoodsInput = strictObject({
  limit: z.number().int().min(1).max(MAX_MY_FOODS_LIMIT).default(100),
});
export type MyFoodsInput = z.infer<typeof myFoodsInput>;
