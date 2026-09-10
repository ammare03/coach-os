import { Button, GlassSurface, Metric, Skeleton, Text } from '@coachos/ui';
import {
  createThemedStyles,
  duration as durationTokens,
  easing,
  radius,
  spacing,
  useReducedMotion,
  useTheme,
  withAlpha,
} from '@coachos/ui/theme';
import { formatLocalDate, formatWeight, type WeightUnit } from '@coachos/utils';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Check } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type {
  TodaySessionPhase,
  TodaySessionState,
  TodaySessionSummary,
} from '../hooks/useTodaySession.ts';

import { ExercisePill } from './ExercisePill.tsx';
import { TodayCardArt } from './TodayCardArt.tsx';
import { TodayCardError } from './TodayCardError.tsx';

// The Today hero (`today-card/DESIGN-SPEC.md` §1–§4). One shape, five
// slots — state chip → name → context line → state graphic → primary
// action — filled differently per state and never restructured.
//
// This task builds frames `A` (scheduled), `B` (in progress), `C`
// (completed), `F` (loading) and `G` (error). Frames `D` (rest day) and `E`
// (no program) belong to `today-card/03` and render nothing here; see the
// switch at the bottom.
//
// Two rules the primitive cannot enforce and this file must not break
// (`DESIGN.md` §4): never nest a `GlassSurface` inside this one, and never
// put a chart on it. The progress bar in frame `B` is a state graphic, not
// a chart — it has no axis and no domain.

export interface TodayCardProps {
  state: TodaySessionState;
  /** Display only. Every weight reaching this component is already kilograms. */
  weightUnit: WeightUnit;
  /** The client's own zone — "Finished at 6:12 pm" is a local wall clock, not the device's. */
  timeZone: string;
  /** Injectable so "started 18 min ago" is testable. */
  now?: Date | undefined;
  onOpenSession: (localId: string) => void;
  onViewSummary: (localId: string) => void;
  /** Fired on press-in so the logger's data is warm before navigation (`UI-UX.md` §UX3.3). */
  onPrefetchSession?: ((localId: string) => void) | undefined;
  onRetry: () => void;
  /**
   * `today-card/04` owns the ad-hoc flow. Until it lands the completed
   * card's secondary action is absent rather than inert — a button that
   * does nothing is worse than one that is not there.
   */
  onStartAdHoc?: (() => void) | undefined;
}

// §2.2. `duration.enter` (300ms) for the card, and `easing.rise` — the
// curve §5 gives anything that enters by rising.
const ENTER_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const FILL_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/**
 * §2.2's specular sheen: a 70px strip crossing the card every 5.5s after a
 * 1.2s beat.
 *
 * 5500ms and 1800ms (the chip's pulse, below) are **not** on §5's five-step
 * duration ladder, and that is a recorded deviation rather than an
 * oversight: §4 states both literally for the glass material itself, and
 * DESIGN-SPEC §2.2 restates them for this card. §5's ladder governs UI
 * motion — a press, a state change, an entrance — and the material's own
 * ambient behaviour is neither. Both are off entirely under Reduce Motion.
 */
const SHEEN_WIDTH = 70;
const SHEEN_DURATION_MS = 5500;
const SHEEN_DELAY_MS = 1200;

/** §3.2's `pulsedot`. The only pulsing element on this screen. */
const PULSE_DURATION_MS = 1800;
const PULSE_MIN_OPACITY = 0.3;

/** §2.3 — the graphic column clears the isometric art at 250px. */
const GRAPHIC_MAX_WIDTH = 250;

/** §2.3's determinate bar. `spacing(6)` is the same 6 the token scale carries. */
const BAR_HEIGHT = spacing(6);

export function TodayCard({
  state,
  weightUnit,
  timeZone,
  now,
  onOpenSession,
  onViewSummary,
  onPrefetchSession,
  onRetry,
  onStartAdHoc,
}: TodayCardProps) {
  switch (state.kind) {
    case 'loading':
      // §3.6's 250ms gate is decided in `useTodaySession`; below it the
      // stage renders nothing, because a skeleton that flashes for one
      // frame is a flicker rather than feedback.
      return state.showSkeleton ? <HeroSkeleton /> : null;

    case 'error':
      return <TodayCardError onRetry={onRetry} />;

    case 'session':
      return (
        <SessionHero
          session={state.session}
          phase={state.phase}
          weightUnit={weightUnit}
          timeZone={timeZone}
          now={now ?? new Date()}
          onOpenSession={onOpenSession}
          onViewSummary={onViewSummary}
          onPrefetchSession={onPrefetchSession}
          onStartAdHoc={onStartAdHoc}
        />
      );

    case 'rest-day':
    case 'no-program':
      // Frames `D` and `E` are built by `today-card/03`, in the next commit.
      return null;
  }
}

