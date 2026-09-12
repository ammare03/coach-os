import {
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  EmptyState,
  LoadingState,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
} from '@coachos/ui';
import { type AdherenceState } from '@coachos/utils';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { SearchX, TriangleAlert, UserPlus } from 'lucide-react-native';
import { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClientListControls } from '../components/ClientListControls.tsx';
import { ClientRow } from '../components/ClientRow.tsx';
import { DashboardCounters } from '../components/DashboardCounters.tsx';
import { useClientListFilters } from '../hooks/useClientListFilters.ts';
import { useCoachDashboard, type CoachDashboardClient } from '../hooks/useCoachDashboard.ts';

// `(coach)/(tabs)/index` — §8.2's dashboard. A Scan list (`UI-UX.md` §UX2):
// one query at mount, no waterfall, and every row render-complete from it,
// so nothing inside a row ever fetches (`screen-composition` §2).
//
// **`FlashList` v2 (2.0.2), and deliberately no size prop.**
// `CLAUDE.md` §25.8's warning — "FlashList needs `estimatedItemSize` or
// scroll performance collapses" — is a **v1** rule, and this is v2: the
// prop does not exist in 2.0.2 (it is absent from `FlashListProps` and from
// the whole package), because v2's recycler measures rows itself.
// `overrideItemLayout` is not a substitute either — in v2 it hands back
// only `{ span }`, never a size. Passing `estimatedItemSize` here would be
// a type error, not a tuning choice.
//
// What §25.8 is actually protecting is still honoured, one layer down:
// `ClientRow` pins its own `minHeight` to the measured `CLIENT_ROW_HEIGHT`,
// so every row reports a stable, uniform size to the recycler on first
// layout instead of settling over several frames.
//
// **No `getItemLayout`** — a `FlatList` prop that FlashList has no
// equivalent for, and one this list would refuse anyway: it pins rows to a
// fixed height, and at 200% text a `ClientRow` is taller than
// `CLIENT_ROW_HEIGHT`.
//
// Gone with the `FlatList`: `removeClippedSubviews`, `initialNumToRender`
// and `windowSize`. All three are knobs on FlatList's windowing, which
// FlashList's recycler replaces outright. `drawDistance` is v2's nearest
// equivalent and is left at its default — tuning it without a profile on
// the target device is the speculative work `frontend-performance` §10
// warns against.

/**
 * One frozen array, not a fresh `[]` per render: it is the `clients`
 * argument to `useClientListFilters`, whose memo would otherwise recompute
 * — and re-sort a hundred rows — on every render before the fetch resolves.
 */
const EMPTY_ROSTER: readonly CoachDashboardClient[] = [];

export interface CoachDashboardScreenProps {
  onOpenClient: (clientId: string) => void;
  onInviteClient: () => void;
}

