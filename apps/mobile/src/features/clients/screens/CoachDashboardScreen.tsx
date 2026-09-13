import {
  ADHERENCE_STATE_LABEL,
  AdherenceDot,
  EmptyState,
  LoadingState,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  radius,
  spacing,
} from '@coachos/ui';
import { type AdherenceState } from '@coachos/utils';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Archive, SearchX, TriangleAlert, UserPlus } from 'lucide-react-native';
import { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClientListControls } from '../components/ClientListControls.tsx';
import { ClientRow, type ClientRowVariant } from '../components/ClientRow.tsx';
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

  // **The whole list is archived, so no row has to say so.** Only an
  // Archived chip on its own qualifies: the moment it sits beside another
  // status the list is mixed again and every row owes the reader its own
  // (`ClientRow`'s `variant` contract).
  const variant: ClientRowVariant = isArchivedOnly(filters.statuses) ? 'archived' : 'roster';

  // Stable across renders, so `ClientRow`'s `memo` is not defeated by a new
  // arrow per row (`frontend-performance` §3). `variant` joins the
  // dependency list rather than being read inside: it changes once, when a
  // chip is tapped, and a re-render of a hundred rows is exactly what
  // should happen then.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CoachDashboardClient>) => (
      <ClientRow client={item} onPress={onOpenClient} variant={variant} />
    ),
    [onOpenClient, variant],
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
                {/* No key under the Archived filter: the rows there draw no
                    dots, so a legend for a graphic that is not on screen is
                    four items of pure preamble. */}
                {variant === 'archived' ? null : <AdherenceKey />}
                <ClientListControls filters={filters} />
                {variant === 'archived' ? <ArchivedListNote /> : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <DashboardBody
            hasRoster={roster.length > 0}
            variant={variant}
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
  variant: ClientRowVariant;
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
  variant,
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

  // **A coach who has never archived anyone, asking for the archived list.**
  // Its own state, ahead of the generic one below, because "No clients
  // match / clear your filters" would be answering a question they did not
  // ask: nothing is narrowed away here, there is simply nothing to show
  // yet. And because the sentence that belongs here is the reassuring one —
  // archiving is the action a coach hesitates over (`COPY.md` §CO4.1).
  if (hasRoster && variant === 'archived') {
    return (
      <EmptyState
        icon={<Archive size={22} color={iconColor} />}
        title="No archived clients"
        body="Clients you archive move here and keep everything they logged."
        // The way out of a filter that has nothing behind it
        // (`ui-conventions` §4: an empty state gets one clear next step).
        // "Back to your clients", not "Clear filters": the coach set one
        // chip deliberately and is being returned somewhere, not corrected.
        primaryAction={{ label: 'Back to your clients', onPress: onClearFilters }}
        density="coach"
        testID="dashboard-no-archived"
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

/** On screen, and the two lines are one thought split where the design splits it. */
export const ARCHIVED_NOTE_TITLE = 'Archived clients keep everything they logged';
export const ARCHIVED_NOTE_BODY =
  'They do not count against your plan. Send a new invite to work with someone again.';

/**
 * The one-paragraph answer to what archiving actually did, at the head of
 * the list of people it was done to.
 *
 * **It is here because this is where a coach comes back to check.** The
 * typed confirmation said all of this at the moment of archiving; a
 * confirmation is read once, under pressure, by someone deciding. This is
 * read calmly, by someone who already decided and wants to know whether
 * they lost anything — and the answer, twice over, is no.
 *
 * An L1 well and not a card: `PrivacyLabel`'s register, for the same reason
 * it gives — a statement the product makes, never a control. Nothing here
 * is tappable, and "send a new invite" names the path rather than offering
 * it, because the invite is per client and this note is about all of them.
 *
 * ⚠️ **Never a per-row chip.** Every row under this filter is archived, so
 * a chip on each repeats one sentence until it is texture — `coach-notes/02`'s
 * own argument, applied to a status.
 */
function ArchivedListNote() {
  const themed = useThemedStyles();
  const iconColor = useArchivedNoteIconColor();

  return (
    // One node in the reading order, not three: the glyph is decoration and
    // the two lines are one sentence to a screen reader.
    <View
      style={[styles.note, themed.note]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${ARCHIVED_NOTE_TITLE}. ${ARCHIVED_NOTE_BODY}`}
      testID="archived-list-note"
    >
      <Archive
        size={ARCHIVED_NOTE_GLYPH}
        color={iconColor}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.noteText}>
        {/* The Medium face by name — `fontWeight` does nothing useful on
            Android (`Text`'s own contract). */}
        <Text size="body-sm" className="font-sans-medium">
          {ARCHIVED_NOTE_TITLE}
        </Text>
        <Text size="micro" tone="muted" style={styles.noteBody}>
          {ARCHIVED_NOTE_BODY}
        </Text>
      </View>
    </View>
  );
}

const ARCHIVED_NOTE_GLYPH = 16;

/** True only when `archived` is the whole selection, never merely part of it. */
function isArchivedOnly(statuses: readonly string[]): boolean {
  return statuses.length === 1 && statuses[0] === 'archived';
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

  // **Counted per status, never as "the rest are active".**
  //
  // This read `clients.length - invited` while the payload was two
  // statuses, where it was exact. `relationship-controls/01` widened it to
  // four, and the same expression would now report a coach's paused and
  // archived clients as active — on the one line of this screen a coach
  // reads as their seat count (`CLAUDE.md` §15.5: paused and archived cost
  // nothing).
  //
  // Archived is absent rather than zero: those clients are off the roster
  // entirely and out of the default list, and a "0 archived" on a coach who
  // has never archived anyone is a prompt to do it.
  const counts = { active: 0, invited: 0, paused: 0 };
  for (const client of clients) {
    if (client.status === 'active') counts.active += 1;
    else if (client.status === 'invited') counts.invited += 1;
    else if (client.status === 'paused') counts.paused += 1;
  }

  // Active first because it is the number a coach is looking for; paused
  // before invited because it is about someone already on the book.
  const parts = [
    `${String(counts.active)} active`,
    counts.paused === 0 ? null : `${String(counts.paused)} paused`,
    counts.invited === 0 ? null : `${String(counts.invited)} invited`,
  ].filter((part): part is string => part !== null);

  return parts.join(' · ');
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
  note: {
    flexDirection: 'row',
    // `flex-start`, not `center`: at 200% text the body wraps to three
    // lines and a centred glyph floats in the middle of them.
    alignItems: 'flex-start',
    gap: spacing(10),
    borderRadius: radius.card,
    borderWidth: 1,
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(12),
    marginBottom: spacing(4),
  },
  noteText: { flex: 1, minWidth: 0 },
  noteBody: { marginTop: spacing(3) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  keyBorder: { borderBottomColor: t.colors.border.soft },
  note: {
    // L1, the recessed-well fill — the same register `PrivacyLabel` and
    // Overview's injuries banner use for a statement the product makes
    // (`DESIGN.md` §2).
    backgroundColor: t.elevation.inset.backgroundColor,
    borderColor: t.colors.border.soft,
  },
}));

const useEmptyIconColor = createThemedValue((t) => t.colors.fg.muted);

const useArchivedNoteIconColor = createThemedValue((t) => t.colors.fg['warm-muted']);