// ── The hero ────────────────────────────────────────────────────────────

interface SessionHeroProps {
  session: TodaySessionSummary;
  phase: TodaySessionPhase;
  weightUnit: WeightUnit;
  timeZone: string;
  now: Date;
  onOpenSession: (localId: string) => void;
  onViewSummary: (localId: string) => void;
  onPrefetchSession?: ((localId: string) => void) | undefined;
  onStartAdHoc?: (() => void) | undefined;
}

function SessionHero({
  session,
  phase,
  weightUnit,
  timeZone,
  now,
  onOpenSession,
  onViewSummary,
  onPrefetchSession,
  onStartAdHoc,
}: SessionHeroProps) {
  const name = session.name ?? 'Today’s session';
  const contextLine = describeContext(session, phase, timeZone, now);
  const chipLabel = CHIP_LABEL[phase.phase];

  return (
    <HeroSurface>
      {/* §3.3 drops the art on a finished session: a loaded bar after the
          work is done is a meaning the text contradicts (§6). */}
      {phase.phase === 'completed' ? null : <TodayCardArt />}

      {/* One accessible element for the description, so a screen reader
          reads "Scheduled today. Upper A. 6 exercises, about 55 minutes."
          rather than six fragments (§4). The actions stay separate, because
          the completed card offers two of them and a single collapsed
          element could expose only one. */}
      <View
        accessible
        accessibilityLabel={[chipLabel, name, contextLine].filter(Boolean).join('. ')}
        style={styles.inner}
      >
        <StateChip label={chipLabel} phase={phase.phase} />
        {/* No `numberOfLines` anywhere below: at 200% text the card grows
            (`accessibility` §3). */}
        <Text size="stat" tone="bright" style={styles.name}>
          {name}
        </Text>
        {contextLine ? (
          // A sentence carrying three figures. Tabular numerals are applied
          // to the line itself; `Metric` is for a standalone figure and
          // would break the sentence into boxes.
          <Text size="body" tone="warm-muted" style={styles.contextLine}>
            {contextLine}
          </Text>
        ) : null}
        <StateGraphic session={session} phase={phase} weightUnit={weightUnit} />
      </View>

      <View style={styles.actions}>
        {phase.phase === 'completed' ? (
          <>
            <Button
              variant="primary"
              size="md"
              density="client"
              fullWidth
              onPress={() => onViewSummary(session.localId)}
            >
              View summary
            </Button>
            {onStartAdHoc ? (
              <Button
                variant="secondary"
                size="md"
                density="client"
                fullWidth
                onPress={onStartAdHoc}
              >
                Log another workout
              </Button>
            ) : null}
          </>
        ) : (
          <PrimarySessionAction
            label={phase.phase === 'in-progress' ? 'Continue' : 'Start workout'}
            localId={session.localId}
            onPress={onOpenSession}
            onPressIn={onPrefetchSession}
          />
        )}
      </View>
    </HeroSurface>
  );
}

function PrimarySessionAction({
  label,
  localId,
  onPress,
  onPressIn,
}: {
  label: string;
  localId: string;
  onPress: (localId: string) => void;
  onPressIn?: ((localId: string) => void) | undefined;
}) {
  const { colors } = useTheme();
  // `Button` forwards no `onPressIn`, so the press-in prefetch is hung on a
  // wrapper rather than by widening a shared primitive for one consumer
  // (`code-conventions` §1).
  return (
    <View onTouchStart={onPressIn ? () => onPressIn(localId) : undefined}>
      <Button
        variant="primary"
        size="md"
        density="client"
        fullWidth
        onPress={() => onPress(localId)}
        iconRight={<ArrowRight size={17} color={colors.fg.onBrand} strokeWidth={2.2} />}
      >
        {label}
      </Button>
    </View>
  );
}

// ── Surface, sheen, entrance ────────────────────────────────────────────

function HeroSurface({ children }: { children: ReactNode }) {
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();
  const enter = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, { duration: durationTokens.enter, easing: ENTER_EASING });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: 10 * (1 - enter.value) }],
  }));

  return (
    <Animated.View style={enterStyle}>
      <GlassSurface tier="tier2" style={themed.surface} testID="today-card">
        <Sheen />
        {children}
      </GlassSurface>
    </Animated.View>
  );
}

/**
 * `GlassSurface` clips only its own material, not its children (its own
 * doc comment), so the strip is clipped by this wrapper rather than by the
 * surface. `pointerEvents="none"` keeps it out of the way of the button
 * underneath it.
 */
