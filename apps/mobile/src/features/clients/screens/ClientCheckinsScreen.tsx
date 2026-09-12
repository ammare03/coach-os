import {
  EmptyState,
  LoadingState,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
} from '@coachos/ui';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, TriangleAlert } from 'lucide-react-native';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { QUERY_CACHE_MAX_AGE_MS } from '../../../lib/query/persister.ts';
import { useClientTimeZone } from '../../../lib/time-zone/useClientTimeZone.ts';
import { CLIENT_DETAIL_STALE_TIME_MS, clientDetailKeys } from '../api.ts';
import { ClientCheckinsRow, type ClientCheckin } from '../components/ClientCheckinsRow.tsx';

// §8.3's Check-ins facet — a **Scan list** (`UI-UX.md` §UX2) over the
// client's own check-in history, most recent period first.
//
// **A forward hook, and deliberately only that** (P10 README, "The same
// pattern, four times"). What ships here is the facet's own cache entry,
// the list, the four status badges and a designed empty state. What fills
// it ships with `phase-17-structured-checkins/checkin-review/`, against the
// contract stated in full in `app/(coach)/client/[id]/checkins.tsx`. Until
// then every client's Check-ins tab renders the empty state, which is the
// correct permanent state for a client who genuinely has none — never a
// blank screen, never a spinner that will not resolve, and never an error.
//
// **No per-section error boundary**, for the same reason `ClientOverview
// Screen` has none: one query means there is no one part that can fail
// alone. What `screen-composition` §3 is protecting survives regardless —
// the facet bar and the back control live in `_layout.tsx`, so a failed
// Check-ins tab leaves the other five facets working.

/**
 * One frozen array, not a fresh `[]` per render: it is `FlashList`'s `data`
 * before the query resolves, and a new reference each render would make
 * the list re-key its (empty) window every time the screen re-renders.
 */
const EMPTY_CHECKINS: readonly ClientCheckin[] = [];

/**
 * **The seam, and the only line `phase-17-structured-checkins` replaces.**
 *
 * There is no `checkins.listForClient` to call yet — `packages/schemas/src/
 * checkins.ts` is an empty module reserved for that phase. Resolving to an
 * empty list rather than leaving the query un-fired is what makes the tab's
 * cache entry, its stale window, its loading state and its empty state real
 * today, so none of them is written for the first time under pressure when
 * the data arrives.
 *
 * It takes `clientId` it does not use for exactly that reason: the shape of
 * the call is already the shape P17 needs.
 */
async function fetchClientCheckins(clientId: string): Promise<readonly ClientCheckin[]> {
  void clientId;
  return EMPTY_CHECKINS;
}

/**
 * §8.3's Check-ins tab, on its own cache entry.
 *
 * The key is `clientDetailKeys.tab(clientId, 'checkins')` — the factory
 * `client-detail/01` owns, never a key restated here — which is what makes
 * this tab independently cached and independently invalidatable
 * (`code-conventions` §5). `gcTime` is tied to the persistence window by
 * import rather than by a matching literal, for the same reason
 * `useClientOverview` ties it: a `gcTime` below it evicts the entry the
 * persister just restored and the warm-cache guarantee silently becomes a
 * cold one.
 */
export function useClientCheckins(clientId: string) {
  return useQuery({
    queryKey: clientDetailKeys.tab(clientId, 'checkins'),
    queryFn: () => fetchClientCheckins(clientId),
    staleTime: CLIENT_DETAIL_STALE_TIME_MS,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
  });
}

export interface ClientCheckinsScreenProps {
  clientId: string;
  /**
   * Into `phase-17-structured-checkins`'s own review screen, at
   * `/(coach)/checkin/[id]` — a route that already exists as a
   * `phase-05-app-shell` placeholder. Wired now, so nothing on this side
   * changes when that phase builds what it shows.
   */
  onOpenCheckin: (checkinId: string) => void;
  /** The empty state's one next step. Never a query-dependent action (`screen-composition` §3). */
  onOpenOverview: () => void;
}

