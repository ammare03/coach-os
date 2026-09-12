import { useCallback, useEffect, useRef, useState } from 'react';

import { trackEvent } from '../../../lib/analytics/index.ts';
import { QUERY_CACHE_MAX_AGE_MS } from '../../../lib/query/persister.ts';
import { api } from '../../../lib/trpc.ts';

// The dashboard's ONE read (`screen-composition` §2 — a list endpoint
// returns render-complete rows, so no row ever fetches anything). Extracted
// from the route so `coach-dashboard/03` can tune caching here without
// touching the screen, and so `coach-dashboard/02` can filter the array this
// returns without owning the fetch.

/**
 * `['coach', 'dashboard']` — hierarchical, per `code-conventions` §5, so a
 * later phase can invalidate `['coach']` wholesale or this key alone.
 * tRPC derives it from the procedure path; it is written down here because
 * anything invalidating it by hand has to match.
 */
export const COACH_DASHBOARD_QUERY_KEY = ['coach', 'dashboard'] as const;

/**
 * How long a painted dashboard is treated as current.
 *
 * One minute, and the number is about navigation rather than about how fast
 * the counters change. A coach's review block is 10–30 minutes of
 * dashboard → client detail → back (`CLAUDE.md` §1.1), and every return
 * inside this window costs nothing; past it, the next return revalidates
 * behind the rows already on screen. The counters themselves move on human
 * timescales — a client logs a session, submits a check-in — so a shorter
 * window buys staleness nobody would notice and spends a round trip per
 * navigation to do it.
 *
 * **Never zero.** At zero every open of the tab refetches, and on a slow
 * connection the screen is a spinner over data it already had — the failure
 * the task's Risks section names, and the one §19's <200ms warm-cache
 * budget is written against.
 *
 * The ceiling is the other direction: anything past a few minutes and a
 * coach who just left feedback comes back to a counter that disagrees with
 * what they did. Work that changes these numbers should invalidate
 * `COACH_DASHBOARD_QUERY_KEY` directly rather than wait this out.
 */
export const COACH_DASHBOARD_STALE_TIME_MS = 60_000;

/**
 * §8.2's three counters and the client list.
 *
 * Cache-first, per `coach-dashboard/03`. Three cases, and the hook has to
 * keep them apart because the screen renders each differently:
 *
 * - **Warm cache** — `phase-08-offline-core`'s `persistQueryClient` restore
 *   runs at module scope and the root layout holds the splash for it
 *   (`src/app/_layout.tsx`), so the entry is in the cache before this hook
 *   first renders. `isPending` is false on that first render and the rows
 *   paint from disk; the revalidation that follows is silent.
 * - **Cold first-ever launch** — nothing on disk, `isPending` is true, and
 *   the screen shows its loading state. The instant-from-cache guarantee
 *   was never about this case.
 * - **Pull to refresh** — `refetch()` below, reported through
 *   `isRefetching` so the platform's `RefreshControl` spins for exactly as
 *   long as the coach's own request is in flight.
 *
 * Returns the six fields the screen consumes and no more: a narrow object
 * is also a narrow subscription, so a change to `isFetching` or
 * `errorUpdateCount` does not re-render a hundred-row list
 * (`frontend-performance` §3).
 */
export function useCoachDashboard() {
  const query = api.coach.dashboard.useQuery(undefined, {
    staleTime: COACH_DASHBOARD_STALE_TIME_MS,
    // Tied to the persistence window by import, not by a matching literal:
    // a `gcTime` below it evicts the entry the persister just restored, and
    // the warm-cache guarantee silently becomes a cold one
    // (`lib/query/persister.ts`).
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });

  const { refetch } = query;
  const [isUserRefreshing, setIsUserRefreshing] = useState(false);

  // TanStack's own `isRefetching` is true for *any* fetch over existing
  // data, including the silent background revalidation above — and the
  // screen wires it straight to `RefreshControl`. Reporting only the
  // coach's own pull keeps a warm open from spinning at something nobody
  // asked for.
  const handleRefetch = useCallback(async () => {
    setIsUserRefreshing(true);
    try {
      return await refetch();
    } finally {
      setIsUserRefreshing(false);
    }
  }, [refetch]);

  useDashboardViewed(query.data, query.dataUpdatedAt);

  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: handleRefetch,
    isRefetching: isUserRefreshing,
  };
}

/**
 * `dashboard_viewed` (AN§3.5) — once per mount, on the first data the coach
 * actually sees. Held back by `coach-dashboard/01` because two of its four
 * properties are only answerable here:
 *
 * - `from_cache` — the painted rows predate this mount, so they came off
 *   disk rather than off the wire. `dataUpdatedAt` is when the payload was
 *   received, so a restored entry carries yesterday's timestamp and a
 *   network response carries one after the mount.
 * - `load_ms` — mount to first painted data, which is the span §19 budgets
 *   (<200ms warm, <800ms p75 on the network). Near zero on a warm open by
 *   construction; that is the measurement, not a bug in it.
 *
 * Fire-and-forget, never awaited, never on the path of a user action
 * (`analytics-events` §7).
 */
function useDashboardViewed(
  data: { clients: unknown[]; needsReview: number } | undefined,
  dataUpdatedAt: number,
): void {
  // Read in the mount effect rather than in `useRef(Date.now())`: a clock
  // read during render is impure, and the commit that follows the first
  // render is the closest honest stand-in for "the screen appeared" anyway.
  // Declared before the effect below, so it is always set by the time that
  // one runs — including on a warm open, where both fire in one commit.
  const mountedAtMsRef = useRef(0);
  const hasEmittedRef = useRef(false);

  useEffect(() => {
    mountedAtMsRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (hasEmittedRef.current || data === undefined) {
      return;
    }
    hasEmittedRef.current = true;

    const now = Date.now();
    const mountedAtMs = mountedAtMsRef.current === 0 ? now : mountedAtMsRef.current;

    trackEvent('dashboard_viewed', {
      client_count: data.clients.length,
      // The Needs-review counter is the same signal `coach-dashboard/02`
      // ranks "attention-needed" by, so the property and the sort agree on
      // what attention means rather than inventing a second definition.
      needs_attention_count: data.needsReview,
      load_ms: Math.max(0, now - mountedAtMs),
      from_cache: dataUpdatedAt <= mountedAtMs,
    });
  }, [data, dataUpdatedAt]);
}

/** The whole payload, inferred — never restated (`code-conventions` §3). */
export type CoachDashboard = NonNullable<ReturnType<typeof useCoachDashboard>['data']>;

/** One client's render-complete row. `coach-dashboard/02` sorts and filters these. */
export type CoachDashboardClient = CoachDashboard['clients'][number];
