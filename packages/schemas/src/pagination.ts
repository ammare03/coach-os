import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './limits.ts';
import { paginationCursor } from './primitives.ts';
import { strictObject } from './strict.ts';

/**
 * The one input shape every list procedure in P03–P25 takes
 * (`error-and-validation/03-validation-conventions.md` step 7). No
 * `offset`, no `page`, no `total`: offset pagination degrades exactly where
 * a table like `workout_sessions` is largest, and a `total` needs a second
 * count query on every page for a number the UI never renders. A `limit`
 * above `MAX_PAGE_SIZE` is rejected outright — clamping it would hide a
 * client bug instead of surfacing one.
 */
export const paginationInput = strictObject({
  cursor: paginationCursor.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationInput = z.infer<typeof paginationInput>;

/**
 * The page envelope every list procedure returns, fixed here rather than
 * per procedure: the mobile client's infinite-query hook (`api-scaffold/03`)
 * reads `nextCursor` by name, and renaming it later breaks every list in
 * the app at once. Deliberately not `strictObject` — this describes data
 * the *server* assembles for the wire, not a caller's input, so it's exempt
 * from `03`'s strictness rule the same way the two other named relaxations
 * are (`./strict.ts`).
 */
export function pageOf<Item extends z.ZodType>(itemSchema: Item) {
  return z.object({
    items: z.array(itemSchema).max(MAX_PAGE_SIZE),
    nextCursor: paginationCursor.nullable(),
  });
}
