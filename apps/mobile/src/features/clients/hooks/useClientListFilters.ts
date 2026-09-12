import { useCallback, useMemo, useState } from 'react';

import { useDebounced } from '../../../hooks/useDebounced.ts';
import type { DashboardCounterKey } from '../components/DashboardCounters.tsx';
import {
  DEFAULT_CLIENT_SORT,
  useClientListPreferences,
  type ClientGoalFilter,
  type ClientSort,
  type ClientStatusFilter,
} from '../store/client-list-preferences.ts';

import type { CoachDashboardClient } from './useCoachDashboard.ts';

// §8.2's "sortable by attention-needed (default), name, or last active…
// Search. Filter by tag/status", all of it computed on the array
// `coach.dashboard` already returned.
//
// **Nothing here touches the network, and that is the acceptance criterion,
// not an optimisation.** A coach's roster is bounded by their tier's seat
// limit — a few hundred rows at Agency scale — so one pass and one sort of
// an in-memory array is cheaper than the round trip a server-side filter
// would spend on every keystroke, and §19 budgets a keystroke at <400ms
// everywhere else in the product.
//
// "Tag" resolves to `status` + `goal`, the two facets a client row already
// carries (`DATABASE.md` DB§5.1 has no `tags` column). Adding one is a
// schema change that belongs to `phase-01-data-layer`, and it is logged as
// a `CLAUDE.md` §27 open decision rather than invented here.

export {
  CLIENT_SORTS,
  DEFAULT_CLIENT_SORT,
  FILTERABLE_GOALS,
  FILTERABLE_STATUSES,
  type ClientGoalFilter,
  type ClientSort,
  type ClientStatusFilter,
} from '../store/client-list-preferences.ts';

/**
 * Long enough that the list does not re-order under the thumb on every
 * keystroke, short enough that nobody waits on it. The filtering itself is
 * instant — this delays only the DERIVED array, never the text in the
 * field, which stays fully controlled and echoes each character
 * immediately.
 */
export const SEARCH_DEBOUNCE_MS = 150;

/** Everything `selectClients` needs, and nothing about how it was chosen. */
export interface ClientListSelection {
  sort: ClientSort;
  query: string;
  statuses: readonly ClientStatusFilter[];
  goals: readonly ClientGoalFilter[];
  counter: DashboardCounterKey | null;
}

/** True when this client is one of the ones that counter counted. */
type CounterPredicate = (client: CoachDashboardClient) => boolean;

/**
 * Each dashboard counter against the per-client predicate that reproduces
 * it from an already-fetched row.
 *
 * `checkinsDue` is `null`, and it is the one honest answer available: the
 * counter is a `count(*)` over `coaching.checkins`, and `v_client_overview`
 * carries no per-client pending-check-in column, so no predicate over the
 * fetched payload can name the clients behind that number. Inventing one
 * from adjacent fields would be a filter that quietly disagrees with the
 * number above it. Making it work needs a column on the view and a field on
 * `ClientOverviewRow` — an API change, not a screen change.
 */
export const COUNTER_FILTERS: Record<DashboardCounterKey, CounterPredicate | null> = {
  needsReview: (client) => client.unreviewedSessions + client.unreviewedVideos > 0,
  offPlan: (client) => client.adherenceColor === 'red',
  checkinsDue: null,
};

export function isCounterFilterable(counter: DashboardCounterKey): boolean {
  return COUNTER_FILTERS[counter] !== null;
}

/**
 * **The attention-needed ranking, written down as the definition.**
 *
 * §8.2 names the sort but not its tie-breaking, so this is the order, and
 * it is the order a coach can be told:
 *
 * 1. **Waiting on you** — any unreviewed session or video, first.
 * 2. Then **lowest overall adherence**.
 * 3. Then **longest since last activity**.
 * 4. Then name A–Z, then client id.
 *
 * Step 1 ranks on the boolean, never the count: one unreviewed video and
 * eight are both "waiting on you", and ordering by volume would park a
 * prolific client permanently above a quiet one who has been waiting longer.
 *
 * Steps 2 and 3 both send *absence* to the back of their group — a client
 * with no adherence score or no activity yet is grey, not red, and must
 * never outrank someone measurably off plan (`DESIGN.md` §10.5).
 *
 * Step 4 is what makes the comparator TOTAL, which is the property the task
 * actually asks for: two renders of the same roster produce the same
 * sequence whatever order the server sent the rows in, so the list does not
 * shuffle between refreshes.
 */
