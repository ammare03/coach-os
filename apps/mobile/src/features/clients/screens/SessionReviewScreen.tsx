import { EmptyState, NotFoundState, Skeleton, Text } from '@coachos/ui';
import { createThemedValue, density, spacing } from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { ClipboardList, TriangleAlert } from 'lucide-react-native';
import { useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { SET_FLAG_COPY } from '../../workouts/components/SetFlagChips.tsx';
import { useSessionReview, type SessionReview, type SessionReviewSet } from '../api.ts';
import { CommentAffordance } from '../components/CommentAffordance.tsx';
import { SessionExerciseGroup } from '../components/SessionExerciseGroup.tsx';
import { SessionFiguresCard, sessionFigures } from '../components/SessionFiguresCard.tsx';
import { formatSessionDate } from '../components/SessionHistoryRow.tsx';
import { SessionNoteWell, SESSION_NOTE_COPY } from '../components/SessionNoteWell.tsx';
import { SessionReviewHeader } from '../components/SessionReviewHeader.tsx';
import { formatSetLoad } from '../components/SessionSetRow.tsx';
import { SessionSkippedRow } from '../components/SessionSkippedRow.tsx';

// `session-review/01` — §8.4's coach-side close: "full session with every
// set, PRs highlighted."
//
// **A focus mode** (`UI-UX.md` §UX1.1 pattern C). `(coach)/_layout.tsx`
// registers this route `fullScreenModal` with `gestureEnabled: false` under
// a group-wide `headerShown: false`, so there is no dock, no router header
// and no edge swipe: the screen draws its own chrome and has exactly one
// exit, and that exit works in every state including both failures. A modal
// that cannot be dismissed is a trap.
//
// **One query, no waterfall** (`screen-composition` §2). `session.review`
// returns the whole session — figures, the client's words, every set with
// its PR flags, and the skips already interleaved where the program put
// them — and marks it reviewed on the way past. Nothing inside a row
// fetches, and there is no pagination: a session is bounded (~72 rows in
// the worst realistic case), so this is a `ScrollView` and not a
// `FlashList`, exactly like every other scan list before
// `coach-dashboard/01`.
//
// **No per-section error boundary, deliberately.** The session IS this
// screen's only content, so its failure is the page's (`screen-composition`
// §3: only primary content may fail the whole screen).
//
// **Read-only, with no edit affordance of any kind.** The client owns
// editing their own logged data (`phase-09-workout-logger/set-entry/05`);
// the coach owns saying something about it, and that control is
// `session-review/02`'s.

export const SESSION_REVIEW_SCREEN_COPY = {
  /** True of an assigned session, an ad-hoc one, and a session that failed to load. */
  fallbackTitle: 'Workout',
  errorTitle: "We couldn't load this session",
  errorBody: 'Check your connection and try again. Nothing your client logged is affected.',
  errorAction: 'Try again',
  notFoundTitle: "We couldn't find that session",
  notFoundBody: 'It may have been deleted, or the link is out of date.',
  notFoundAction: 'Back to client',
  emptyTitle: 'No sets logged',
  emptyBody: 'This session was opened but nothing was recorded.',
  /** The bottom of a bounded list. A fact, so a coach knows they reached it. */
  end: 'End of session',
  loading: "Loading this session's sets",
} as const;

const STATE_GLYPH_SIZE = 38;
const STATE_BODY_MAX_WIDTH = 280;

export interface SessionReviewScreenProps {
  sessionId: string;
  /**
   * The one way out. A `fullScreenModal` DISMISSES rather than pops, so the
   * route resolves this to `dismiss`, never `back` — and it is passed in
   * rather than read here, because a screen does not own where it leads
   * (`CLAUDE.md` §9.2).
   */
  onClose: () => void;
  /**
   * **`session-review/02`'s seam**, handed straight to every exercise
   * group. Omitted, the screen supplies its own — {@link useSessionCommentSlot}
   * — so the affordance is on every row without a caller having to know
   * about it; the prop stays for a test or a gallery that wants a different
   * occupant.
   */
  renderCommentSlot?: (set: SessionReviewSet) => ReactNode;
}

export function SessionReviewScreen({
  sessionId,
  onClose,
  renderCommentSlot,
}: SessionReviewScreenProps) {
  const screen = useScreenStyle();
  const unit = useWeightUnit();
  const review = useSessionReview(sessionId);
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws outside a provider — this screen renders bare in its own tests.
  const insets = useContext(SafeAreaInsetsContext);

  const session = review.data ?? null;
  const commentSlot = useSessionCommentSlot(session, unit);

  return (
    <View
      style={[
        styles.screen,
        screen,
        { paddingTop: insets?.top ?? 0, paddingBottom: insets?.bottom ?? 0 },
      ]}
    >
      <SessionReviewHeader
        title={
          review.isPending ? null : (session?.name ?? SESSION_REVIEW_SCREEN_COPY.fallbackTitle)
        }
        subtitle={session === null ? null : sessionSubtitle(session)}
        // The read landing IS the write landing: `session.review` sets
        // `reviewed_at` as a side effect of returning (decision (a)). There
        // is nothing else to ask, and nothing to press.
        isReviewed={session !== null}
        onClose={onClose}
      />

      {/* Always this shape: the header clips the body at a hard edge and the
          body owns the whole remaining box in every state, so nothing shifts
          when the read lands (`screen-composition` §4). */}
      <View style={styles.body}>
        {review.isPending ? (
          <SessionReviewSkeleton />
        ) : review.isError ? (
          <ReviewFailure
            error={review.error}
            onClose={onClose}
            onRetry={() => {
              void review.refetch();
            }}
          />
        ) : (
          <SessionBody
            session={review.data}
            unit={unit}
            renderCommentSlot={renderCommentSlot ?? commentSlot}
          />
        )}
      </View>
    </View>
  );
}

/**
 * `Priya Sharma · logged Wed 9 Sep`.
 *
 * The name is the session's own `clientName` — `users.name`, the column
 * `v_client_overview.name` itself projects (server decision (e)), so this
 * header, the dashboard row and the client-detail shell name one person
 * identically. It arrives WITH the session, so there is no deep-link case
 * where the sub-line degrades to a date alone and no second query to wait
 * on for one string.
 *
 * The verb is the one that is true: a session with sets was **logged**, a
 * session that recorded nothing was **opened**, and a session the client
 * skipped was **skipped**. Saying "logged" over an empty session would be
 * the screen's own claim rather than the client's (`COPY.md` CO§2).
 *
 * The date is `scheduled_date`, the CLIENT's local training day, formatted
 * in UTC — reading a `date` column in the coach's device zone renders 9
 * September as the 8th for a coach west of UTC, which is the single most
 * common date bug in this product (`CLAUDE.md` §25.5).
 */
export function sessionSubtitle(session: SessionReview): string {
  const verb =
    session.status === 'skipped' ? 'skipped' : countSets(session) > 0 ? 'logged' : 'opened';
  return `${session.clientName} · ${verb} ${formatSessionDate(session.scheduledDate)}`;
}

/**
 * `Wed 9 Sep · 6:12 pm IST` — the day the client trained, and the time of
 * day it was **for them**.
 *
 * Two fields, and neither derives the other:
 *
 * The DAY is `scheduledDate`, already the client's local `yyyy-MM-dd`
 * (DB§5.3). Re-deriving it from `startedAt` would move a session logged at
 * 00:30 onto the previous day — `CLAUDE.md` §25.5's exact trap, and the
 * reason the column exists at all.
 *
 * The TIME is `startedAt`, a UTC instant, rendered in `clientTimezone` and
 * never in this device's zone. The screen shipped without it precisely
 * because the payload carried no zone: a coach in Mumbai reading a client
 * in Toronto would have seen a 7am session as 5:30pm, and been wrong about
 * the one fact the line is for. The server now returns the zone raw rather
 * than a formatted instant, so the device spells it (server decision (e)).
 *
 * `Intl.DateTimeFormat` and nothing else. The `timeZone` option is built
 * in, and already ships in this bundle twice over — `packages/ui`'s
 * `calendar-grid.ts` calls it directly, and `formatSessionDate` reaches it
 * through date-fns-tz, which is `Intl` underneath. A date library for this
 * would be `CLAUDE.md` §3.4.1 step 2. The zone's NAME comes from the
 * formatter too, so a coach reads whatever their own locale calls it
 * (`IST` on an Indian device, `GMT+5:30` on a US one) and nothing here
 * keeps a table of abbreviations to go stale.
 *
 * A session that was never started renders the day ALONE — there is no
 * separator with nothing after it.
 */
export function formatSessionWhen(
  session: Pick<SessionReview, 'scheduledDate' | 'startedAt' | 'clientTimezone'>,
  locales?: string | string[],
): string {
  const day = formatSessionDate(session.scheduledDate);
  const time =
    session.startedAt === null
      ? null
      : formatZonedTime(session.startedAt, session.clientTimezone, locales);
  return time === null ? day : `${day} · ${time}`;
}

/**
 * `6:12 pm IST` · `18:12 GMT+5:30` — 12- or 24-hour by the READER's locale,
 * because the coach is who is reading it. Only the zone is the client's.
 *
 * `null` rather than a throw on a zone this platform does not know:
 * `users.timezone` is a free-text column with a `'UTC'` default and no IANA
 * check behind it, and `Intl` raises `RangeError` on an unrecognised one.
 * The line then degrades to the day alone — the same shape a session with
 * no `startedAt` renders — instead of taking a whole screen down for a
 * header detail.
 */
function formatZonedTime(
  instant: Date,
  timeZone: string,
  locales?: string | string[],
): string | null {
  try {
    return new Intl.DateTimeFormat(locales, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(instant);
  } catch {
    return null;
  }
}

/**
 * **`session-review/02`'s seam, filled.** One callback that renders the
 * comment affordance for any set in this session.
 *
 * **Stable across renders, and that is the whole reason it is a hook.**
 * `SessionSetRow` is memoised for a 72-set session, and the render-prop
 * shape exists so one callback serves every row instead of each row
 * allocating its own (`frontend-performance` §3). Rebuilding it per render
 * would give that up on the first line.
 *
 * The lookup exists because the seam hands the callback a set and not its
 * group — `session-review/01` fixed that signature and this task uses it
 * rather than widening it. Keyed on `setLogId`, so it is complete by
 * construction.
 */
export function useSessionCommentSlot(
  session: SessionReview | null,
  unit: WeightUnit,
): (set: SessionReviewSet) => ReactNode {
  const exerciseNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of session?.exercises ?? []) {
      if (entry.kind !== 'performed') continue;
      for (const set of entry.sets) names.set(set.setLogId, entry.exerciseName);
    }
    return names;
  }, [session]);

  return useCallback(
    (set: SessionReviewSet) => {
      const exerciseName = exerciseNames.get(set.setLogId);
      // Unreachable: the lookup is built from the same session these rows
      // come from. It fails to the row's own reserved placeholder rather
      // than to "Comment on , set 3", which would be a lie to a screen
      // reader — and the cell holds its 32px either way.
      if (exerciseName === undefined) return null;

      return (
        <CommentAffordance
          targetType="set_log"
          targetId={set.setLogId}
          exerciseName={exerciseName}
          // The row's own vocabulary, not a second one: a warm-up claims no
          // set number, here or in `speakSetRow` (`code-conventions` §1).
          setLabel={set.isWarmup ? SET_FLAG_COPY.warmupSetLabel : `Set ${String(set.setNumber)}`}
          // Formatted by the row's formatter, which reaches `packages/utils`
          // — the sheet never sees a kilogram (`CLAUDE.md` §0).
          load={formatSetLoad(set, unit)}
        />
      );
    },
    [exerciseNames, unit],
  );
}