export function ClientCheckinsScreen({
  clientId,
  onOpenCheckin,
  onOpenOverview,
}: ClientCheckinsScreenProps) {
  const themed = useThemedStyles();
  // Resolved once for the whole list, not per row. In the coach app the
  // signed-in user is the coach, so this is the coach's own stored zone —
  // the right one for "when did this land for me" (`lib/time-zone/store.ts`
  // decision (a): the stored zone wins, the device's is the fallback).
  const timeZone = useClientTimeZone();
  const checkins = useClientCheckins(clientId);
  const rows = checkins.data ?? EMPTY_CHECKINS;

  // Stable across renders, so `ClientCheckinsRow`'s `memo` is not defeated
  // by a new arrow per row (`frontend-performance` §3).
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ClientCheckin>) => (
      <ClientCheckinsRow checkin={item} timeZone={timeZone} onPress={onOpenCheckin} />
    ),
    [onOpenCheckin, timeZone],
  );

  return (
    <View style={[styles.flex, themed.screen]} testID="client-checkins">
      {/* `FlashList` v2, and deliberately no size prop: `estimatedItemSize`
          does not exist in 2.0.2 — passing it is a type error, not a tuning
          choice. What `CLAUDE.md` §25.8 protects is honoured one layer
          down, by `CHECKIN_ROW_HEIGHT` on the row itself. */}
      <FlashList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListEmptyComponent={
          <CheckinsBody
            isPending={checkins.isPending}
            isError={checkins.isError}
            onRetry={() => {
              void checkins.refetch();
            }}
            onOpenOverview={onOpenOverview}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function keyExtractor(checkin: ClientCheckin): string {
  return checkin.checkinId;
}

interface CheckinsBodyProps {
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenOverview: () => void;
}

/**
 * The three states this list can be in with no rows to draw
 * (`ui-conventions` §4).
 *
 * **Forbidden is absent, deliberately.** `ERRORS.md` ER§2.1 makes another
 * coach's client return `NOT_FOUND` rather than `FORBIDDEN`, so a wrong id
 * is caught one layer up, by the tab shell's header — a 403 here would
 * confirm the row exists and turn id-walking into an enumeration oracle.
 */
function CheckinsBody({ isPending, isError, onRetry, onOpenOverview }: CheckinsBodyProps) {
  const iconColor = useEmptyIconColor();

  if (isPending) {
    return (
      <LoadingState shape="list" rows={6} density="coach" accessibilityLabel="Loading check-ins" />
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<TriangleAlert size={22} color={iconColor} />}
        title="We couldn't load check-ins"
        body="Check your connection and try again. Nothing this client has submitted is affected."
        primaryAction={{ label: 'Try again', onPress: onRetry }}
        density="coach"
        testID="client-checkins-error"
      />
    );
  }

  // States the fact and offers one next step, with no apology and no
  // exclamation mark (`COPY.md` §CO4.1). "Once this client has one
  // scheduled" names the gap without promising a feature or implying the
  // client is at fault for it.
  //
  // **The action is Overview, and that is the P17 slot.** Scheduling a
  // check-in is `phase-17-structured-checkins`'s work and does not exist
  // yet, so the honest next step is the one surface in P10 that says
  // anything about this client's check-in schedule at all — Overview's
  // "Next check-in" card. An inert "Schedule a check-in" button would be
  // the broken-hook failure the phase README names outright; P17 replaces
  // this action in place, and nothing else on this screen moves.
  return (
    <EmptyState
      icon={<CalendarDays size={22} color={iconColor} />}
      title="No check-ins yet"
      body="Check-ins appear here once this client has one scheduled."
      primaryAction={{ label: 'Back to overview', onPress: onOpenOverview }}
      density="coach"
      testID="client-checkins-empty"
    />
  );
}

const GUTTER = density.coach.gutter;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER, paddingTop: spacing(6), paddingBottom: spacing(40) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));

const useEmptyIconColor = createThemedValue((t) => t.colors.fg.muted);
