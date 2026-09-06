// Input schemas for `exercises.*` (list, get, search, create, update,
// archive). `search` was filled by `phase-06-onboarding/coach-onboarding/03`,
// which needed a way to pick an exercise before P07's real library UI
// existed; `list`/`get` by `phase-07-.../exercise-library/01`.
import { z } from 'zod';

import { id, strictObject } from './primitives.ts';

/** Long enough for any exercise name in the seeded library, short enough not to be a payload. */
const MAX_QUERY = 100;

/** A `primary_muscle` or `equipment` value — free text at the DB (DB§4), capped here. */
const MAX_FILTER_VALUE = 64;

/**
 * The opaque keyset cursor `exercises.list` hands back. Bounded generously:
 * it encodes an exercise name plus a uuid, and a name is itself capped at
 * `MAX_SHORT_TEXT` elsewhere.
 */
const MAX_CURSOR = 512;

// `./limits.ts` owns `MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE` for every list
// procedure that takes the package-root `paginationInput`. This module
// cannot import it — `__tests__/layout.test.ts` restricts a router schema
// module to `zod` and `./primitives.ts` — and `exercises.list` cannot take
// `paginationInput` anyway, because its cursor is a `(lower(name), id)`
// keyset rather than `primitives.paginationCursor`'s timestamp. Same
// numbers, restated; keep them in step by hand.
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

/** DB§4's `movement_pattern` enum, restated — this package may not import `@coachos/db`. */
export const movementPatternValue = z.enum([
  'squat',
  'hinge',
  'push',
  'pull',
  'carry',
  'core',
  'isolation',
  'other',
]);
export type MovementPatternValue = z.infer<typeof movementPatternValue>;

/**
 * Opaque to the client by construction: base64url, no structure a caller
 * can usefully assemble. A cursor the client builds is a cursor the server
 * has to trust.
 */
const exerciseCursor = z
  .string()
  .max(MAX_CURSOR)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor is not a value this API issued');

/**
 * `exercises.list` — the alphabetical library, filtered and keyset-paginated.
 * Archived exercises are excluded here and returned by `get`; that asymmetry
 * is deliberate (`exercise-library/01`, Approach step 2).
 */
export const listExercisesInput = strictObject({
  primaryMuscle: z.string().trim().min(1).max(MAX_FILTER_VALUE).optional(),
  equipment: z.string().trim().min(1).max(MAX_FILTER_VALUE).optional(),
  movementPattern: movementPatternValue.optional(),
  cursor: exerciseCursor.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListExercisesInput = z.infer<typeof listExercisesInput>;

/**
 * `exercises.get` — one exercise by id, archived or not. `exerciseId` is
 * registered in `NON_RESOURCE_ID_FIELDS` (it names a library row, not a
 * client-scoped resource), so the authz enumeration test expects no
 * `ownsResource` guard on it; visibility is enforced in the query instead.
 */
export const getExerciseInput = strictObject({ exerciseId: id });
export type GetExerciseInput = z.infer<typeof getExerciseInput>;

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
