import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  Text,
  createThemedStyles,
  density as densityTokens,
  duration,
  easing,
  radius,
  spacing,
  useReducedMotion,
  useTheme,
} from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/src/routers/index.ts';
import { Stack, useRouter } from 'expo-router';
import { CalendarClock, CircleAlert, Clock } from 'lucide-react-native';
import { useContext, useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useClientTimeZone } from '../../../lib/time-zone/useClientTimeZone.ts';
import {
  coachFirstName,
  NeverSharedNote,
  SharingControls,
  type HistorySharing,
} from '../../onboarding/components/SharingControls.tsx';

// `relationship-controls/03`. Design: `history-sharing.html`, frames A–H.
//
// The screen `account-lifecycle/07` step 6 promised and never built:
// "Settings → 'What {coach} can see' mirrors the acceptance step. Widening
// is instant. Narrowing applies going forward and does not claw back what a
// coach has already read — do not pretend otherwise in the copy."
//
// Presentational, and deliberately so — every read, every write and the
// optimistic rollback live in `../hooks/useHistorySharing.ts`. Four rules
// this file holds:
//
// 1. **A privacy screen that cannot read the current state draws no
//    control.** Loading, a failed read and a coachless client each render
//    the whole screen and none of them render a segmented track: a track
//    with a guessed selection is worse than an error.
// 2. **The never-shared block is in every state.** It is true before the
//    query returns and true after it fails, so it is never a skeleton and
//    never conditional.
// 3. **The forward-only note appears in place and never leaves.** Not a
//    toast — a toast that is missed leaves a client believing something
//    the product never said.
// 4. **One query, so no half-rendered control.** The coach's name and the
//    three stored values arrive together on `clientApp.coach`
//    (`UI-UX.md` §UX8).
//
// Presentation is an ordinary push inside `SettingsStack`, so the native
// header supplies the back gesture and the "Settings" back label. The one
// piece of chrome this screen owns is the title, because it is derived
// from data the layout cannot see.

type CoachQueryOutput = inferRouterOutputs<AppRouter>['clientApp']['coach'];

/** Inferred from the router, never restated (`code-conventions` §3). */
export type SharingCoach = NonNullable<CoachQueryOutput>;

export interface HistorySharingDecision {
  historySharing: HistorySharing;
  shareMetrics: boolean;
  shareNutrition: boolean;
}

/**
 * Every string this screen says. Module constants rather than JSX text so
 * each is one greppable line, ready to extract for localisation
 * (`product-copy` §6).
 *
 * Singular *they* throughout, and `{firstName}` repeated wherever a
 * sentence would otherwise need a pronoun: CoachOS collects no gender, so
 * a "he" here is a guess the product has no basis for.
 */
export const HISTORY_SHARING_COPY = {
  rowLabel: (coachFirst: string) => `What ${coachFirst} can see`,
  rowDescription: 'Training history, body metrics, and nutrition',
  rowHint: 'Opens your sharing settings',
  /** Never blank, and never a name that then changes. */
  titleFallback: 'What your coach can see',
  lead: (coachFirst: string) =>
    `${coachFirst} can always see what you log from today on. This is what they can see from before you joined them.`,
  truth: {
    nothing: (coachFirst: string) => `${coachFirst} can see your training from today on.`,
    twelve_weeks: (coachFirst: string, date: string) =>
      `${coachFirst} can see your training from ${date}.`,
    everything: (coachFirst: string) => `${coachFirst} can see all your training history.`,
  },
  /**
   * **Tested on the rendered text**, which makes it a contract rather than
   * copy: `account-lifecycle/07` made the forward-only rule and this is the
   * sentence that keeps it.
   */
  forwardOnly: (coachFirst: string) =>
    `This applies from now on. It does not undo what ${coachFirst} has already seen.`,
  writeFailed: (coachFirst: string) =>
    `We couldn’t save that change. Nothing has changed for ${coachFirst}.`,
  tryAgain: 'Try again',
  readFailedTitle: 'We couldn’t load your sharing settings.',
  readFailedBody: 'Check your connection and try again. Nothing has changed.',
  loadingLabel: 'Loading your sharing settings',
  noCoachTitle: 'You’re not working with a coach right now.',
  noCoachBody: 'There is nothing to share. Your history stays yours either way.',
  noCoachAction: 'Back to settings',
} as const;

