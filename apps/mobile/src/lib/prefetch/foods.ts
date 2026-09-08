import type { MyFood } from 'api/src/features/nutrition/my-foods.ts';
import { eq, inArray } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localFoodsCache } from '../../db/schema/local-nutrition.ts';

import { prefetchQuery } from './trpc-client.ts';

// `prefetch/02` — the client's 100 most-used foods in `local_foods_cache`,
// so a meal can be logged with no signal (`offline-sync` §1, `CLAUDE.md`
// §11.2).
//
// Three things worth knowing before changing anything here:
//
// (a) The ranking is the SERVER'S, and it is personal. `nutrition.myFoods`
//     counts this client's own `meal_items` and only tops up from global
//     popularity when their history is too short to fill the list
//     (`api/src/features/nutrition/my-foods.ts` (a)/(b)). This module
//     never re-sorts: reordering here would put a second, disagreeing
//     ranking in the product.
//
// (b) `last_used_at` only ever moves FORWARD. It is device-authored usage
//     ranking — the same column, and the same rule, as
//     `local_exercises_cache.last_used_at`, except that this table has no
//     other writer yet, so a fresh insert seeds it from the server's
//     `lastLoggedAt` rather than leaving a new cache unordered. A meal
//     logged offline since the last run is a use the server has not seen,
//     and a refresh that overwrote it would silently demote the food the
//     client just ate.
//
// (c) Nothing is evicted. A food that drops out of the top 100 keeps its
//     row: deleting it risks orphaning an unsynced `local_meals` row that
//     references it, and DB§13's "~200 foods" leaves the headroom to not
//     need to. Eviction, if it is ever wanted, belongs with P13's food
//     search, which is the only thing that reads this table.

/** The 100 `CLAUDE.md` §11.2 names. */
export const DEFAULT_FOOD_CACHE_SIZE = 100;

export type MyFoodsFetcher = (input: { limit: number }) => Promise<MyFood[]>;

const fetchViaTrpc: MyFoodsFetcher = async (input) =>
  (await prefetchQuery('nutrition.myFoods', input)) as MyFood[];

export interface WriteFoodsResult {
  inserted: number;
  updated: number;
}

function cacheRow(food: MyFood): typeof localFoodsCache.$inferInsert {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    caloriesPer100g: food.caloriesPer100g,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    lastUsedAt: food.lastLoggedAt === null ? null : food.lastLoggedAt.getTime(),
  };
}

/**
 * Writes the given foods into `local_foods_cache`.
 *
 * Read-through, not upsert-through, for the same reason
 * `./exercises.ts`'s `writeExerciseCache` is: `ON CONFLICT DO UPDATE`
 * would be shorter, but this table carries `last_used_at`, and rule (b)
 * needs the existing value to decide what to write.
 */
export async function writeFoodsCache(db: LocalDb, foods: MyFood[]): Promise<WriteFoodsResult> {
  if (foods.length === 0) return { inserted: 0, updated: 0 };

  const existing = await db
    .select({ id: localFoodsCache.id, lastUsedAt: localFoodsCache.lastUsedAt })
    .from(localFoodsCache)
    .where(
      inArray(
        localFoodsCache.id,
        foods.map((food) => food.id),
      ),
    );
  const cachedLastUsedAt = new Map(existing.map((row) => [row.id, row.lastUsedAt]));

  let inserted = 0;
  let updated = 0;
  for (const food of foods) {
    const row = cacheRow(food);
    if (!cachedLastUsedAt.has(food.id)) {
      await db.insert(localFoodsCache).values(row);
      inserted += 1;
      continue;
    }
    const cached = cachedLastUsedAt.get(food.id) ?? null;
    const { id, ...columns } = row;
    await db
      .update(localFoodsCache)
      .set({ ...columns, lastUsedAt: laterOf(cached, row.lastUsedAt ?? null) })
      .where(eq(localFoodsCache.id, id));
    updated += 1;
  }
  return { inserted, updated };
}

/** Rule (b) in one place: the cache's own timestamp never moves backwards. */
function laterOf(cached: number | null, fromServer: number | null): number | null {
  if (cached === null) return fromServer;
  if (fromServer === null) return cached;
  return Math.max(cached, fromServer);
}

export interface PrefetchFoodsOptions {
  limit?: number;
  fetchMyFoods?: MyFoodsFetcher;
  db?: LocalDb;
}

export interface PrefetchFoodsResult extends WriteFoodsResult {
  fetched: MyFood[];
}

/**
 * Fetches the client's most-used foods and caches them.
 *
 * Async end to end and never called for its return value on a render path
 * — the caller keeps the thread while the request is in flight, and each
 * local write is awaited individually rather than in one long synchronous
 * block (`CLAUDE.md` §19).
 */
export async function prefetchFoods(
  options: PrefetchFoodsOptions = {},
): Promise<PrefetchFoodsResult> {
  const limit = options.limit ?? DEFAULT_FOOD_CACHE_SIZE;
  const fetched = await (options.fetchMyFoods ?? fetchViaTrpc)({ limit });
  const db = options.db ?? (await getLocalDb());
  const written = await writeFoodsCache(db, fetched);
  return { ...written, fetched };
}
