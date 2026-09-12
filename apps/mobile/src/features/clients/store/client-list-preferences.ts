import { client as clientSchemas } from '@coachos/schemas';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CoachDashboardClient } from '../hooks/useCoachDashboard.ts';

import { clientListPreferenceStorage } from './preferences-storage.ts';

// The coach's last-used sort and filter chips, kept across restarts —
// `code-conventions` §5's "a persisted user preference" row, which is the
// one case that gets Zustand + `persist` rather than `useState`.
//
// What is NOT here, deliberately:
//
// - **The search query.** A roster silently narrowed to whatever was typed
//   yesterday is a dashboard that lies about how many clients a coach has.
// - **The counter selection.** It is a drill-down into a number recomputed
//   on every fetch, not a preference; reopening the app to "off plan only"
//   with no memory of having asked is the same failure.
//
// Both live in the hook's own `useState` and reset on a fresh mount.

export type ClientSort = 'attention' | 'name' | 'last-active';

/** Declaration order is render order — the segmented control reads this array. */
export const CLIENT_SORTS = [
  'attention',
  'name',
  'last-active',
] as const satisfies readonly ClientSort[];

/** §8.2 names attention-needed as the default, and a restored preference overrides it. */
export const DEFAULT_CLIENT_SORT: ClientSort = 'attention';

/**
 * The only two statuses `coach.dashboard` can return: the resolver's roster
 * is `active` + `invited` (§15.5's seat definition), so offering a `paused`
 * or `archived` chip would be offering a filter that always yields nothing.
 */
export const FILTERABLE_STATUSES = ['active', 'invited'] as const satisfies readonly ClientStatus[];

export type ClientStatus = CoachDashboardClient['status'];
export type ClientStatusFilter = (typeof FILTERABLE_STATUSES)[number];

/** The `training_goal` enum itself, never a second copy of its members. */
export const FILTERABLE_GOALS = clientSchemas.TRAINING_GOALS;
export type ClientGoalFilter = clientSchemas.TrainingGoal;

export interface ClientListPreferencesState {
  sort: ClientSort;
  statuses: readonly ClientStatusFilter[];
  goals: readonly ClientGoalFilter[];
  setSort: (sort: ClientSort) => void;
  toggleStatus: (status: ClientStatusFilter) => void;
  toggleGoal: (goal: ClientGoalFilter) => void;
  clearFilters: () => void;
}

const STORAGE_KEY = 'coachos.client-list-preferences';

/** Bump to discard every stored preference when the persisted shape changes. */
const SCHEMA_VERSION = 1;

/**
 * Toggling writes back in the vocabulary's own order rather than in tap
 * order, so the stored array is a function of WHAT is selected and not of
 * how the coach got there — two identical selections compare equal, and a
 * chip row never reorders itself under the thumb.
 */
function toggleIn<T>(current: readonly T[], value: T, vocabulary: readonly T[]): readonly T[] {
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  return vocabulary.filter((entry) => next.includes(entry));
}

function isClientSort(value: unknown): value is ClientSort {
  return CLIENT_SORTS.some((sort) => sort === value);
}

/**
 * A persisted array is whatever the last build wrote, and a member that no
 * longer exists in the enum would filter every client out with no way for
 * the coach to see why. Unknown members are dropped rather than the whole
 * preference (`code-conventions` §3 — `unknown` plus a narrowing guard).
 */
function readMembers<T>(value: unknown, vocabulary: readonly T[]): readonly T[] {
  if (!Array.isArray(value)) return [];
  return vocabulary.filter((entry) => (value as unknown[]).includes(entry));
}

export const useClientListPreferences = create<ClientListPreferencesState>()(
  persist(
    (set) => ({
      sort: DEFAULT_CLIENT_SORT,
      statuses: [],
      goals: [],

      setSort: (sort) => {
        set({ sort });
      },

      toggleStatus: (status) => {
        set((state) => ({
          statuses: toggleIn(state.statuses, status, FILTERABLE_STATUSES),
        }));
      },

      toggleGoal: (goal) => {
        set((state) => ({ goals: toggleIn(state.goals, goal, FILTERABLE_GOALS) }));
      },

      clearFilters: () => {
        set({ statuses: [], goals: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => clientListPreferenceStorage),
      partialize: ({ sort, statuses, goals }) => ({ sort, statuses, goals }),
      // The default merge is shallow and would take the persisted values on
      // trust. Each is validated instead: an unreadable row starts the coach
      // on the documented default rather than on a sort the code no longer
      // implements.
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) return current;
        const stored = persisted as Record<string, unknown>;
        return {
          ...current,
          sort: isClientSort(stored.sort) ? stored.sort : current.sort,
          statuses: readMembers(stored.statuses, FILTERABLE_STATUSES),
          goals: readMembers(stored.goals, FILTERABLE_GOALS),
        };
      },
    },
  ),
);

/** Test seam — the store is module state, which outlives a single case. */
export function resetClientListPreferencesForTests(): void {
  useClientListPreferences.setState({ sort: DEFAULT_CLIENT_SORT, statuses: [], goals: [] });
}
