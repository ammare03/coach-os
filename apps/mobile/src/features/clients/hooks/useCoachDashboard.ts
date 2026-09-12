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
 * §8.2's three counters and the client list.
 *
 * ⚠️ **Deliberately plain `useQuery` with default options.**
 * `coach-dashboard/03` owns cache-first loading and background
 * revalidation, and tunes `staleTime` / `gcTime` **here, in this call** —
 * not in the screen. Until it lands, the screen renders a skeleton on a
 * cold open and TanStack Query's defaults everywhere else, which is correct
 * but not yet fast (§19's <200ms warm-cache budget is 03's acceptance
 * criterion, not this task's).
 *
 * `dashboard_viewed` is deliberately NOT emitted yet, and that is the same
 * seam. Two of its four declared properties — `from_cache` and `load_ms`
 * (`lib/analytics/events.ts`, AN§3.5) — are only answerable once 03 owns
 * cache-first loading, and an event that reports `from_cache: false` on a
 * warm open is worse than a missing one: it feeds the coach-D7-retention
 * number, so a wrong value is wrong in the metric that gates the business.
 * Emit it here, in this hook, when 03 lands.
 */
export function useCoachDashboard() {
  return api.coach.dashboard.useQuery();
}

/** The whole payload, inferred — never restated (`code-conventions` §3). */
export type CoachDashboard = NonNullable<ReturnType<typeof useCoachDashboard>['data']>;

/** One client's render-complete row. `coach-dashboard/02` sorts and filters these. */
export type CoachDashboardClient = CoachDashboard['clients'][number];