/** Every set of every performed group. The figures card's denominator, and the empty test. */
export function countSets(session: SessionReview): number {
  return session.exercises.reduce(
    (total, entry) => (entry.kind === 'performed' ? total + entry.sets.length : total),
    0,
  );
}

interface SessionBodyProps {
  session: SessionReview;
  unit: ReturnType<typeof useWeightUnit>;
  renderCommentSlot?: (set: SessionReviewSet) => ReactNode;
}

/**
 * The session itself, top to bottom.
 *
 * `exercises` is ONE already-ordered list — performed groups in the order
 * they were done, each skip interleaved at its prescribed position — so it
 * is rendered in order and never re-sorted, never split into two passes.
 */
function SessionBody({ session, unit, renderCommentSlot }: SessionBodyProps) {
  const setCount = countSets(session);
  const figures = sessionFigures(session, setCount, unit);
  const when = formatSessionWhen(session);

  // Built as a list so the gap between two blocks is decided once, and the
  // first block never carries a top margin no matter which one it is —
  // a bodyweight session has no figures card, and a skipped one starts with
  // the client's reason.
  const blocks: { key: string; gap: number; node: ReactNode }[] = [];

  if (session.skipReason !== null) {
    blocks.push({
      key: 'skip-reason',
      gap: WELL_GAP,
      node: (
        <SessionNoteWell
          label={SESSION_NOTE_COPY.skipped}
          body={session.skipReason}
          testID="session-review-skip-reason"
        />
      ),
    });
  }

  if (figures.length > 0) {
    blocks.push({ key: 'figures', gap: WELL_GAP, node: <SessionFiguresCard figures={figures} /> });
  }

  if (session.clientNotes !== null && session.clientNotes !== '') {
    blocks.push({
      key: 'client-note',
      gap: WELL_GAP,
      node: (
        <SessionNoteWell
          label={SESSION_NOTE_COPY.clientNote}
          body={session.clientNotes}
          testID="session-client-note"
        />
      ),
    });
  }

  session.exercises.forEach((entry, index) => {
    blocks.push({
      key: `entry-${String(index)}`,
      gap: GROUP_GAP,
      node:
        entry.kind === 'performed' ? (
          <SessionExerciseGroup
            group={entry}
            unit={unit}
            {...(renderCommentSlot === undefined ? {} : { renderCommentSlot })}
          />
        ) : (
          <SessionSkippedRow entry={entry} />
        ),
    });
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      testID="session-review-scroll"
    >
      <Text
        size="eyebrow"
        tone="muted"
        style={[styles.when, styles.tabular]}
        // Spoken in its own case, not the line's. The eyebrow is uppercased
        // for the same reason the history row's is, and `WED 9 SEP · 6:12
        // PM IST` is a string a screen reader may spell out letter by
        // letter — so the label carries exactly what is shown, in the case
        // it was written (`accessibility` §2).
        accessibilityLabel={when}
        testID="session-review-when"
      >
        {when.toUpperCase()}
      </Text>

      {blocks.map((block, index) => (
        <View key={block.key} style={index === 0 ? undefined : { marginTop: block.gap }}>
          {block.node}
        </View>
      ))}

      {/* A session that recorded nothing. Its reason, if it has one, is
          already above — repeating "nothing was recorded" under a client's
          explanation would be the screen talking over them. */}
      {setCount === 0 && session.skipReason === null ? <NothingLogged /> : null}

      {setCount > 0 ? (
        <View style={styles.end}>
          <Text size="body-sm" tone="subtle">
            {SESSION_REVIEW_SCREEN_COPY.end}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * A session that was started and recorded nothing.
 *
 * **No action.** The coach's next step is a message, and the client-detail
 * shell owns that control one layer up — a second entry point here would be
 * a second thing to keep in step. That is also why this is not `EmptyState`,
 * whose single `primaryAction` is required by design.
 */
function NothingLogged() {
  const glyph = useStateGlyphColor();

  return (
    <View style={styles.state} testID="session-review-empty">
      <ClipboardList size={STATE_GLYPH_SIZE} color={glyph} strokeWidth={2} />
      <Text size="h2" style={styles.stateTitle}>
        {SESSION_REVIEW_SCREEN_COPY.emptyTitle}
      </Text>
      <Text size="body-sm" tone="muted" style={styles.stateBody}>
        {SESSION_REVIEW_SCREEN_COPY.emptyBody}
      </Text>
    </View>
  );
}

interface ReviewFailureProps {
  error: unknown;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * Two states, not one.
 *
 * `ERRORS.md` ER§2.1 makes a session that is not this coach's return
 * `NOT_FOUND` with `NOT_YOUR_CLIENT` — a real 403 would confirm the session
 * exists and turn id-walking into an enumeration oracle — so a wrong id
 * renders `NotFoundState` and never `ForbiddenState`. A network failure is
 * the same session, unreachable, and its way out is to try again.
 *
 * Close survives both, drawn by the header above this.
 */
function ReviewFailure({ error, onClose, onRetry }: ReviewFailureProps) {
  const glyph = useStateGlyphColor();

  if (getErrorCode(error) === 'NOT_YOUR_CLIENT') {
    return (
      <View style={styles.stateBox}>
        <NotFoundState
          title={SESSION_REVIEW_SCREEN_COPY.notFoundTitle}
          body={SESSION_REVIEW_SCREEN_COPY.notFoundBody}
          onRecover={onClose}
          recoverLabel={SESSION_REVIEW_SCREEN_COPY.notFoundAction}
          density="coach"
          testID="session-review-not-found"
        />
      </View>
    );
  }

  return (
    <View style={styles.stateBox}>
      <EmptyState
        icon={<TriangleAlert size={22} color={glyph} />}
        title={SESSION_REVIEW_SCREEN_COPY.errorTitle}
        body={SESSION_REVIEW_SCREEN_COPY.errorBody}
        primaryAction={{ label: SESSION_REVIEW_SCREEN_COPY.errorAction, onPress: onRetry }}
        density="coach"
        testID="session-review-error"
      />
    </View>
  );
}

/**
 * The real layout, not a spinner (`DESIGN.md` §5, `UI-UX.md` §UX4) — the
 * figures card and four groups of rows, at the boxes they will occupy, so
 * nothing shifts when the session lands.
 *
 * Exactly one skeleton carries the label: a screen made of them is
 * otherwise silent to a screen reader, and twenty labelled shapes would be
 * twenty stops (`accessibility` §2).
 */
function SessionReviewSkeleton() {
  return (
    <View style={styles.content} testID="session-review-loading">
      {/* Wide enough for the day AND the time — the line it stands in for
          is `WED 9 SEP · 6:12 PM IST`, not a date. */}
      <Skeleton
        width={WHEN_SKELETON_WIDTH}
        height={11}
        radius="chip"
        style={styles.when}
        accessibilityLabel={SESSION_REVIEW_SCREEN_COPY.loading}
      />
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonFigures}>
          {SKELETON_FIGURE_WIDTHS.map((width) => (
            <View key={width} style={styles.skeletonCell}>
              <Skeleton width={width / 2} height={11} radius="chip" />
              <Skeleton width={width} height={27} radius="chip" />
            </View>
          ))}
        </View>
      </View>
      {SKELETON_GROUPS.map((rows, index) => (
        <View
          key={rows.join('-')}
          style={index === 0 ? styles.skeletonGroupFirst : styles.skeletonGroup}
        >
          <Skeleton width={172} height={20} radius="chip" />
          <View style={styles.skeletonRows}>
            {rows.map((width, rowIndex) => (
              <View key={`${String(rowIndex)}-${String(width)}`} style={styles.skeletonRow}>
                <Skeleton width={14} height={16} radius="chip" />
                <Skeleton width={width} height={18} radius="chip" />
                <View style={styles.skeletonGap} />
                <Skeleton width={32} height={32} radius="full" />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const WHEN_SKELETON_WIDTH = 172;
/** Uneven on purpose — a column of identical bars reads as a table, not as loading content. */
const SKELETON_FIGURE_WIDTHS = [84, 70, 62];
const SKELETON_GROUPS = [
  [112, 98, 120, 104],
  [96, 108, 92],
  [118, 102, 114],
  [106, 118, 96],
];

const GUTTER = density.coach.gutter;
/** `.well`'s own inset from the block above it. */
const WELL_GAP = spacing(14);
/** `.grp`'s, which is one step larger — a movement is a bigger break than a figure. */
const GROUP_GAP = spacing(16);

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // `flex: 1` with `minHeight: 0`: the header is the `flex: none` sibling
  // above, so the body takes the rest and the content is clipped at the
  // header's lower edge rather than passing behind the glass.
  body: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: GUTTER, paddingTop: spacing(6), paddingBottom: spacing(40) },
  when: { paddingHorizontal: spacing(3), paddingBottom: spacing(10) },
  end: { alignItems: 'center', paddingTop: spacing(16), paddingBottom: spacing(24) },
  tabular: { fontVariant: ['tabular-nums'] },
  state: { alignItems: 'center', paddingTop: spacing(52), paddingHorizontal: spacing(32) },
  stateBox: { flex: 1, justifyContent: 'center', paddingHorizontal: GUTTER },
  stateTitle: { marginTop: spacing(6), textAlign: 'center' },
  stateBody: { marginTop: spacing(8), textAlign: 'center', maxWidth: STATE_BODY_MAX_WIDTH },
  skeletonCard: { gap: spacing(5) },
  skeletonFigures: { flexDirection: 'row', gap: spacing(24), paddingVertical: spacing(16) },
  skeletonCell: { gap: spacing(5) },
  skeletonGroupFirst: { gap: spacing(8) },
  skeletonGroup: { marginTop: GROUP_GAP, gap: spacing(8) },
  skeletonRows: { gap: spacing(12) },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
    minHeight: density.coach.row,
  },
  skeletonGap: { flex: 1 },
});

const useScreenStyle = createThemedValue((t) => ({ backgroundColor: t.colors.bg.DEFAULT }));
const useStateGlyphColor = createThemedValue((t) => t.colors.fg.muted);
