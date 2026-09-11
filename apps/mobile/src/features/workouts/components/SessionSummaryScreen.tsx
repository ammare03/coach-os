import { Button, Card, Skeleton, Text } from '@coachos/ui';
import { density, spacing } from '@coachos/ui/theme';
import { useContext, useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import { useClientTimeZone } from '../../../lib/time-zone/useClientTimeZone.ts';
import { useSessionRecords } from '../hooks/useSessionRecords.ts';
import { useSessionSummary } from '../hooks/useSessionSummary.ts';
import { restoreSkips } from '../hooks/useSkipExercise.ts';
import { restoreSubstitutions } from '../hooks/useSwapExercise.ts';
import { SUMMARY_COPY, describeFinishedAt } from '../lib/session-summary.ts';
import type { SessionSummaryRead } from '../lib/session-summary.ts';
import { selectSessionRecords, useSessionRecordsStore } from '../store/session-records-store.ts';
import { selectSkips, useSkippedExercisesStore } from '../store/skipped-exercises-store.ts';
import {
  selectSubstitutions,
  useSubstitutedExercisesStore,
} from '../store/substituted-exercises-store.ts';

import { ModificationsSummary } from './ModificationsSummary.tsx';
import { PostSessionPrompt } from './PostSessionPrompt.tsx';
import { SessionSummaryCard } from './SessionSummaryCard.tsx';

// `phase-09-workout-logger/session-summary/01` — the terminal screen of the
// session lifecycle.
//
// Seven decisions, in the order they matter:
//
// (a) **Nothing on this screen waits for the network, and nothing on it can
//     be made to.** There is no tRPC call in this file or anything it
//     imports for its data: the figures come from local SQLite
//     (`lib/session-summary.ts`), the records from a device-side ledger
//     mirrored into `meta`, and the skip and swap counts from the two
//     stores the logger already filled. That is the task's fourth
//     acceptance criterion, and it is met by construction rather than by a
//     connectivity branch.
//
// (b) **A shaped skeleton, never a spinner — and it lasts one frame.** The
//     read is local, so the loading state exists only for the tick before
//     SQLite answers. It is still drawn at the real footprint, because a
//     collapsing placeholder shifts the numbers under a thumb already
//     reaching for Done (`screen-composition` §4, `DESIGN.md` §5's ban on
//     a spinner where a skeleton belongs).
//
// (c) **Done never depends on the read.** It needs the route and nothing
//     else, so it renders in all four states including the one where the
//     local mirror refused to open — `screen-composition` §3's "the primary
//     action works when every optional section fails", in its literal form.
//     It is also the only way off this screen that always exists: the
//     logger `replace`d itself with this route, so there is nothing behind
//     it to go back to.
//
// (d) **A missing session is not an error.** `useSessionSummary` decision
//     (b). The copy says nothing is lost, because nothing is.
//
// (e) **The two modification stores are re-opened and re-hydrated here.**
//     Arriving from Finish they are already populated in memory and both
//     calls are no-ops. Arriving after a force-quit — a client who closed
//     the app on the walk home and opened the summary from a notification —
//     they are empty, and the `meta` mirrors `useSkipExercise` and
//     `useSwapExercise` wrote are what make the counts survive.
//     `openSession` before the restore in both cases, because `hydrate`
//     refuses a session the store is not open on.
//
// (f) **`useSessionRecords` is mounted here as well as in the logger.**
//     A set logged in a basement confirms whenever the tunnel clears, which
//     is routinely after Finish. `personal-records/03` drops that late
//     confirmation on purpose — a pill over a finished workout is a
//     notification about the past — but the RECORD is exactly what this
//     screen exists to list, so the ledger keeps listening here. Recording
//     is idempotent, so the overlap costs nothing
//     (`hooks/useSessionRecords.ts` decision (c)).
//
// (g) **No analytics event.** `workout_completed` already fired at the tap
//     that produced this screen, and a `session_summary_viewed` would be an
//     event nobody has committed to reading — `analytics-events` §1 says
//     not to add it until someone can name the decision it changes.

/** The skeleton's footprint, matched to `SessionSummaryCard`'s stat row. */
const SKELETON = {
  eyebrow: 16,
  title: 30,
  label: 16,
  value: 34,
} as const;

export interface SessionSummaryScreenProps {
  /** `local_workout_sessions.client_local_id` — the id `useCompleteSession` handed back. */
  sessionLocalId: string;
  /** Leaves for Today. The only exit, and it never depends on the read — decision (c). */
  onDone: () => void;
}

export function SessionSummaryScreen({ sessionLocalId, onDone }: SessionSummaryScreenProps) {
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws where no provider sits above it — the degradation `TodayScreen`
  // and `SessionLoggerScreen` document for the same reason.
  const insets = useContext(SafeAreaInsetsContext);
  const { state, retry } = useSessionSummary(sessionLocalId);
  const unit = useWeightUnit();
  const timeZone = useClientTimeZone();

  useSessionRecords({ sessionLocalId });
  const records = useSessionRecordsStore(selectSessionRecords);

  // Decision (e), and the guard that makes it safe: **restore only when the
  // store is empty.** `restoreSkips`/`restoreSubstitutions` CLEAR their
  // `meta` row when they find nothing for this session, and this screen
  // cannot join the serialised write chains those two hooks own — so an
  // unconditional restore here could land between the logger's last mirror
  // write being enqueued and its landing, and delete it. A store that
  // already holds the session's skips came from the logger, which means the
  // row is either written or about to be and there is nothing to restore;
  // an empty one means no logger is running, so nothing is in flight.
  useEffect(() => {
    useSkippedExercisesStore.getState().openSession(sessionLocalId);
    if (useSkippedExercisesStore.getState().skips.size === 0) {
      void restoreSkips(sessionLocalId);
    }

    useSubstitutedExercisesStore.getState().openSession(sessionLocalId);
    if (useSubstitutedExercisesStore.getState().substitutions.size === 0) {
      void restoreSubstitutions(sessionLocalId);
    }
  }, [sessionLocalId]);

  const skips = useSkippedExercisesStore(selectSkips);
  const substitutions = useSubstitutedExercisesStore(selectSubstitutions);

  return (
    <View style={[styles.screen, { paddingTop: insets?.top ?? 0 }]} testID="session-summary">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {state.kind === 'loading' ? <SummarySkeleton /> : null}

        {state.kind === 'missing' ? (
          <SummaryMessage title={SUMMARY_COPY.missingTitle} body={SUMMARY_COPY.missingBody} />
        ) : null}

        {state.kind === 'error' ? (
          <SummaryMessage
            title={SUMMARY_COPY.errorTitle}
            body={SUMMARY_COPY.errorBody}
            action={{ label: SUMMARY_COPY.retry, onPress: retry }}
          />
        ) : null}

        {state.kind === 'summary' ? (
          <>
            <SummaryHeader summary={state.summary} timeZone={timeZone} />
            <SessionSummaryCard summary={state.summary} records={records} unit={unit} />
            <ModificationsSummary skippedCount={skips.size} substitutedCount={substitutions.size} />
            {/* `session-summary/02`, and `03`'s capture behind it. Below the
                figures because it is the one thing on this screen that asks
                the client for something, and only in the `summary` state: a
                session this device does not hold has nothing to attach a
                note or a form check to. It gates nothing — Done, in the
                foot, never reads it (decision (c)).

                `exerciseNames` is keyed by `exercises.id`, so its keys are
                the session's own exercises — the context the form-check
                route is opened with. */}
            <PostSessionPrompt
              sessionLocalId={sessionLocalId}
              exerciseIds={[...state.summary.exerciseNames.keys()]}
            />
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: spacing(20) + (insets?.bottom ?? 0) }]}>
        <Button
          variant="primary"
          size="md"
          // 52px — §1.3's client button, and `Button` applies it as a
          // `minHeight` so the label grows past it at 200% text rather than
          // clipping.
          density="client"
          fullWidth
          onPress={onDone}
          accessibilityLabel={SUMMARY_COPY.done}
          testID="summary-done"
        >
          {SUMMARY_COPY.done}
        </Button>
      </View>
    </View>
  );
}

