// Input schemas for `exercises.*` (list, search, create, update, archive).
// `search` is filled by `phase-06-onboarding/coach-onboarding/03`, which
// needs a way to pick an exercise before P07's real library UI exists; the
// rest by phase-07-exercise-and-program-authoring.
import { z } from 'zod';

import { strictObject } from './primitives.ts';

/** Long enough for any exercise name in the seeded library, short enough not to be a payload. */
const MAX_QUERY = 100;

/**
 * `exercises.search` (`coach-onboarding/03`) — name and alias matching
 * against the global library plus the caller's own custom exercises.
 *
 * An empty query is valid and deliberate: it is how the picker opens, with
 * the first page of the library already on screen rather than an empty box
 * asking the coach to guess what is in it.
 */
export const searchExercisesInput = strictObject({
  query: z.string().trim().max(MAX_QUERY),
});
export type SearchExercisesInput = z.infer<typeof searchExercisesInput>;