/** Least → most, the same order the control offers them in. */
const HISTORY_WIDTH: Record<HistorySharing, number> = {
  nothing: 0,
  twelve_weeks: 1,
  everything: 2,
};

/**
 * Whether a write takes something away — a shorter training window, or
 * either toggle turned off. The one thing the forward-only note is
 * conditioned on, and a pure function so it can be tested without a
 * screen.
 *
 * `null` is "no earlier decision to compare against", which is never a
 * narrowing: a client who has made no decision has taken nothing back.
 */
export function isNarrowingDecision(
  before: HistorySharingDecision | null,
  after: HistorySharingDecision,
): boolean {
  if (before === null) return false;
  if (HISTORY_WIDTH[after.historySharing] < HISTORY_WIDTH[before.historySharing]) return true;
  if (before.shareMetrics && !after.shareMetrics) return true;
  if (before.shareNutrition && !after.shareNutrition) return true;
  return false;
}

/** `applySharingDecision` stores `null` for off, so this is exact. */
export function decisionOf(coach: SharingCoach): HistorySharingDecision | null {
  if (coach.historySharingChoice === null) return null;
  return {
    historySharing: coach.historySharingChoice,
    shareMetrics: coach.metricsSharedFrom !== null,
    shareNutrition: coach.nutritionSharedFrom !== null,
  };
}

export interface HistorySharingScreenProps {
  /** `undefined` = not answered yet · `null` = coachless, a race the row is gated against. */
  coach: SharingCoach | null | undefined;
  isLoading: boolean;
  /**
   * The DISCRIMINATOR for "the read failed", never rendered: a raw cause
   * is not shown to a user (`security-and-privacy` §7), and a failed read
   * is not the same state as a coachless client. The hook passes the
   * catalogued code so the distinction is greppable in a bug report.
   */
  loadError?: string | undefined;
  onRetryLoad: () => void;
  /** The WHOLE decision on every write: `updateHistorySharingInput` is a `strictObject` with no defaults, exactly as at acceptance. */
  onChange: (decision: HistorySharingDecision) => void;
  /** True from the first narrowing write of the visit, and it never resets. */
  didNarrow: boolean;
  writeError?: string | undefined;
  onRetryWrite: () => void;
}

export function HistorySharingScreen({
  coach,
  isLoading,
  loadError,
  onRetryLoad,
  onChange,
  didNarrow,
  writeError,
  onRetryWrite,
}: HistorySharingScreenProps) {
  // Read from the context rather than through `useSafeAreaInsets()`, which
  // throws outside a provider — this screen renders bare in its own tests
  // and in `route-tree.test.tsx` (same reasoning as `SessionReviewScreen`).
  const insets = useContext(SafeAreaInsetsContext);
  const timeZone = useClientTimeZone();
  const router = useRouter();
  const gutter = densityTokens.client.gutter;

  const coachFirst = coach ? coachFirstName(coach.name) : null;
  const decision = coach ? decisionOf(coach) : null;

  return (
    <>
      {/* The only chrome this screen owns. `SettingsStack` supplies the
          rest, including the "Settings" back label, which React Navigation
          derives from the previous screen's title. */}
      <Stack.Screen
        options={{
          title:
            coachFirst === null ? HISTORY_SHARING_COPY.titleFallback : `What ${coachFirst} can see`,
        }}
      />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: gutter,
            paddingTop: gutter,
            paddingBottom: (insets?.bottom ?? 0) + gutter,
            gap: densityTokens.client.sectionGap,
          },
        ]}
        showsVerticalScrollIndicator={false}
        testID="history-sharing-screen"
      >
        {coach && coachFirst !== null ? (
          <Controls
            coachFirst={coachFirst}
            decision={decision}
            historySharedFrom={coach.historySharedFrom}
            timeZone={timeZone}
            onChange={onChange}
            didNarrow={didNarrow}
            writeError={writeError}
            onRetryWrite={onRetryWrite}
          />
        ) : isLoading ? (
          <LoadingState shape="detail" accessibilityLabel={HISTORY_SHARING_COPY.loadingLabel} />
        ) : coach === null ? (
          // `CLIENT_HAS_NO_COACH` (`ERRORS.md` ER§1.1). Reachable only as a
          // race — the row that opens this screen is gated on having a
          // coach — so it is a state, not a screen to design around.
          <EmptyState
            title={HISTORY_SHARING_COPY.noCoachTitle}
            body={HISTORY_SHARING_COPY.noCoachBody}
            primaryAction={{
              label: HISTORY_SHARING_COPY.noCoachAction,
              onPress: () => router.back(),
            }}
            density="client"
            testID="sharing-no-coach"
          />
        ) : (
          <ReadFailed onRetry={onRetryLoad} />
        )}

        {/* The `flex:1` spacer is what stops the block below reading as
            fine print: on a short screen it sits on the floor rather than
            trailing the toggles. At 200% the content is taller than the
            frame, the spacer collapses to its minimum, and everything
            scrolls. */}
        <View style={styles.spacer} />

        <NeverSharedNote />
      </ScrollView>
    </>
  );
}