export function CoachDashboardScreen({ onOpenClient, onInviteClient }: CoachDashboardScreenProps) {
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();
  const dashboard = useCoachDashboard();

  const data = dashboard.data;
  const roster = data?.clients ?? EMPTY_ROSTER;

  // §8.2's sort, search, and filter — all of it derived from the array
  // already fetched above, and the reason this screen still makes exactly
  // one request (`coach-dashboard/02`).
  const filters = useClientListFilters(roster);

  // Stable across renders, so `ClientRow`'s `memo` is not defeated by a new
  // arrow per row (`frontend-performance` §3).
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CoachDashboardClient>) => (
      <ClientRow client={item} onPress={onOpenClient} />
    ),
    [onOpenClient],
  );

  return (
    <View style={[styles.flex, themed.screen]}>
      <FlashList
        data={filters.clients}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text size="h1">Clients</Text>
            <Text size="body-sm" tone="muted" style={styles.subtitle}>
              {describeRoster(data?.clients)}
            </Text>

            {data ? (
              <View style={styles.counters}>
                <DashboardCounters
                  values={{
                    needsReview: data.needsReview,
                    offPlan: data.offTrack,
                    checkinsDue: data.checkinsDue,
                  }}
                  selected={filters.counter}
                  onSelect={filters.selectCounter}
                />
              </View>
            ) : null}

            {roster.length > 0 ? (
              <>
                <AdherenceKey />
                <ClientListControls filters={filters} />
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <DashboardBody
            hasRoster={roster.length > 0}
            onClearFilters={filters.clearAll}
            isPending={dashboard.isPending}
            isError={dashboard.isError}
            onRetry={() => {
              void dashboard.refetch();
            }}
            onInviteClient={onInviteClient}
          />
        }
        // Pre-wired for `coach-dashboard/03`, which owns pull-to-refresh and
        // does the rest of its work inside `useCoachDashboard` — this prop
        // needs no change when it lands.
        refreshControl={
          <RefreshControl
            refreshing={dashboard.isRefetching}
            onRefresh={() => {
              void dashboard.refetch();
            }}
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing(6), paddingBottom: insets.bottom + spacing(52) },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

interface DashboardBodyProps {
  /** The coach HAS clients; the list is empty because their own controls emptied it. */
  hasRoster: boolean;
  onClearFilters: () => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onInviteClient: () => void;
}

/**
 * The four states a client list can be in with no rows to draw
 * (`ui-conventions` §4). Forbidden is absent deliberately: `coach.dashboard`
 * takes no id and resolves entirely from the caller's own
 * `coachProfileId`, so there is no other coach's dashboard to be refused.
 */
function DashboardBody({
  hasRoster,
  onClearFilters,
  isPending,
  isError,
  onRetry,
  onInviteClient,
}: DashboardBodyProps) {
  const iconColor = useEmptyIconColor();

  if (isPending) {
    return (
      <LoadingState
        shape="list"
        rows={8}
        density="coach"
        accessibilityLabel="Loading your clients"
      />
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<TriangleAlert size={22} color={iconColor} />}
        title="We couldn't load your clients"
        body="Check your connection and try again. Nothing your clients have logged is affected."
        primaryAction={{ label: 'Try again', onPress: onRetry }}
        density="coach"
        testID="dashboard-error"
      />
    );
  }

  // The coach's own search and filters emptied the list. Stating the fact
  // and offering the one action that undoes it (`product-copy` §5) — never
  // "no results found", which reads as a failure of the roster rather than
  // of the query.
  if (hasRoster) {
    return (
      <EmptyState
        icon={<SearchX size={22} color={iconColor} />}
        title="No clients match"
        body="Nothing on your roster matches this search and these filters."
        primaryAction={{ label: 'Clear search and filters', onPress: onClearFilters }}
        density="coach"
        testID="dashboard-no-results"
      />
    );
  }

  return (
    <EmptyState
      icon={<UserPlus size={22} color={iconColor} />}
      title="No clients yet"
      body="Invite someone you already coach and their sessions land here."
      primaryAction={{ label: 'Invite your first client', onPress: onInviteClient }}
      density="coach"
      testID="dashboard-empty"
    />
  );
}

const KEY_STATES: readonly AdherenceState[] = ['on-track', 'drifting', 'off-track', 'no-data'];

/**
 * `DESIGN.md` §8 requires a key wherever the adherence graphic appears more
 * than eight times in one view. At a hundred rows carrying two dots each,
 * this is not optional.
 *
 * Hidden from the screen reader: every row already announces both of its
 * states in words, so the key is redundant there and would only add a
 * four-item preamble to the list.
 */
function AdherenceKey() {
  const themed = useThemedStyles();

  return (
    <View
      style={[styles.key, themed.keyBorder]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="adherence-key"
    >
      {KEY_STATES.map((state) => (
        <AdherenceDot key={state} state={state} size="sm" label={ADHERENCE_STATE_LABEL[state]} />
      ))}
    </View>
  );
}

function keyExtractor(client: CoachDashboardClient): string {
  return client.clientId;
}

/**
 * Counts, never a judgement (`product-copy` §1), and a reserved blank line
 * before the first load so nothing shifts when the number arrives.
 */
function describeRoster(clients: readonly CoachDashboardClient[] | undefined): string {
  // A blank reserved line, not "No clients yet" — the empty state below
  // already says exactly that, and the same sentence twice on one screen
  // reads as a bug.
  if (clients === undefined || clients.length === 0) return ' ';

  const invited = clients.filter((client) => client.status === 'invited').length;
  const active = clients.length - invited;
  const activePart = `${String(active)} active`;

  return invited === 0 ? activePart : `${activePart} · ${String(invited)} invited`;
}

const GUTTER = density.coach.gutter;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  header: { paddingBottom: spacing(4) },
  subtitle: { marginTop: spacing(4) },
  counters: { marginTop: spacing(14) },
  key: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(14),
    marginTop: spacing(14),
    paddingBottom: spacing(10),
    borderBottomWidth: 1,
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  keyBorder: { borderBottomColor: t.colors.border.soft },
}));

const useEmptyIconColor = createThemedValue((t) => t.colors.fg.muted);
