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
import { TodayCardNoProgram } from './TodayCardNoProgram.tsx';

// The Today hero (`today-card/DESIGN-SPEC.md` §1–§4). One shape, five
// slots — state chip → name → context line → state graphic → primary
// action — filled differently per state and never restructured.
//
// Frames `A` (scheduled), `B` (in progress), `C` (completed), `F`
// (loading) and `G` (error) came from `today-card/01`. `today-card/03`
// added frames `D` (rest day) and `E` (no program): `D` is the same hero
// with three of its five slots empty and a quieter chip, `E` is the one
// state that is NOT a card at all — with no program there is nothing for
// the hero's slots to hold, so it is `EmptyState`.
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
   * The ad-hoc flow (`today-card/04`). All three of DESIGN-SPEC §3.9's
   * entry points hang off this one prop — `Log another workout`
   * (completed), `Log something anyway` (rest day) and `Log a workout
   * anyway` (no program) — because they differ only in label, and a client
   * only ever sees one of them at a time.
   *
   * **Required.** It was optional while task `04` was unbuilt, so the three
   * buttons could be absent rather than inert; `TodayScreen` now always
   * supplies it, and an optional prop here would only preserve a state
   * nothing can produce.
   */
  onStartAdHoc: () => void;
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

/** §2.3's `nm2` measure — a sentence wants a shorter line than a name. */
const REST_DAY_LINE_MAX_WIDTH = 240;

/** §2.3's hollow ring. A hairline, not a spacing step, so not on §1.4's scale. */
const HOLLOW_RING_WIDTH = 1.5;

/**
 * Frame `D`'s one line, and `COPY.md` CO§4.1's sanctioned string for "no
 * session today" verbatim. A fact, in the client's own words, with no
 * judgement attached to it in either direction.
 */
const REST_DAY_LINE = 'Nothing scheduled today.';

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
      return <RestDayHero isRestDay={state.isRestDay} onStartAdHoc={onStartAdHoc} />;

    case 'no-program':
      return <TodayCardNoProgram hasCoach={state.hasCoach} onStartAdHoc={onStartAdHoc} />;
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
  onStartAdHoc: () => void;
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
        <StateChip label={chipLabel} glyph={PHASE_GLYPH[phase.phase]} />
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
            <Button variant="secondary" size="md" density="client" fullWidth onPress={onStartAdHoc}>
              Log another workout
            </Button>
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

// ── Rest day (frame `D`) ────────────────────────────────────────────────

/**
 * The same hero, quieter (DESIGN-SPEC §3.4). Three of the five slots are
 * empty by design — no name, no context line, no state graphic — and the
 * two that remain are the chip and the action.
 *
 * **The copy is `COPY.md` CO§4.1's sanctioned pair, verbatim:** the fact
 * ("Nothing scheduled today.") and one next step (*Log something anyway*).
 * Task `03`'s own suggested "Rest day — recovery is part of the plan" is
 * rejected by DESIGN-SPEC §0 and is not what ships: it asserts a training
 * principle (CO§1.2, never prescribe), it is a judgement the product does
 * not get to make (CO§0), and it is CO§2's motivational voice. The same
 * rule forbids "Enjoy your rest" and every other congratulation.
 *
 * The line sits at `h2` rather than `stat` because it is a sentence and not
 * a name, which is also what makes the card read quieter than frame `A`.
 *
 * Nothing here is an error, and nothing here is `colors.state.notStarted`:
 * a rest day is a designed part of the program, not an absence of
 * adherence, and grey would say the opposite.
 */