function Controls({
  coachFirst,
  decision,
  historySharedFrom,
  timeZone,
  onChange,
  didNarrow,
  writeError,
  onRetryWrite,
}: {
  coachFirst: string;
  decision: HistorySharingDecision | null;
  historySharedFrom: Date | null;
  timeZone: string;
  onChange: (decision: HistorySharingDecision) => void;
  didNarrow: boolean;
  writeError: string | undefined;
  onRetryWrite: () => void;
}) {
  // Absent a stored choice there is nothing to widen or narrow FROM, so
  // the toggles still read true/false off their own timestamps and the
  // segment reads null. A write from here sends all three fields anyway.
  const current: HistorySharingDecision = decision ?? {
    historySharing: 'twelve_weeks',
    shareMetrics: false,
    shareNutrition: false,
  };

  return (
    <View style={styles.block}>
      <Text size="body-lg" tone="muted">
        {HISTORY_SHARING_COPY.lead(coachFirst)}
      </Text>

      <SharingControls
        coachFirstName={coachFirst}
        historySharing={decision === null ? null : decision.historySharing}
        onHistorySharingChange={(historySharing) => onChange({ ...current, historySharing })}
        shareMetrics={current.shareMetrics}
        onShareMetricsChange={(shareMetrics) => onChange({ ...current, shareMetrics })}
        shareNutrition={current.shareNutrition}
        onShareNutritionChange={(shareNutrition) => onChange({ ...current, shareNutrition })}
        historyFooter={
          <>
            {decision === null ? null : (
              <TruthLine
                coachFirst={coachFirst}
                historySharing={decision.historySharing}
                historySharedFrom={historySharedFrom}
                timeZone={timeZone}
              />
            )}
            {writeError === undefined ? null : (
              <WriteFailed coachFirst={coachFirst} onRetry={onRetryWrite} />
            )}
            {didNarrow ? <ForwardOnlyNote coachFirst={coachFirst} /> : null}
          </>
        }
      />
    </View>
  );
}

/**
 * The one thing on this screen that is READ rather than chosen: the
 * resolved value of `history_shared_from`, in the client's own timezone.
 * **No motion** — an animating fact reads as less settled than a changed
 * one.
 */
function TruthLine({
  coachFirst,
  historySharing,
  historySharedFrom,
  timeZone,
}: {
  coachFirst: string;
  historySharing: HistorySharing;
  historySharedFrom: Date | null;
  timeZone: string;
}) {
  const theme = useTheme();

  // Absolute, never relative: twelve weeks is always beyond the week where
  // `product-copy` §6 allows "Tuesday".
  const sentence =
    historySharing === 'everything'
      ? HISTORY_SHARING_COPY.truth.everything(coachFirst)
      : historySharing === 'nothing' || historySharedFrom === null
        ? HISTORY_SHARING_COPY.truth.nothing(coachFirst)
        : HISTORY_SHARING_COPY.truth.twelve_weeks(
            coachFirst,
            formatLocalDate(historySharedFrom, timeZone, 'd MMMM'),
          );

  return (
    <View style={styles.truthLine} accessible testID="sharing-truth-line">
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <CalendarClock size={14} color={theme.colors.fg.muted} />
      </View>
      <Text size="body-sm" tone="muted" style={styles.flexText}>
        {sentence}
      </Text>
    </View>
  );
}

/**
 * The honest half of a narrowing write, and the screen's only L3 tinted
 * surface — because it is the one transient thing that has to be read.
 *
 * Deliberately **not** urgent-coloured: nothing has gone wrong, and
 * painting a correct, deliberate choice red reads as a warning against
 * making it.
 *
 * One element carrying both sentences, `polite` so it is announced after
 * the control the client just used rather than interrupting it. It
 * animates IN and never out.
 */