function SummaryHeader({ summary, timeZone }: { summary: SessionSummaryRead; timeZone: string }) {
  return (
    <View style={styles.head}>
      {summary.completedAt === null ? null : (
        <Text size="eyebrow" tone="muted" style={styles.eyebrow}>
          {describeFinishedAt(summary.completedAt, timeZone)}
        </Text>
      )}
      {/* Wraps rather than truncates. A session called "Lower body A —
          deload week" is the client's own word for their workout and is not
          this screen's to cut. */}
      <Text size="h1-client" accessibilityRole="header">
        {summary.name ?? SUMMARY_COPY.untitled}
      </Text>
    </View>
  );
}

/**
 * The stat row's own boxes, at its own footprint, so nothing shifts when the
 * figures land. Exactly one shape carries a label — the region reads as one
 * busy item, never as five (`accessibility` §2).
 */
function SummarySkeleton() {
  return (
    <>
      <View style={styles.head}>
        <Skeleton width={152} height={SKELETON.eyebrow} radius="chip" />
        <Skeleton width={196} height={SKELETON.title} radius="chip" />
      </View>
      <Card elevation="raised" density="client" testID="summary-skeleton">
        <View style={styles.figures}>
          {['volume', 'time', 'sets'].map((key, index) => (
            <View
              key={key}
              style={[
                styles.cell,
                index === 0 ? styles.firstCell : null,
                index === 2 ? styles.lastCell : null,
              ]}
            >
              <Skeleton
                width={index === 0 ? 54 : 40}
                height={SKELETON.label}
                radius="chip"
                {...(index === 0 ? { accessibilityLabel: SUMMARY_COPY.loading } : {})}
              />
              <Skeleton width={index === 0 ? 78 : 66} height={SKELETON.value} radius="chip" />
            </View>
          ))}
        </View>
      </Card>
    </>
  );
}

function SummaryMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.message} testID="summary-message">
      <Text size="title" accessibilityRole="header" style={styles.centred}>
        {title}
      </Text>
      <Text size="body-lg" tone="muted" style={styles.body}>
        {body}
      </Text>
      {action ? (
        <View style={styles.messageAction}>
          <Button
            variant="secondary"
            size="md"
            density="client"
            onPress={action.onPress}
            accessibilityLabel={action.label}
            testID="summary-retry"
          >
            {action.label}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** `LoggerNoPrescription`'s measure, for the same one-idea-per-line reason. */
const BODY_MAX_WIDTH = 270;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    // `flexGrow`, not `flex`: the content is short in every state and long
    // at 200% text, and only the second may scroll.
    flexGrow: 1,
    paddingHorizontal: density.client.gutter,
    paddingTop: spacing(12),
    gap: density.client.sectionGap,
  },
  head: {
    gap: spacing(6),
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
  figures: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cell: {
    flex: 1,
    minWidth: 0,
    gap: spacing(5),
    paddingHorizontal: spacing(12),
  },
  /** `SessionSummaryCard`'s own rule — the outer edges are the card's padding. */
  firstCell: {
    paddingLeft: 0,
  },
  lastCell: {
    paddingRight: 0,
  },
  message: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing(10),
  },
  centred: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: BODY_MAX_WIDTH,
  },
  messageAction: {
    marginTop: spacing(6),
  },
  foot: {
    paddingHorizontal: density.client.gutter,
    paddingTop: spacing(16),
  },
});