function RestDayHero({
  isRestDay,
  onStartAdHoc,
}: {
  isRestDay: boolean;
  onStartAdHoc: () => void;
}) {
  // §3.4's one string swap, not a second state. `false` is "the program
  // materialised no session for today but does not mark today a rest day",
  // which should stop happening once §5.1's API context lands — until then
  // the chip states what is known and claims nothing more.
  const chipLabel = isRestDay ? 'Rest day' : 'Nothing scheduled';

  return (
    <HeroSurface>
      {/* No art. §6 forbids a graphic carrying a meaning the text does not,
          and a loaded barbell on a rest day is the clearest case of it. */}
      <View
        accessible
        // Deliberately not `${chipLabel}. ${REST_DAY_LINE}` — in the
        // non-rest-day case that reads "Nothing scheduled. Nothing
        // scheduled today.", which is the same fact twice (`accessibility`
        // §2: one item, and it should sound like one).
        accessibilityLabel={isRestDay ? `Rest day. ${REST_DAY_LINE}` : REST_DAY_LINE}
        style={styles.inner}
      >
        <StateChip label={chipLabel} glyph="hollow-ring" />
        <Text size="h2" tone="bright" style={styles.restDayLine}>
          {REST_DAY_LINE}
        </Text>
      </View>

      <View style={styles.actions}>
        {/* Secondary, not primary: the client was not asked to train today,
            so the offer must not read as an instruction. It exists at all
            so the state is never a dead end. */}
        <Button variant="secondary" size="md" density="client" fullWidth onPress={onStartAdHoc}>
          Log something anyway
        </Button>
      </View>
    </HeroSurface>
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
 * The chip's second, non-colour channel — §4's requirement that the state
 * never rides on hue. Verified by desaturating, not by eye: frame `K` puts
 * all four side by side with saturation at zero.
 */
type ChipGlyph = 'dot' | 'pulsing-dot' | 'check' | 'hollow-ring';

const PHASE_GLYPH: Record<TodaySessionPhase['phase'], ChipGlyph> = {
  scheduled: 'dot',
  'in-progress': 'pulsing-dot',
  completed: 'check',
};

/**
 * §4 — the state never rides on hue. Every chip carries a second,
 * non-colour channel (filled dot / pulsing dot / check glyph / hollow ring
 * on a recessed fill) and the label is always present as the third. The
 * three session chips use the brand ramp: §2.4 is explicit that the
 * prototype's urgent-red "scheduled" chip is not ported, because
 * `DESIGN.md` §8 reserves that hue for missed, overdue, and destructive,
 * and a red chip on the client's home screen is `COPY.md` CO§2's loss
 * framing rendered in colour.
 *
 * The rest-day chip is the one that recedes (§2.3): a recessed fill and a
 * `border.strong` edge instead of the brand tint, so the card reads quieter
 * than a scheduled one without reading disabled.
 */
function StateChip({ label, glyph }: { label: string; glyph: ChipGlyph }) {
  const themed = useThemedStyles();
  const { colors } = useTheme();
  const quiet = glyph === 'hollow-ring';

  return (
    <View style={quiet ? [themed.chip, themed.chipQuiet] : themed.chip}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {glyph === 'check' ? (
          <Check size={12} color={colors.brand.DEFAULT} strokeWidth={3} />
        ) : (
          <StateDot pulsing={glyph === 'pulsing-dot'} hollow={quiet} />
        )}
      </View>
      {/* The only uppercase text on the screen (`DESIGN.md` §1.2: never
          uppercase anything but the eyebrow). The string itself stays
          sentence case, so the accessible label reads normally. */}
      <Text size="eyebrow" tone={quiet ? 'muted' : 'warm'} className="uppercase">
        {label}
      </Text>
    </View>
  );
}

function StateDot({ pulsing, hollow = false }: { pulsing: boolean; hollow?: boolean }) {
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
  return (
    <Animated.View style={hollow ? [themed.dot, themed.dotHollow, style] : [themed.dot, style]} />
  );
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
    // A determinate bar with no denominator is not a quieter bar, it is a
    // wrong one — it would sit permanently empty under a session the client
    // is eight sets into. Same degraded summary as `describeContext`.
    if (session.targetSets <= 0) return null;
    return <ProgressBar logged={phase.setsLogged} target={session.targetSets} />;
  }

  return (
    <View style={styles.metrics}>
      {/* Dropped rather than shown as "22 of 0", the same way Volume and
          Time drop when they cannot be computed. */}
      {session.targetSets > 0 ? (
        <MetricCell
          label="Sets"
          value={`${String(phase.setsLogged)} of ${String(session.targetSets)}`}
        />
      ) : null}
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
 *
 * **A zero is not a fact here, it is a missing one.** `summariseSession`
 * degrades to an all-zero summary when today's row carries the history
 * writer's payload shape instead of the prefetch writer's — the two-writer
 * race `lib/prefetch/history.ts` documents — and the client is still shown
 * the session and can still start it. So every count is gated on being
 * positive: "0 exercises" and "Set 8 of 0" both read as claims about the
 * client's workout, and both would be false.
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
    const elapsed = formatElapsed(phase.startedAt, now);
    // "Set 8 of 0" is a false statement about the client's own workout, so
    // the position drops WHOLE and the line states the one fact it still
    // holds. Two complete strings rather than a conditionally-assembled
    // one: `product-copy` §6 — drop a segment, never build a sentence from
    // fragments.
    if (session.targetSets <= 0) return `Started ${elapsed}`;
    return [
      `Set ${String(phase.setsLogged)} of ${String(session.targetSets)}`,
      `started ${elapsed}`,
    ].join(' · ');
  }

  const segments: string[] = [];
  if (session.exerciseCount > 0) {
    segments.push(plural(session.exerciseCount, 'exercise', 'exercises'));
  }
  if (session.estimatedMinutes !== null) {
    // The `~` is load-bearing: the estimate is a population average, not a
    // promise about this client's pace.
    segments.push(`~${String(session.estimatedMinutes)} min`);
  }
  if (session.targetSets > 0) segments.push(plural(session.targetSets, 'set', 'sets'));
  // Every segment gone leaves the empty string, and `SessionHero` renders
  // no context line at all for it — an absent line, never a blank one and
  // never a "0 exercises" that reads as a fact.
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
  restDayLine: {
    marginTop: spacing(12),
    // A measure, not a spacing step. No `numberOfLines`: at 200% text the
    // line wraps and the card grows (`accessibility` §3).
    maxWidth: REST_DAY_LINE_MAX_WIDTH,
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
  // §2.3's quiet chip. `bg.inset` IS the prototype's `rgb(19,26,41)`, so
  // this is the same fill expressed through the token rather than the hex.
  chipQuiet: {
    backgroundColor: withAlpha(colors.bg.inset, '0.45'),
    borderColor: colors.border.strong,
  },
  dot: {
    width: spacing(6),
    height: spacing(6),
    borderRadius: radius.cell,
    backgroundColor: colors.brand.DEFAULT,
  },
  // The shape channel for a rest day: a ring rather than a disc, one step
  // larger so the outline is legible at 1.5px, and it survives greyscale.
  dotHollow: {
    width: spacing(8),
    height: spacing(8),
    borderRadius: radius.full,
    backgroundColor: 'transparent',
    borderWidth: HOLLOW_RING_WIDTH,
    borderColor: colors.fg.muted,
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