function ForwardOnlyNote({ coachFirst }: { coachFirst: string }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const entered = useSharedValue(0);

  useEffect(() => {
    entered.value = withTiming(1, { duration: duration.enter, easing: RISE_EASING });
    // `entered` is a Reanimated shared value: stable identity, not a
    // reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One driver, two properties. Under reduced motion the transform drops
  // out and the cross-fade stays — the state change itself is never
  // optional, only its movement is (`accessibility` §6).
  const enterStyle = useAnimatedStyle(() => ({
    opacity: entered.value,
    transform: reducedMotion ? [] : [{ translateY: (1 - entered.value) * ENTER_TRANSLATE_Y }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <Card elevation="tinted" padded={false}>
        <View
          style={styles.note}
          accessible
          accessibilityLiveRegion="polite"
          testID="sharing-forward-only"
        >
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Clock size={16} color={theme.colors.fg.warm} />
          </View>
          <Text size="body-sm" tone="warm" style={styles.flexText}>
            {HISTORY_SHARING_COPY.forwardOnly(coachFirst)}
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * The optimistic value has already rolled back; this says what that means.
 * The second sentence is the one that matters on a privacy surface — a
 * client who believes they narrowed something they did not is worse off
 * than one who saw an error.
 */
function WriteFailed({ coachFirst, onRetry }: { coachFirst: string; onRetry: () => void }) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={themed.errorBlock} accessibilityRole="alert" testID="sharing-write-error">
      <View style={styles.errorHeading}>
        {/* `fg.warm` and a `border.strong` hairline, NOT `urgent-text`.
            The design draws this block with a rose border and glyph, and
            that is the one thing this screen does not copy: the warmth ramp
            is reserved for adherence state and may never be decorative
            (`ui-conventions` §2, enforced by `theme/adherence-colors-only`).
            The sentence beside it carries the whole meaning in words and
            takes the entitled `tone="urgent"` — same resolution
            `PendingDeletionScreen` reached against the same prototype. */}
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <CircleAlert size={16} color={theme.colors.fg.warm} />
        </View>
        <Text size="body-sm" tone="urgent" style={styles.flexText}>
          {HISTORY_SHARING_COPY.writeFailed(coachFirst)}
        </Text>
      </View>
      <View style={styles.errorAction}>
        <Button variant="secondary" size="sm" onPress={onRetry}>
          {HISTORY_SHARING_COPY.tryAgain}
        </Button>
      </View>
    </View>
  );
}

/** No control is drawn: a segmented track with a guessed selection on a privacy screen is worse than an error. */
function ReadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.block} testID="sharing-read-error">
      <View style={styles.readFailedCopy} accessibilityRole="alert">
        <Text size="h2">{HISTORY_SHARING_COPY.readFailedTitle}</Text>
        <Text size="body-lg" tone="muted">
          {HISTORY_SHARING_COPY.readFailedBody}
        </Text>
      </View>
      <View style={styles.errorAction}>
        <Button
          variant="secondary"
          onPress={onRetry}
          accessibilityLabel={HISTORY_SHARING_COPY.tryAgain}
        >
          {HISTORY_SHARING_COPY.tryAgain}
        </Button>
      </View>
    </View>
  );
}

/** `duration.enter` + `easing.rise`: opacity 0→1 plus a 6px lift, never a slide. */
const ENTER_TRANSLATE_Y = 6;
const RISE_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);

// Scheme-invariant geometry at module scope; every colour comes through
// `Text`'s tone, `Card`'s elevation, or `useTheme()`.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  // `flexGrow`, so the spacer below has room to spend on a short screen and
  // collapses to nothing once the content outgrows the frame.
  content: { flexGrow: 1 },
  block: { gap: spacing(18) },
  spacer: { flexGrow: 1, minHeight: spacing(20) },
  truthLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(8) },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(10), padding: spacing(14) },
  flexText: { flex: 1 },
  errorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(10) },
  errorAction: { alignSelf: 'flex-start' },
  readFailedCopy: { gap: spacing(6) },
});

const useThemedStyles = createThemedStyles((theme) => ({
  errorBlock: {
    gap: spacing(11),
    padding: spacing(13),
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.strong,
  },
}));