function compareAttention(a: CoachDashboardClient, b: CoachDashboardClient): number {
  const waiting = compareRanks(rankWaiting(a), rankWaiting(b));
  if (waiting !== 0) return waiting;

  const adherence = compareRanks(
    rankNumberAscending(a.overallAdherence),
    rankNumberAscending(b.overallAdherence),
  );
  if (adherence !== 0) return adherence;

  const activity = compareRanks(rankOldestFirst(a.lastActiveAt), rankOldestFirst(b.lastActiveAt));
  if (activity !== 0) return activity;

  return compareIdentity(a, b);
}

/**
 * Never `a - b`. Two clients with no data both rank `Infinity`, and
 * `Infinity - Infinity` is `NaN` — a comparator returning `NaN` leaves the
 * sort undefined, which is precisely the between-refreshes shuffle the
 * ranking above exists to prevent.
 */
function compareRanks(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function rankWaiting(client: CoachDashboardClient): number {
  return client.unreviewedSessions + client.unreviewedVideos > 0 ? 0 : 1;
}

/** `null` sorts last: no data is not a low score. */
function rankNumberAscending(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

/** Oldest first; never-active sorts last, for the same reason. */
function rankOldestFirst(value: Date | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value.getTime();
}

function compareIdentity(a: CoachDashboardClient, b: CoachDashboardClient): number {
  const byName = compareNames(a.name, b.name);
  return byName !== 0 ? byName : a.clientId.localeCompare(b.clientId);
}

/**
 * `sensitivity: 'base'` so "adrian" and "Adrian" sort together rather than
 * in two blocks by case — a roster is full of names typed by the clients
 * themselves.
 */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function compareName(a: CoachDashboardClient, b: CoachDashboardClient): number {
  const byName = compareNames(a.name, b.name);
  return byName !== 0 ? byName : a.clientId.localeCompare(b.clientId);
}

/** Most recent first; never-active last, then name, then id. */
function compareLastActive(a: CoachDashboardClient, b: CoachDashboardClient): number {
  const recency = compareRanks(rankNewestFirst(b.lastActiveAt), rankNewestFirst(a.lastActiveAt));
  if (recency !== 0) return recency;
  return compareIdentity(a, b);
}

function rankNewestFirst(value: Date | null): number {
  return value === null ? Number.NEGATIVE_INFINITY : value.getTime();
}

const COMPARATORS: Record<
  ClientSort,
  (a: CoachDashboardClient, b: CoachDashboardClient) => number
> = {
  attention: compareAttention,
  name: compareName,
  'last-active': compareLastActive,
};

/**
 * The filtered, sorted list. Pure, and the whole of this task's logic —
 * exported on its own so it can be tested without a renderer.
 *
 * The two facets combine as **AND**, never OR: chips within one facet are
 * alternatives (`Active` or `Invited`), chips across the two are
 * requirements (`Active` *and* `Fat loss`). A client whose goal is unset
 * matches no goal chip, which is what "filter by goal" has to mean.
 */
export function selectClients(
  clients: readonly CoachDashboardClient[],
  selection: ClientListSelection,
): CoachDashboardClient[] {
  const needle = selection.query.trim().toLocaleLowerCase();
  const counterPredicate = selection.counter === null ? null : COUNTER_FILTERS[selection.counter];

  const matched = clients.filter((client) => {
    if (needle !== '' && !client.name.toLocaleLowerCase().includes(needle)) return false;
    if (selection.statuses.length > 0 && !includesStatus(selection.statuses, client.status)) {
      return false;
    }
    if (selection.goals.length > 0 && !includesGoal(selection.goals, client.goal)) return false;
    if (counterPredicate !== null && !counterPredicate(client)) return false;
    return true;
  });

  // `filter` already copied; sorting it in place never touches the caller's
  // array, which is the query cache's own and must not be reordered.
  return matched.sort(COMPARATORS[selection.sort]);
}

function includesStatus(
  statuses: readonly ClientStatusFilter[],
  status: CoachDashboardClient['status'],
): boolean {
  return statuses.some((entry) => entry === status);
}

function includesGoal(
  goals: readonly ClientGoalFilter[],
  goal: CoachDashboardClient['goal'],
): boolean {
  return goal !== null && goals.some((entry) => entry === goal);
}

export interface ClientListFilters extends ClientListSelection {
  /** The array the list renders — filtered and sorted. */
  clients: CoachDashboardClient[];
  /** Before any narrowing, so the count line can say "3 of 26". */
  totalCount: number;
  /** What the coach is still typing, echoed immediately; `query` is its debounced twin. */
  draftQuery: string;
  setQuery: (query: string) => void;
  setSort: (sort: ClientSort) => void;
  toggleStatus: (status: ClientStatusFilter) => void;
  toggleGoal: (goal: ClientGoalFilter) => void;
  /** Tapping the selected counter clears it; a counter with no predicate is ignored. */
  selectCounter: (counter: DashboardCounterKey) => void;
  /** Turns every chip off and leaves the query, the counter, and the sort alone. */
  clearFilters: () => void;
  /** Chips only — the counter is a drill-down, not a chip, and the sort is never "a filter". */
  activeFilterCount: number;
  /** True when the list on screen is a subset of the roster, for any reason. */
  isNarrowed: boolean;
  clearAll: () => void;
}

/**
 * Sort/search/filter state for the dashboard's client list, plus the
 * derived array (`coach-dashboard/01`'s `FlashList` renders it directly).
 *
 * Sort and the two facets come from the persisted store; the query and the
 * counter selection are this mount's own (see the store's own note on why).
 */
export function useClientListFilters(clients: readonly CoachDashboardClient[]): ClientListFilters {
  const sort = useClientListPreferences((state) => state.sort);
  const statuses = useClientListPreferences((state) => state.statuses);
  const goals = useClientListPreferences((state) => state.goals);
  const setSort = useClientListPreferences((state) => state.setSort);
  const toggleStatus = useClientListPreferences((state) => state.toggleStatus);
  const toggleGoal = useClientListPreferences((state) => state.toggleGoal);
  const clearFilters = useClientListPreferences((state) => state.clearFilters);

  const [draftQuery, setQuery] = useState('');
  const [counter, setCounter] = useState<DashboardCounterKey | null>(null);
  const query = useDebounced(draftQuery, SEARCH_DEBOUNCE_MS);

  const selectCounter = useCallback((next: DashboardCounterKey) => {
    // A counter with no per-client predicate stays a read-only stat: it
    // cannot enter the selected state, because a card drawn as "selected"
    // over an unchanged list is a worse answer than no selection at all.
    if (!isCounterFilterable(next)) return;
    setCounter((current) => (current === next ? null : next));
  }, []);

  const clearAll = useCallback(() => {
    setQuery('');
    setCounter(null);
    clearFilters();
  }, [clearFilters]);

  const selection = useMemo<ClientListSelection>(
    () => ({ sort, query, statuses, goals, counter }),
    [sort, query, statuses, goals, counter],
  );

  // The one real computation on this screen, and the only thing standing
  // between a hundred rows and a re-sort per keystroke
  // (`frontend-performance` §3).
  const visible = useMemo(() => selectClients(clients, selection), [clients, selection]);

  const activeFilterCount = statuses.length + goals.length;

  return {
    ...selection,
    clients: visible,
    totalCount: clients.length,
    draftQuery,
    setQuery,
    setSort,
    toggleStatus,
    toggleGoal,
    selectCounter,
    clearFilters,
    activeFilterCount,
    isNarrowed: query.trim() !== '' || activeFilterCount > 0 || counter !== null,
    clearAll,
  };
}

/** Re-exported so a consumer never has to reach past the hook for the default. */
export const CLIENT_LIST_DEFAULT_SORT = DEFAULT_CLIENT_SORT;