function Sheen() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(-SHEEN_WIDTH);

  const animating = !reducedMotion && width > 0;

  useEffect(() => {
    if (!animating) return;
    x.value = -SHEEN_WIDTH;
    x.value = withDelay(
      SHEEN_DELAY_MS,
      withRepeat(
        withTiming(width, { duration: SHEEN_DURATION_MS, easing: FILL_EASING }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, width]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (reducedMotion) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.sheenClip}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.sheenStrip, style]}>
        <LinearGradient
          colors={[withAlpha(colors.fg.bright, '0.15'), withAlpha(colors.fg.bright, '0')]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

// ── Chip ────────────────────────────────────────────────────────────────

const CHIP_LABEL: Record<TodaySessionPhase['phase'], string> = {
  scheduled: 'Scheduled today',
  'in-progress': 'In progress',
  completed: 'Completed today',
};

/**
 * §4 — the state never rides on hue. Every chip carries a second,
 * non-colour channel (filled dot / pulsing dot / check glyph) and the label
 * is always present as the third. All three use the brand ramp: §2.4 is
 * explicit that the prototype's urgent-red "scheduled" chip is not ported,
 * because `DESIGN.md` §8 reserves that hue for missed, overdue, and
 * destructive, and a red chip on the client's home screen is `COPY.md`
 * CO§2's loss framing rendered in colour.
 */
function StateChip({ label, phase }: { label: string; phase: TodaySessionPhase['phase'] }) {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <View style={themed.chip}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {phase === 'completed' ? (
          <Check size={12} color={colors.brand.DEFAULT} strokeWidth={3} />
        ) : (
          <StateDot pulsing={phase === 'in-progress'} />
        )}
      </View>
      {/* The only uppercase text on the screen (`DESIGN.md` §1.2: never
          uppercase anything but the eyebrow). The string itself stays
          sentence case, so the accessible label reads normally. */}
      <Text size="eyebrow" tone="warm" className="uppercase">
        {label}
      </Text>
    </View>
  );
}

function StateDot({ pulsing }: { pulsing: boolean }) {
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!pulsing || reducedMotion) {
      // Under Reduce Motion the dot holds at full opacity — the state is
      // never removed, only the movement (`accessibility` §6).
      opacity.value = 1;
      return;
    }
    opacity.value = PULSE_MIN_OPACITY;
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_DURATION_MS / 2, easing: FILL_EASING }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulsing, reducedMotion]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[themed.dot, style]} />;
}

// ── State graphic ───────────────────────────────────────────────────────

function StateGraphic({
  session,
  phase,
  weightUnit,
}: {
  session: TodaySessionSummary;
  phase: TodaySessionPhase;
  weightUnit: WeightUnit;
}) {
  if (phase.phase === 'scheduled') {
    if (session.previewExerciseNames.length === 0) return null;
    return (
      <View style={styles.pills}>
        {session.previewExerciseNames.map((exerciseName) => (
          <ExercisePill key={exerciseName} label={exerciseName} />
        ))}
        {session.remainingExerciseCount > 0 ? (
          <ExercisePill label={`+${String(session.remainingExerciseCount)} more`} muted />
        ) : null}
      </View>
    );
  }

  if (phase.phase === 'in-progress') {
    return <ProgressBar logged={phase.setsLogged} target={session.targetSets} />;
  }

  return (
    <View style={styles.metrics}>
      <MetricCell
        label="Sets"
        value={`${String(phase.setsLogged)} of ${String(session.targetSets)}`}
      />
      {phase.volumeKg === null ? null : (
        <MetricCell
          label="Volume"
          value={formatWeight(phase.volumeKg, weightUnit)}
          unit={weightUnit}
        />
      )}
      {phase.durationSeconds === null ? null : (
        <MetricCell label="Time" value={`${String(Math.round(phase.durationSeconds / 60))} min`} />
      )}
    </View>
  );
}

function MetricCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.metricCell}>
      <Text size="eyebrow" tone="warm-muted" className="uppercase">
        {label}
      </Text>
      {/* Every standalone figure goes through `Metric` — Space Grotesk and
          tabular numerals, with no prop to turn either off. */}
      <Metric value={value} size="h2" tone="bright" {...(unit ? { unit } : {})} />
    </View>
  );
}

/**
 * A determinate 6px bar, filled to `logged / target`. It is a state
 * graphic and not a chart — no axis, no domain — so §4's "never a chart on
 * glass" is not in play.
 */
function ProgressBar({ logged, target }: { logged: number; target: number }) {
  const themed = useThemedStyles();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const ratio = target > 0 ? Math.min(1, Math.max(0, logged / target)) : 0;
  const grow = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      grow.value = 1;
      return;
    }
    grow.value = withTiming(1, { duration: durationTokens.reveal, easing: FILL_EASING });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, ratio]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));
  const fillWidth: DimensionValue = `${ratio * 100}%`;

  return (
    <View
      style={themed.track}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.fillOrigin, { width: fillWidth }, fillStyle]}>
        <LinearGradient
          colors={[colors.brand.mid, colors.brand.DEFAULT]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fill}
        />
      </Animated.View>
    </View>
  );
}

