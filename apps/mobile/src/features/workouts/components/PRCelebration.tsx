import { Metric, Text, useGlassAvailable } from '@coachos/ui';
import {
  createThemedStyles,
  easing,
  radius,
  spacing,
  useReducedMotion,
  useTheme,
  withAlpha,
} from '@coachos/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Triangle } from 'lucide-react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PR_COPY } from '../lib/pr-celebration.ts';
import { selectCurrentCelebration, usePRCelebrationStore } from '../store/pr-celebration-store.ts';

// `phase-09-workout-logger/personal-records/03` — the pill.
//
// ============ WHERE IT SITS, AND WHY IT COSTS NOTHING ==================
//
// **It hangs off the composer card's TOP edge.** An absolutely positioned
// child at `bottom: '100%'` plus an 8px margin, so it tracks the card's
// height instead of hard-coding it and contributes **zero layout height**.
// `SetEntryRow`'s 205px card exists precisely so the confirm control holds
// one screen coordinate for the whole session (`set-entry/03`), and a pill
// in the flow would move it forty times a workout.
//
// It cannot take `rest-timer/05`'s trick of sitting above the body: one tap
// starts the rest timer AND may fire a record, so that slot is already
// occupied at exactly the moment this wants it. Hanging off the card is
// what is left, and it is the better answer anyway — the card grows at 200%
// text and carries the pill up with it, which a constant could not do.
//
// ============ NON-BLOCKING MEANS THREE THINGS =========================
//
// **No pointer events.** A thumb reaching for the next rep passes through
// to whatever is under it. There is no tap-to-dismiss because there is
// nothing to dismiss.
//
// **No control.** No close button, no confirmation, nothing that expects an
// answer. It appears, it is read or it is not, it leaves at 2600ms.
//
// **No queue.** A second record inside the dwell replaces the first in place
// (`../store/pr-celebration-store.ts` decision (d)) — two pills would cover
// the log list, and a client on a five-set superset can genuinely earn two
// in ninety seconds.
//
// ============ MOTION ==================================================
//
// `prpop`: scale .86 → 1.05 → 1 with an 8px rise, 420ms on
// `easing.celebrate` — **the only overshoot in the product** (`DESIGN.md`
// §6, and `tokens.ts` labels that curve exactly so). This is the one
// surface licensed to use it. Exit is a plain 180ms fade with no scale: the
// arrival is the moment, the departure is not.
//
// Reduce Motion collapses both to a 160ms fade to the **identical end
// state** — never a pulse, never a loop, never confetti (`accessibility`
// §6: replace the movement, never the state change).
//
// Every value is driven on the UI thread through Reanimated shared values.
// The dwell and the exit are JS timers rather than animation callbacks
// because they are scheduling, not animation — and because a timer is
// clearable on unmount and on replacement, which a queued callback is not.
//
// ============ NO HAPTIC ===============================================
//
// Deliberately none. `ui-conventions` §5 sanctions exactly four triggers and
// a record is not one of them; the set's own `Light` already fired on the
// same tap, and a second buzz 300ms later reads as a stutter rather than a
// second event.

// The four durations below are the design's own and are deliberately NOT on
// `DESIGN.md` §5's five-step scale: nothing else in the product waits 2.6
// seconds, and nothing else overshoots at all. The CURVE is on the scale —
// `easing.celebrate` is labelled "PR — the ONLY overshoot in the product".

/** The design's `prpop`, 420ms, split at its 45% keyframe. */
const POP_RISE_MS = 189;
const POP_SETTLE_MS = 231;
/** How long it stays. 2.6s is long enough to read and short enough to miss. */
const DWELL_MS = 2600;
/** The exit fade. Not a token: `duration.state` is 200 and this is the design's 180. */
const EXIT_MS = 180;
/** Reduce Motion, both directions. */
const CALM_MS = 160;

/** Scale at the overshoot, and where it starts. */
const POP_FROM = 0.86;
const POP_PEAK = 1.05;
/** The rise, in px. Positive is below its resting place. */
const POP_RISE = 8;

/** The gap between the pill's bottom edge and the card's top. */
const CARD_GAP = spacing(8);

const CELEBRATE = Easing.bezier(
  easing.celebrate[0],
  easing.celebrate[1],
  easing.celebrate[2],
  easing.celebrate[3],
);
const OUT = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

/**
 * The record a client just set, over the composer that is about to take
 * their next one.
 *
 * Mounts **inside the composer card's own container** and nowhere else —
 * the whole placement argument above depends on its parent being the card.
 * Renders `null` whenever no record is on screen, which is almost always.
 */
