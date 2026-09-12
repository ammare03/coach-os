import {
  EmptyState,
  LoadingState,
  NotFoundState,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
} from '@coachos/ui';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { CalendarRange, TriangleAlert } from 'lucide-react-native';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { useClientTrainingHistory, type SessionHistoryItem } from '../api.ts';
import { SessionHistoryRow } from '../components/SessionHistoryRow.tsx';

// §8.3's Training tab: "session history list → tap → full session with
// every set". This is the list; `session-review/` is what a row opens.
//
// A **Scan list** (`UI-UX.md` §UX2) over exactly ONE keyset-paginated
// query. Two properties follow, and both are acceptance criteria:
//
//   - nothing inside a row fetches. Duration, volume, PR count and the
//     reviewed flag all arrive in the page (`screen-composition` §2), so a
//     year of history is one request per page and never one per row —
//     the N+1 this task's Risks section names.
//   - the first page paints on arrival and the next is fetched on scroll,
//     so a client with a year of training does not wait for all of it.
//
// **No per-section error boundary, deliberately.** The list IS the tab
// (`screen-composition` §3: only primary content may fail the whole
// screen), and the shell survives regardless — the facet bar and the back
// control live in `_layout.tsx`, so a failed Training tab leaves the other
// five working, which is the property §3 actually protects.
//
// **`FlashList` v2 (2.0.2), and deliberately no size prop.** `CLAUDE.md`
// §25.8's "FlashList needs `estimatedItemSize`" is a **v1** rule: the prop
// does not exist in 2.0.2, because v2's recycler measures rows itself, and
// passing it is a type error rather than a tuning mistake. What §25.8
// protects is honoured one layer down — `SessionHistoryRow` pins its own
// `minHeight` to the measured `SESSION_ROW_HEIGHT`, gap included, so every
// row reports a stable size on first layout.

/** One frozen array, not a fresh `[]` per render — it is `FlashList`'s `data`. */
const EMPTY_HISTORY: readonly SessionHistoryItem[] = [];

export interface ClientTrainingScreenProps {
  clientId: string;
  /** Opens `session-review`'s full-session screen. */
  onOpenSession: (sessionId: string) => void;
  /**
   * The Overview facet. The empty state's one next step, and the failure
   * state's: a client with no logged sessions usually has no program
   * assigned, and that fact — with the injuries banner and the check-in —
   * lives on Overview.
   */
  onOpenOverview: () => void;
  /** Where "not your client" leads. Never a query-dependent action (`screen-composition` §3). */
  onBack: () => void;
}

export function ClientTrainingScreen({
  clientId,
  onOpenSession,
  onOpenOverview,
  onBack,
}: ClientTrainingScreenProps) {
  const themed = useThemedStyles();
  const unit = useWeightUnit();
  const history = useClientTrainingHistory(clientId);

  // Every page flattened once per fetch, not per render.
  const sessions = history.data?.pages.flatMap((page) => page.items) ?? EMPTY_HISTORY;

  // Stable across renders, so `SessionHistoryRow`'s `memo` is not defeated
  // by a new arrow per row (`frontend-performance` §3).
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SessionHistoryItem>) => (
      <SessionHistoryRow session={item} unit={unit} onPress={onOpenSession} />
    ),
    [onOpenSession, unit],
  );

  if (history.isPending) {
    return (
      <View style={[styles.flex, themed.screen]}>
        <View style={styles.content}>
          <LoadingState
            shape="list"
            rows={6}
            density="coach"
            accessibilityLabel="Loading this client's sessions"
          />
        </View>
      </View>
    );
  }

  if (history.isError) {
    return (
      <View style={[styles.flex, themed.screen]}>
        <View style={styles.content}>
          <TrainingFailure
            error={history.error}
            onBack={onBack}
            onRetry={() => {
              void history.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.flex, themed.screen]}>
      <FlashList
        data={sessions}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // ~70% of a page ahead, so the next one is already in flight by the
        // time the last row is reached (`frontend-performance` §4).
        onEndReachedThreshold={0.7}
        onEndReached={() => {
          // `hasNextPage` alone is not enough: `onEndReached` fires more
          // than once per arrival at the end, and a second call while the
          // first is in flight would fetch the same cursor twice.
          if (history.hasNextPage && !history.isFetchingNextPage) {
            void history.fetchNextPage();
          }
        }}
        ListEmptyComponent={<TrainingEmpty onOpenOverview={onOpenOverview} />}
        ListFooterComponent={history.isFetchingNextPage ? <LoadingMore /> : null}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="client-training-history"
      />
    </View>
  );
}

interface TrainingFailureProps {
  error: unknown;
  onBack: () => void;
  onRetry: () => void;
}

/**
 * Two states, not one — the same split `ClientOverviewScreen` makes, for
 * the same reason. `NOT_YOUR_CLIENT` is the id being wrong (a stale deep
 * link, a released client) and its way out is back to the roster; a network
 * failure is the same client, unreachable, and its way out is to try again.
 * `ERRORS.md` ER§2.1 makes another coach's client return NOT_FOUND rather
 * than FORBIDDEN, so this renders `NotFoundState` and never
 * `ForbiddenState` — a 403 here would confirm the row exists and turn
 * id-walking into an enumeration oracle.
 */
function TrainingFailure({ error, onBack, onRetry }: TrainingFailureProps) {
  const iconColor = useMutedIconColor();

  if (getErrorCode(error) === 'NOT_YOUR_CLIENT') {
    return (
      <NotFoundState
        title="We couldn't find that client"
        body="They may have left your roster, or the link is out of date."
        onRecover={onBack}
        recoverLabel="Back to clients"
        density="coach"
        testID="client-training-not-found"
      />
    );
  }

  return (
    <EmptyState
      icon={<TriangleAlert size={22} color={iconColor} />}
      title="We couldn't load these sessions"
      body="Check your connection and try again. Nothing your client has logged is affected."
      primaryAction={{ label: 'Try again', onPress: onRetry }}
      density="coach"
      testID="client-training-error"
    />
  );
}

interface TrainingEmptyProps {
  onOpenOverview: () => void;
}

/**
 * Stating the fact, and one next step (`product-copy` §5).
 *
 * The step is Overview rather than an assign-a-program control built here:
 * a Training tab with nothing in it almost always means no program is
 * assigned, and Overview is where that — and the injuries, and the next
 * check-in — is already said. A second entry point to the same answer is a
 * second thing to keep in step.
 */
function TrainingEmpty({ onOpenOverview }: TrainingEmptyProps) {
  const iconColor = useMutedIconColor();

  return (
    <EmptyState
      icon={<CalendarRange size={22} color={iconColor} />}
      title="No sessions logged yet"
      body="Sessions appear here as they are logged."
      primaryAction={{ label: 'Open overview', onPress: onOpenOverview }}
      density="coach"
      testID="client-training-empty"
    />
  );
}

/**
 * The next page, arriving. A line rather than a skeleton row: a skeleton
 * card would be an L2 surface that might turn out to be L3, and a row that
 * changes elevation as it resolves reads as a needs-review flag flickering
 * on and off.
 */
function LoadingMore() {
  return (
    <View style={styles.footer}>
      <Text size="body-sm" tone="muted" accessibilityLiveRegion="polite">
        Loading more
      </Text>
    </View>
  );
}

function keyExtractor(session: SessionHistoryItem): string {
  return session.sessionId;
}

const GUTTER = density.coach.gutter;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: GUTTER, paddingBottom: spacing(40) },
  footer: { alignItems: 'center', paddingVertical: spacing(12) },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
}));

const useMutedIconColor = createThemedValue((t) => t.colors.fg.muted);
