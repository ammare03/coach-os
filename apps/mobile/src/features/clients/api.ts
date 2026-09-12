import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { QUERY_CACHE_MAX_AGE_MS } from '../../lib/query/persister.ts';
import { api } from '../../lib/trpc.ts';

// The `clients` feature's whole tRPC call surface (`code-conventions` §1 —
// a feature talks to the API through one module, so a query key or an
// invalidation rule has exactly one place to live). No component calls
// `api.coach.clients.*` directly.
//
// The coach DASHBOARD's read is not here: it predates this file and lives
// in `hooks/useCoachDashboard.ts`, keyed `['coach', 'dashboard']`. This
// module is the client-DETAIL screen's six tabs.

/**
 * §8.3's six tabs, in the order the facet bar draws them.
 *
 * **`notes` is deliberately absent.** The Notes tab is `coach-notes`'s
 * feature — a separate authorisation story (DB§5.4: a note is private to
 * the coach who wrote it) — and it adds its own entry here when it ships.
 * The route file already exists and `_layout.tsx` declares it; it is simply
 * not a facet yet.
 */
export const CLIENT_DETAIL_TABS = [
  'overview',
  'training',
  'nutrition',
  'videos',
  'checkins',
  'chat',
] as const;

export type ClientDetailTab = (typeof CLIENT_DETAIL_TABS)[number];

/**
 * **The query-key factory for every client-detail tab. Tasks 02–06 import
 * from here and never restate a key.**
 *
 * `['clients', clientId, tab]` — hierarchical, per `code-conventions` §5 and
 * `screen-composition` §2, so a caller can invalidate one tab, one client,
 * or the whole feature and never "the world". The three levels mean exactly
 * three things:
 *
 * ```
 * clientDetailKeys.all()                        every client, every tab
 * clientDetailKeys.client(id)                   one client, every tab
 * clientDetailKeys.tab(id, 'training')          one tab of one client
 * ```
 *
 * **Why literal keys rather than tRPC's own.** `@trpc/react-query` derives a
 * key from the procedure path, which would be fine for the two tabs that
 * have a procedure today — and unavailable to the four that do not. Tabs
 * 03–06 ship as shells whose data arrives with `phase-11-media-pipeline`,
 * `phase-13-nutrition`, `phase-14-messaging-and-realtime` and
 * `phase-17-structured-checkins` (the phase README's "the same pattern,
 * four times"), and a key they cannot write down yet is a key they will
 * invent separately later. One factory, written once, is what stops six
 * tabs growing six naming schemes.
 *
 * The consequence is the one thing to remember: **invalidate through
 * `queryClient.invalidateQueries({ queryKey })`, never through
 * `utils.coach.clients.overview.invalidate()`** — the latter targets tRPC's
 * key, which nothing on this screen uses.
 */
export const clientDetailKeys = {
  all: () => ['clients'] as const,
  client: (clientId: string) => ['clients', clientId] as const,
  tab: (clientId: string, tab: ClientDetailTab) => ['clients', clientId, tab] as const,
};

/**
 * How long a painted tab is treated as current.
 *
 * One minute, and the number is about navigation rather than about how fast
 * a client's week changes. A coach's review block is dashboard → client →
 * tab → tab → back → next client (`CLAUDE.md` §1.1), and every return
 * inside this window costs nothing; past it, the next return revalidates
 * behind the content already on screen. It matches
 * `COACH_DASHBOARD_STALE_TIME_MS` deliberately — the two screens are one
 * navigation apart and a coach moving between them should not meet two
 * different staleness rules.
 *
 * **Never zero.** At zero, switching to Training and back re-fetches
 * Overview, and on a slow connection the screen is a spinner over data it
 * already had — the exact failure §8.3's "switching tabs never shows a
 * spinner" acceptance criterion is written against.
 */
export const CLIENT_DETAIL_STALE_TIME_MS = 60_000;

