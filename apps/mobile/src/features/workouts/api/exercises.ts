import type { exercises as exercisesSchemas } from '@coachos/schemas';
import { keepPreviousData } from '@tanstack/react-query';

import { api } from '../../../lib/trpc.ts';

// The feature's whole tRPC call surface for `exercises.*`
// (`code-conventions` §1 — a feature talks to the API through one module,
// so a query key or an invalidation rule has exactly one place to live).
// No component calls `api.exercises.*` directly.

/** One page of the alphabetical library. */
export function useExerciseLibrary(filters: exercisesSchemas.ListExercisesFilters) {
  return api.exercises.list.useInfiniteQuery(filters, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/**
 * The search path. `enabled` is the caller's, not ours: the library screen
 * runs `list` until the coach types, then swaps to this, and a query that
 * is not on screen has no business being subscribed.
 */
export function useExerciseSearch(query: string, enabled: boolean) {
  return api.exercises.search.useQuery({ query }, { enabled });
}

export interface ExercisePickerSearchInput {
  query: string;
  movementPattern?: exercisesSchemas.MovementPatternValue | undefined;
}

/**
 * The picker's search (`exercise-library/05`). Separate from
 * `useExerciseSearch` above for two behavioural reasons, not for tidiness:
 * it narrows by movement pattern, and it keeps the previous answer on
 * screen while the next one is in flight. A skeleton on every keystroke
 * reads as the library flickering, and §19 budgets 400ms from keystroke to
 * results for the WHOLE path — the debounce and the render are ours, not
 * just the round trip.
 *
 * An empty query is deliberate and valid: `exercises.search` answers it
 * with the head of the library, which is how the picker opens with
 * something already on screen (`packages/schemas` `searchExercisesInput`).
 */
export function useExercisePickerSearch(input: ExercisePickerSearchInput, enabled: boolean) {
  return api.exercises.search.useQuery(
    {
      query: input.query,
      // `exactOptionalPropertyTypes` — an absent filter is an omitted key,
      // never an explicit `undefined`.
      ...(input.movementPattern ? { movementPattern: input.movementPattern } : {}),
    },
    { enabled, placeholderData: keepPreviousData },
  );
}

/**
 * One row of the picker, inferred from the procedure rather than declared
 * (`code-conventions` §3). Consumers — `program-builder/02` today,
 * `phase-09-workout-logger/session-modifications/02` next — receive this
 * from `onSelect` and should name this type rather than restate its fields.
 */
export type PickerExercise = NonNullable<
  ReturnType<typeof useExercisePickerSearch>['data']
>[number];

export function useExercise(exerciseId: string, enabled = true) {
  return api.exercises.get.useQuery({ exerciseId }, { enabled });
}

/**
 * The advisory collision lookup, run while the coach types a name.
 * Debouncing is the form's job — this hook only decides *whether* to ask.
 */
export function useExerciseNameCheck(name: string, enabled: boolean) {
  return api.exercises.checkName.useQuery({ name }, { enabled: enabled && name.length > 0 });
}
