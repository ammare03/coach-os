import { schema, type DbClient, type Food } from '@coachos/db';
import { parseNumeric } from '@coachos/utils';
import { and, asc, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';

// `nutrition.myFoods` — the one read `phase-08-offline-core/prefetch/02`
// consumes to fill `local_foods_cache`. Built here, ahead of
// `phase-13-nutrition`, for the same reason `../workouts/upcoming.ts` was
// built ahead of P09: P08 precedes P13 in build order and prefetch has
// nothing to prefetch without it. P13's food search extends this rather
// than adding a second procedure over the same rows.
//
// Three decisions worth knowing before changing anything here:
//
// (a) The ranking is the CLIENT'S OWN, counted from their `meal_items`
//     history — not `foods.usage_count`, which is global popularity.
//     Task 02's Risks section names that substitution explicitly: a
//     globally-popular list satisfies the letter of "100 most-used foods"
//     and misses its entire point, which is that the things *this* client
//     eats are the things they must be able to log with no signal.
//
// (b) Global popularity is the TOP-UP, never the ranking. A client with
//     fewer than `limit` distinct logged foods — every client on day one —
//     would otherwise get a cache with nothing in it and no offline meal
//     logging at all. Personal rows always come first and are never
//     displaced; `ranking` on each row says which half it came from, so
//     the distinction survives to the device and to the tests.
//
// (c) It answers for ONE client — the caller — and takes no `clientId`.
//     The router builds it on `clientProcedure` and passes
//     `ctx.user.clientProfileId`, so `ownsResource` has nothing to guard
//     (`api-conventions` §3, the same shape as `workouts.upcoming`).

export interface MyFood extends Pick<Food, 'id' | 'name' | 'brand' | 'barcode' | 'servingLabel'> {
  /** `numeric` columns parsed once, here (`code-conventions` §3). */
  servingSizeG: number | null;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Which half of the result this row came from — decision (b). */
  ranking: 'personal' | 'global';
  /** How many times THIS client has logged it. Zero for a global top-up row. */
  logCount: number;
  /** When this client last logged it. Null for a global top-up row. */
  lastLoggedAt: Date | null;
}

export interface ListMyFoodsOptions {
  limit: number;
}

const foodColumns = {
  id: schema.foods.id,
  name: schema.foods.name,
  brand: schema.foods.brand,
  barcode: schema.foods.barcode,
  servingSizeG: schema.foods.servingSizeG,
  servingLabel: schema.foods.servingLabel,
  caloriesPer100g: schema.foods.caloriesPer100g,
  proteinG: schema.foods.proteinG,
  carbsG: schema.foods.carbsG,
  fatG: schema.foods.fatG,
} as const;

type FoodRow = Pick<
  Food,
  | 'id'
  | 'name'
  | 'brand'
  | 'barcode'
  | 'servingSizeG'
  | 'servingLabel'
  | 'caloriesPer100g'
  | 'proteinG'
  | 'carbsG'
  | 'fatG'
>;

function toMyFood(
  row: FoodRow,
  ranking: MyFood['ranking'],
  logCount: number,
  lastLoggedAt: Date | null,
): MyFood {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    servingSizeG: row.servingSizeG === null ? null : parseNumeric(row.servingSizeG, 2),
    servingLabel: row.servingLabel,
    caloriesPer100g: parseNumeric(row.caloriesPer100g, 2),
    proteinG: parseNumeric(row.proteinG, 2),
    carbsG: parseNumeric(row.carbsG, 2),
    fatG: parseNumeric(row.fatG, 2),
    ranking,
    logCount,
    lastLoggedAt,
  };
}

/**
 * The client's most-logged foods, most-logged first, topped up with
 * globally popular ones only if their own history does not fill `limit`.
 *
 * Ties break on the most recent use and then on id, so two clients with
 * identical histories get identical, stable orderings — a prefetch that
 * reshuffled on every run would churn `local_foods_cache` for nothing.
 */
export async function listMyFoods(
  db: DbClient,
  clientProfileId: string,
  options: ListMyFoodsOptions,
): Promise<MyFood[]> {
  const { limit } = options;

  const logCount = sql<number>`count(*)::int`;
  const lastLoggedAt = sql<Date>`max(${schema.meals.loggedAt})`;

  const personalRows = await db
    .select({ ...foodColumns, logCount, lastLoggedAt })
    .from(schema.mealItems)
    .innerJoin(schema.meals, eq(schema.meals.id, schema.mealItems.mealId))
    .innerJoin(schema.foods, eq(schema.foods.id, schema.mealItems.foodId))
    .where(and(eq(schema.meals.clientId, clientProfileId), isNull(schema.meals.deletedAt)))
    // `foods.id` is the primary key, so every other selected `foods`
    // column is functionally dependent on it — Postgres needs no wider
    // GROUP BY, and a wider one would be a lie about what identifies a row.
    .groupBy(schema.foods.id)
    .orderBy(desc(logCount), desc(lastLoggedAt), asc(schema.foods.id))
    .limit(limit);

  const personal = personalRows.map((row) =>
    toMyFood(row, 'personal', row.logCount, row.lastLoggedAt),
  );
  if (personal.length >= limit) return personal;

  const alreadyCached = personal.map((food) => food.id);
  const globalRows = await db
    .select(foodColumns)
    .from(schema.foods)
    .where(alreadyCached.length === 0 ? undefined : notInArray(schema.foods.id, alreadyCached))
    .orderBy(desc(schema.foods.usageCount), asc(schema.foods.id))
    .limit(limit - personal.length);

  return [...personal, ...globalRows.map((row) => toMyFood(row, 'global', 0, null))];
}
