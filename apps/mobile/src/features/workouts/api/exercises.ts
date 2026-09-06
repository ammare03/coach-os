import type { exercises as exercisesSchemas } from '@coachos/schemas';

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