// ── Loading (frame `F`) ─────────────────────────────────────────────────

/**
 * The hero's own boxes, inside the same `GlassSurface`, so nothing shifts
 * when the data lands. Exactly one shape carries a label — the region reads
 * as one busy item, never as six (`accessibility` §2).
 */
function HeroSkeleton() {
  const themed = useThemedStyles();

  return (
    <GlassSurface tier="tier2" style={themed.surface} testID="today-card-skeleton">
      <View style={styles.inner}>
        <Skeleton
          width={132}
          height={26}
          radius="full"
          accessibilityLabel="Loading today's session"
        />
        <Skeleton width={158} height={30} radius="chip" style={styles.skeletonName} />
        <Skeleton width={206} height={18} radius="chip" style={styles.skeletonContext} />
        <View style={styles.pills}>
          <Skeleton width={92} height={27} radius="control" />
          <Skeleton width={86} height={27} radius="control" />
          <Skeleton width={106} height={27} radius="control" />
        </View>
      </View>
      <View style={styles.actions}>
        <Skeleton height={52} radius="full" />
      </View>
    </GlassSurface>
  );
}

// ── Copy ────────────────────────────────────────────────────────────────

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The context line for each phase. Facts only — counts, an approximate
 * duration, a wall-clock time. Never praise, never a percentage, never a
 * judgement (`COPY.md` CO§2, DESIGN-SPEC §3.3).
 *
 * Segments that cannot be computed are OMITTED, never rendered as a dash:
 * `~— min` is the failure §3.1 names.
 */
export function describeContext(
  session: TodaySessionSummary,
  phase: TodaySessionPhase,
  timeZone: string,
  now: Date,
): string {
  if (phase.phase === 'completed') {
    return `Finished at ${formatLocalDate(phase.completedAt, timeZone, 'h:mm aaa')}`;
  }

  if (phase.phase === 'in-progress') {
    return [
      `Set ${String(phase.setsLogged)} of ${String(session.targetSets)}`,
      `started ${formatElapsed(phase.startedAt, now)}`,
    ].join(' · ');
  }

  const segments = [plural(session.exerciseCount, 'exercise', 'exercises')];
  if (session.estimatedMinutes !== null) {
    // The `~` is load-bearing: the estimate is a population average, not a
    // promise about this client's pace.
    segments.push(`~${String(session.estimatedMinutes)} min`);
  }
  if (session.targetSets > 0) segments.push(plural(session.targetSets, 'set', 'sets'));
  return segments.join(' · ');
}

/** "18 min ago" / "2 h ago". Clamped at one minute — "0 min ago" reads as broken. */
function formatElapsed(startedAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - startedAt.getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min ago`;
  return `${String(Math.floor(minutes / 60))} h ago`;
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  inner: {
    // The art bleeds under the content, so the content needs its own
    // stacking context (§3.1).
    position: 'relative',
  },
  name: {
    marginTop: spacing(12),
  },
  contextLine: {
    marginTop: spacing(3),
    fontVariant: ['tabular-nums'],
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(6),
    marginTop: spacing(16),
    maxWidth: GRAPHIC_MAX_WIDTH,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(18),
    marginTop: spacing(18),
  },
  metricCell: {
    gap: spacing(3),
  },
  actions: {
    marginTop: spacing(20),
    gap: spacing(10),
  },
  sheenClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.section,
    overflow: 'hidden',
  },
  sheenStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SHEEN_WIDTH,
  },
  fillOrigin: {
    height: BAR_HEIGHT,
    transformOrigin: 'left',
  },
  fill: {
    flex: 1,
    borderRadius: radius.cell,
  },
  skeletonName: {
    marginTop: spacing(12),
  },
  skeletonContext: {
    marginTop: spacing(8),
  },
});

const useThemedStyles = createThemedStyles(({ colors, dataviz }) => ({
  surface: {
    borderRadius: radius.section,
    padding: spacing(22),
  },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(7),
    paddingVertical: spacing(5),
    paddingHorizontal: spacing(11),
    // §2.3 draws the chip at radius 14 on a 26px box — at or past
    // height / 2, which §1.4 calls `full` rather than a step of its own.
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.brand.DEFAULT, '0.14'),
    borderWidth: 1,
    borderColor: withAlpha(colors.brand.DEFAULT, '0.42'),
  },
  dot: {
    width: spacing(6),
    height: spacing(6),
    borderRadius: radius.cell,
    backgroundColor: colors.brand.DEFAULT,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: radius.cell,
    marginTop: spacing(18),
    maxWidth: GRAPHIC_MAX_WIDTH,
    backgroundColor: dataviz.barTrack,
    overflow: 'hidden',
  },
}));
