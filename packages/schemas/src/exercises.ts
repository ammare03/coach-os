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

/** An exercise name. `./limits.ts`'s `MAX_SHORT_TEXT`, restated (see the note on page size below). */
const MAX_NAME = 200;

/**
 * One cue is a sentence a coach would say standing next to the client, not
 * a paragraph — the logger renders them one per line at 16pt
 * (`phase-09-workout-logger/session-runtime/04`).
 */
const MAX_CUE = 160;

/** Past this, cues stop being cues. Three or four is the realistic number. */
const MAX_CUES = 8;

/** `default_increment_kg` is `numeric(4,2)` (DB§5.2) — 99.99 is the column's own ceiling. */
const MAX_INCREMENT_KG = 99.99;

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
 * The caller's side of the same schema — `limit` carries a `.default()`, so
 * it is required on the parsed output and optional on the input. A client
 * passing filters wants this one; the resolver, which reads the parsed
 * value, wants the one above.
 */
export type ListExercisesFilters = z.input<typeof listExercisesInput>;

/**
 * `exercises.get` — one exercise by id, archived or not. `exerciseId` is
 * registered in `NON_RESOURCE_ID_FIELDS` (it names a library row, not a
 * client-scoped resource), so the authz enumeration test expects no
 * `ownsResource` guard on it; visibility is enforced in the query instead.
 */
export const getExerciseInput = strictObject({ exerciseId: id });
export type GetExerciseInput = z.infer<typeof getExerciseInput>;

/**
 * The fields a coach authors. Spread into both `createExerciseInput` and
 * `updateExerciseInput` so the form's `react-hook-form` resolver and the
 * tRPC procedure validate against literally the same rules (CLAUDE.md
 * §6.4). A name-length rule that exists in only one of the two is the bug
 * that requirement exists to prevent.
 *
 * There is deliberately **no `coachId` field**. `exercises.create` takes it
 * from the session; an input field for it would be a privilege-escalation
 * surface (`exercise-library/03`, acceptance criterion 2).
 */
const exerciseAuthoringFields = {
  name: z.string().trim().min(1).max(MAX_NAME),
  primaryMuscle: z.string().trim().min(1).max(MAX_FILTER_VALUE),
  equipment: z.string().trim().min(1).max(MAX_FILTER_VALUE),
  movementPattern: movementPatternValue,
  cues: z.array(z.string().trim().min(1).max(MAX_CUE)).max(MAX_CUES),
  // `Kg` in the name, not `defaultIncrement` — CLAUDE.md §17.2, and this
  // form is where the identifier enters the codebase. Zero is legal and
  // means "no plate math", which is what a bodyweight movement wants.
  defaultIncrementKg: z.number().min(0).max(MAX_INCREMENT_KG),
  isUnilateral: z.boolean(),
  isBodyweight: z.boolean(),
};

/** `exercises.create` — always a custom exercise, always owned by the caller. */
export const createExerciseInput = strictObject(exerciseAuthoringFields);
export type CreateExerciseInput = z.infer<typeof createExerciseInput>;

/** `exercises.update` — the same fields, plus which of the caller's own exercises to write them to. */
export const updateExerciseInput = strictObject({
  exerciseId: id,
  ...exerciseAuthoringFields,
});
export type UpdateExerciseInput = z.infer<typeof updateExerciseInput>;

/** `exercises.archive` / `exercises.unarchive`. There is no delete, and there will not be one. */
export const archiveExerciseInput = strictObject({ exerciseId: id });
export type ArchiveExerciseInput = z.infer<typeof archiveExerciseInput>;

/**
 * `exercises.checkName` — the advisory lookup the create form runs while
 * the coach types.
 *
 * Two of `exercise-library/03`'s three collision cases are NOT errors: a
 * name matching a global exercise, or one matching the coach's own
 * *archived* exercise, are both allowed by DB§5.2's partial unique index.
 * They still need to be surfaced, because silently allowing either is how a
 * library ends up with four spellings of one movement. `search` cannot
 * answer this — it excludes archived rows by design — so this is its own
 * procedure rather than a clever reuse of that one.
 */
export const checkExerciseNameInput = strictObject({
  name: z.string().trim().min(1).max(MAX_NAME),
});
export type CheckExerciseNameInput = z.infer<typeof checkExerciseNameInput>;

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
  // The same three filters `list` takes, deliberately not redefined:
  // `exercise-library/01` owns what a filter means, and `search` narrows
  // by them rather than inventing its own vocabulary.
  primaryMuscle: z.string().trim().min(1).max(MAX_FILTER_VALUE).optional(),
  equipment: z.string().trim().min(1).max(MAX_FILTER_VALUE).optional(),
  movementPattern: movementPatternValue.optional(),
  // No cursor: search is a ranked head, not a paginated list. A coach who
  // scrolls past 30 ranked results should refine the query, and the picker
  // (`exercise-library/05`) is built on that assumption.
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type SearchExercisesInput = z.infer<typeof searchExercisesInput>;