/**
 * §8.3's Overview tab — the whole tab in one round trip.
 *
 * One `useQuery`, not five. The server assembles the weight trend, the
 * adherence figures, the current program, the next check-in, the pinned
 * notes and the injuries list into a single response
 * (`features/coach/client-overview.ts`), because the screen's premise is a
 * single glance and five awaited calls is five chances to be slow.
 *
 * `gcTime` is tied to the persistence window by import rather than by a
 * matching literal: a `gcTime` below it evicts the entry the persister just
 * restored, and the warm-cache guarantee silently becomes a cold one
 * (`lib/query/persister.ts`).
 */
export function useClientOverview(clientId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'overview'),
    queryFn: () => utils.client.coach.clients.overview.query({ clientId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

/** The whole Overview payload, inferred — never restated (`code-conventions` §3). */
export type ClientOverview = NonNullable<ReturnType<typeof useClientOverview>['data']>;
export type ClientInjury = ClientOverview['injuries'][number];
export type WeightTrendPoint = ClientOverview['weightTrend'][number];
export type AdherenceTrendPoint = ClientOverview['adherence']['trend'][number];
export type PinnedNote = ClientOverview['pinnedNotes'][number];

/** Just enough of the client to draw the header above the facet bar. */
export interface ClientIdentity {
  name: string;
  status: ClientOverview['status'];
  goal: ClientOverview['goal'];
  avatarAssetId: string | null;
  coachSince: Date | null;
}

/**
 * The identity the tab shell's header draws — name, status, goal, avatar.
 *
 * **The same cache entry as `useClientOverview`, narrowed by `select`.** The
 * header sits above all six tabs and its four fields are already in the
 * Overview payload, so giving it a query of its own would be a second round
 * trip for data the default tab has fetched anyway. `select` means the
 * header re-renders only when one of those four fields changes — a weight
 * reading landing does not touch it (`frontend-performance` §3).
 *
 * The one cost is a deep link straight to a non-default tab, where this
 * fetches Overview for a name. That is one request, on a path a coach
 * reaches by push notification rather than by tapping, and it is cheaper
 * than the alternative: a name passed through route params, which is wrong
 * the moment the client renames themselves and absent the moment the link
 * comes from outside the app.
 */
export function useClientIdentity(clientId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'overview'),
    queryFn: () => utils.client.coach.clients.overview.query({ clientId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    select: (data): ClientIdentity => ({
      name: data.name,
      status: data.status,
      goal: data.goal,
      avatarAssetId: data.avatarAssetId,
      coachSince: data.coachSince,
    }),
  });
}

/**
 * §8.3's Training tab — the session history list, keyset-paginated.
 *
 * `useInfiniteQuery` with the literal key rather than
 * `api.coach.clients.trainingHistory.useInfiniteQuery`, for the reason
 * `clientDetailKeys` states: the tab's cache entry is `['clients', id,
 * 'training']`, so this tab invalidates, persists, and evicts on the same
 * terms as the other five, and `coach-notes` or `session-review` can reach
 * it by name without knowing a tRPC path.
 *
 * `initialPageParam` is `null`, not `undefined`: `exactOptionalPropertyTypes`
 * makes an explicit `cursor: undefined` a different thing from an absent
 * one, so the first page omits the key entirely rather than sending it
 * empty.
 *
 * The list is what a coach came to the tab for, so it is fetched eagerly on
 * mount and the SECOND page is not — `getNextPageParam` returns the
 * server's own `nextCursor`, and `null` there is TanStack's "no more
 * pages", which is exactly what the server means by it.
 */
export function useClientTrainingHistory(clientId: string) {
  const utils = api.useUtils();

  return useInfiniteQuery({
    queryKey: clientDetailKeys.tab(clientId, 'training'),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      utils.client.coach.clients.trainingHistory.query(
        pageParam === null ? { clientId } : { clientId, cursor: pageParam },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

/** One session in the history list, inferred — never restated (`code-conventions` §3). */
export type SessionHistoryItem = NonNullable<
  ReturnType<typeof useClientTrainingHistory>['data']
>['pages'][number]['items'][number];

// ── session-review/01 ───────────────────────────────────────────────────
//
// The full-session read behind a Training-tab row. It lives in this module
// rather than a second one for `clientDetailKeys`' own reason: one feature,
// one tRPC call surface, so a key and an invalidation rule have exactly one
// home.

/**
 * `['sessions', sessionId]` — `code-conventions` §5's own key for one
 * session, and deliberately not a nested `['clients', id, 'training', …]`.
 *
 * A session is reachable without its client: a push notification deep-links
 * straight here, and the id in the route is the only thing known at that
 * point. Keying it under the client would make the cache entry unreachable
 * until the client's id was fetched, which is the waterfall this screen is
 * built to avoid.
 */
export const sessionReviewKeys = {
  all: () => ['sessions'] as const,
  detail: (sessionId: string) => ['sessions', sessionId] as const,
};

/**
 * §8.4's coach-side close: the whole session in one round trip — every set,
 * grouped by exercise in performed order, PR flags per set, skips
 * interleaved where the program put them.
 *
 * **`refetchOnWindowFocus` is OFF, and it is not a preference.**
 * `session.review` is the API's one sanctioned query-that-writes: reading
 * it sets `reviewed_at` (`features/coach/session-review.ts` decision (a)).
 * TanStack's default refires a stale query on every app foreground, so
 * leaving the default on would turn "the coach glanced at this once" into a
 * write every time the phone came out of a pocket. The write is idempotent
 * (`UPDATE … WHERE reviewed_at IS NULL`), so nothing would be corrupted —
 * but it would be a request per foreground for a screen that already has
 * its answer, on a device this product assumes is on bad signal.
 *
 * The read stays fresh the way the rest of the coach's review block does:
 * `CLIENT_DETAIL_STALE_TIME_MS`, and an explicit retry from the error
 * state.
 */
export function useSessionReview(sessionId: string) {
  const utils = api.useUtils();

  return useQuery({
    queryKey: sessionReviewKeys.detail(sessionId),
    queryFn: () => utils.client.session.review.query({ sessionId }),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    // See this function's doc comment — a query that writes must not be
    // re-issued by an app foreground.
    refetchOnWindowFocus: false,
  });
}

/** The whole session payload, inferred — never restated (`code-conventions` §3). */
export type SessionReview = NonNullable<ReturnType<typeof useSessionReview>['data']>;
/** One row of the session: an exercise that was performed, or one that was skipped. */
export type SessionReviewEntry = SessionReview['exercises'][number];
export type SessionReviewExerciseGroup = Extract<SessionReviewEntry, { kind: 'performed' }>;
export type SessionReviewSkippedExercise = Extract<SessionReviewEntry, { kind: 'skipped' }>;
export type SessionReviewSet = SessionReviewExerciseGroup['sets'][number];

/**
 * The client's name for the session-review header — **from the cache only,
 * never a request.**
 *
 * `session.review` returns a `clientId` and no name, and the screen's whole
 * premise is one round trip (`screen-composition` §2). A second query for a
 * header line would be a waterfall behind the first: its input is a field
 * of the response it would be waiting on.
 *
 * So this observes the client-detail Overview entry `useClientIdentity`
 * already owns, with `enabled: false`. On the path a coach actually takes —
 * dashboard → client → Training → a session — that entry is warm and the
 * name is free. On a deep link it is absent, and the header's sub-line
 * degrades to the date alone, which is `LoggerHeader`'s rule carried over:
 * every slot degrades on its own and none of them produces a half-filled
 * bar.
 *
 * `gcTime` matches `useClientOverview`'s so that mounting this observer can
 * never shorten the entry's life.
 */
export function useCachedClientName(clientId: string | null): string | null {
  const utils = api.useUtils();

  const { data } = useQuery({
    queryKey: clientDetailKeys.tab(clientId ?? '', 'overview'),
    queryFn: () => utils.client.coach.clients.overview.query({ clientId: clientId ?? '' }),
    // Never fetches. The entry is either already there or it is not.
    enabled: false,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    select: (overview): string => overview.name,
  });

  return clientId === null ? null : (data ?? null);
}