export function PRCelebration() {
  const view = usePRCelebrationStore(selectCurrentCelebration);
  const dismiss = usePRCelebrationStore((state) => state.dismiss);
  const theme = useTheme();
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();
  // The glow is the one transparency effect on this surface. Reduce
  // Transparency and Increase Contrast are live OS settings — toggling
  // either must take effect without a relaunch (`accessibility` §5) —
  // and `useGlassAvailable` is where the app already subscribes to both.
  const { transparencyAllowed } = useGlassAvailable();

  const opacity = useSharedValue(0);
  const scale = useSharedValue(POP_FROM);
  const rise = useSharedValue(POP_RISE);

  const token = view?.token ?? null;
  const label = view?.label ?? null;

  // Keyed on the token, not on the view object: a replacement inside the
  // dwell restarts the clock from its own arrival rather than inheriting
  // whatever the first pill had left.
  useEffect(() => {
    if (token === null) return;

    if (reducedMotion) {
      scale.value = 1;
      rise.value = 0;
      opacity.value = withTiming(1, { duration: CALM_MS, easing: OUT });
    } else {
      opacity.value = withTiming(1, { duration: POP_RISE_MS, easing: CELEBRATE });
      rise.value = withTiming(0, { duration: POP_RISE_MS, easing: CELEBRATE });
      scale.value = withSequence(
        withTiming(POP_PEAK, { duration: POP_RISE_MS, easing: CELEBRATE }),
        withTiming(1, { duration: POP_SETTLE_MS, easing: CELEBRATE }),
      );
    }

    const exitMs = reducedMotion ? CALM_MS : EXIT_MS;
    const fade = setTimeout(() => {
      opacity.value = withTiming(0, { duration: exitMs, easing: OUT });
    }, DWELL_MS);
    // Taking the pill out of the tree is a separate beat from fading it:
    // the store is what owns "is one on screen", and it must not be cleared
    // before the fade it started has finished.
    const clear = setTimeout(() => {
      dismiss(token);
    }, DWELL_MS + exitMs);

    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
      // Back to the start, so a replacement pops rather than cross-fading
      // from wherever the last one happened to be.
      opacity.value = 0;
      scale.value = reducedMotion ? 1 : POP_FROM;
      rise.value = reducedMotion ? 0 : POP_RISE;
    };
  }, [dismiss, opacity, reducedMotion, rise, scale, token]);

  // VoiceOver has no live region — `accessibilityLiveRegion` is Android
  // only — so iOS is announced explicitly. Polite either way: it must not
  // interrupt a set being logged (`accessibility` §2).
  useEffect(() => {
    if (label === null || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(label);
  }, [label]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }, { scale: scale.value }],
  }));

  if (view === null) return null;

  return (
    <Animated.View
      style={[styles.pill, themed.pill, transparencyAllowed ? themed.glow : null, animated]}
      // Non-negotiable. The next set is always reachable through it.
      pointerEvents="none"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={view.label}
      testID="pr-celebration"
    >
      {/* Brand over deep — `DESIGN.md` §8's record treatment. Deliberately
          NOT glass: it sits over the log list, and glass never nests. */}
      <LinearGradient
        colors={[
          withAlpha(theme.colors.brand.DEFAULT, '0.14'),
          withAlpha(theme.colors.deep, '0.3'),
        ]}
        style={[StyleSheet.absoluteFill, styles.surface]}
        pointerEvents="none"
      />

      {/* Shape before hue, so the mark survives greyscale (`accessibility`
          §4). The same triangle, at 13px, stays on the row that earned it. */}
      <Triangle
        size={20}
        color={theme.colors.brand.DEFAULT}
        fill={withAlpha(theme.colors.brand.DEFAULT, '0.25')}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      <View style={styles.words}>
        {/* `brand`, which the text ramp has no tone for: §8's record
            treatment is the one surface that takes the accent as ink, and
            the tone vocabulary is not widened for one caller. */}
        <Text size="body-lg" style={{ color: theme.colors.brand.DEFAULT }}>
          {view.title}
        </Text>
        {/* Wraps rather than truncating at 200% text — the pill is overlaid
            and transient, so growing costs the layout nothing. */}
        <View style={styles.detail}>
          <Text size="caption" tone="warm-muted">
            {view.detailLead}
          </Text>
          <Metric value={view.detailValue} size="caption" tone="warm" />
        </View>
      </View>

      {view.moreCount > 0 ? (
        // The count of the other types beaten. Never a second pill, never
        // four. Hidden from the reading order: `view.label` is the one
        // utterance, and "+2" spoken alone says nothing.
        <View
          style={[styles.more, themed.more]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Metric value={PR_COPY.moreLabel(view.moreCount)} size="micro" tone="warm" />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    // The placement argument, in four properties. `bottom: '100%'` puts the
    // pill's bottom edge on the card's top edge whatever the card's height
    // is; the margin is the 8px gap; and absolute means zero layout height,
    // which is what makes "non-blocking" measurable rather than aspirational.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: CARD_GAP,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingVertical: spacing(13),
    // The design's 15 is not on §1.4's scale; 14 is the step below it.
    paddingHorizontal: spacing(14),
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    // Clips the gradient to the radius on Android, which does not inherit it.
    overflow: 'hidden',
  },
  surface: {
    borderRadius: radius.card,
  },
  words: {
    flex: 1,
    minWidth: 0,
  },
  detail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing(4),
    marginTop: spacing(3),
  },
  more: {
    flexShrink: 0,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(9),
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  pill: {
    borderColor: withAlpha(theme.colors.brand.DEFAULT, '0.4'),
  },
  /**
   * The only brand glow in the logger, and the reason this surface reads as
   * lit rather than merely tinted. Dropped entirely under Reduce
   * Transparency: the border and the gradient carry the surface on their
   * own, and nothing is communicated by the glow alone.
   */
  glow: {
    shadowColor: theme.colors.brand.DEFAULT,
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  more: {
    backgroundColor: withAlpha(theme.colors.deep, '0.55'),
    borderColor: withAlpha(theme.colors.brand.DEFAULT, '0.28'),
  },
}));
