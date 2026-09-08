import { nutrition as nutritionSchemas } from '@coachos/schemas';

import { listMyFoods } from '../features/nutrition/my-foods.ts';
import { router } from '../trpc/init.ts';
import { clientProcedure } from '../trpc/procedures.ts';

// Filled by phase-13-nutrition. Registered empty now so the tree's shape
// is visible from api-scaffold onward.
//
// `searchFood` needs CLAUDE.md §6.5's 120/min/user tier:
// `.use(rateLimit(RATE_LIMIT_TIERS.nutritionSearchFood))` (both from
// `../trpc/procedures.ts`), chained after `.input()`
// (`rate-limiting/03-per-route-config-and-429-handling.md`). Every other
// procedure in this router gets the 600/min default automatically by
// deriving from `publicProcedure`/`protectedProcedure` — nothing extra
// needed there.
export const nutritionRouter = router({
  // `phase-08-offline-core/prefetch/02` — the client's own most-logged
  // foods, for `local_foods_cache`. No `ownsResource`: `limit` is the only
  // caller-supplied input and the client is read from `ctx.user`, never
  // from the wire (same shape as `workouts.upcoming`).
  myFoods: clientProcedure.input(nutritionSchemas.myFoodsInput).query(({ ctx, input }) => {
    if (ctx.user.clientProfileId === null) {
      throw new Error('nutrition.myFoods: authenticated client has no clientProfileId');
    }
    return listMyFoods(ctx.db, ctx.user.clientProfileId, { limit: input.limit });
  }),
});
