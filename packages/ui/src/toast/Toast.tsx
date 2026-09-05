import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '../components/Button.tsx';
import { Metric } from '../components/Metric.tsx';
import { Text } from '../components/Text.tsx';
import { GlassSurface } from '../surfaces/GlassSurface.tsx';
import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { duration, easing, radius, spacing } from '../theme/tokens.ts';

export type ToastAction = {
  /** Sentence case, one or two words (`COPY.md` CO§4.3 — "Set deleted" → *Undo*). */
  label: string;
  onPress: () => void;
};

export interface ToastProps {
  /** The host's key for this toast, handed back to `onTimeout`. */
  toastId: string;
  /** What happened, as a fact. Never a judgement, never an exclamation mark (`COPY.md` CO§4.3). */
  message: string;
  action?: ToastAction | undefined;
  /** The window before `onTimeout` fires. Starts when the toast becomes visible, not when it was queued. */
  durationMs: number;
  /** The remaining whole seconds, beside the action. The undo pattern's countdown (`CLAUDE.md` §7.5). */
  showCountdown?: boolean | undefined;
  /** The host has resolved this toast and is animating it out. */
  isLeaving?: boolean | undefined;
  /**
   * The window elapsed with the action untaken. **Must be referentially
   * stable** — it is an effect dependency, and a fresh closure each render
   * would restart the window every time any other toast appeared, silently
   * turning a five-second offer into an unbounded one. Hence the id
   * argument rather than a per-toast closure.
   */
  onTimeout: (toastId: string) => void;
  testID?: string | undefined;
}

/** `fadeup`'s 10px rise (`DESIGN.md` §5), reused as the fall on the way out. */
const TRAVEL = 10;

/**
 * `duration.state` (200ms, §5's 180–220 band) both ways, which is also
 * DESIGN-SYSTEM.md DS§6.8's "toast — slide and fade, 180ms". `easing.rise`
 * in (§5 assigns it to rise/enter), `easing.out` out (fades, generic).
 */
const ENTER_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const EXIT_EASING = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

/** Four ticks a second, so the numeral never sits a whole second behind the window it describes. */
const COUNTDOWN_TICK_MS = 250;

const COUNTDOWN_SIZE = 28;

/**
 * Reduce Motion is a live setting, not a static capability — subscribed
 * rather than sampled once. Deliberately duplicated from `Calendar`, whose
 * own header notes the same: extracting it would edit a component this task
 * has no other business in (`CLAUDE.md` §0 rule 8). Promote it to
 * `theme/useReducedMotion.ts` on the third consumer.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      // Only when it differs from the `false` this starts at. `Calendar`'s
      // copy sets unconditionally; a no-op setState resolving after the
      // render still trips React's act() warning in every test that mounts
      // a toast, and there is nothing to warn about.
      if (mounted && value) setReduced(true);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => setReduced(value),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * One toast. Rendered only by `ToastProvider`'s host — a screen asks for a
 * toast, it never places one.
 *
 * **This component owns its own window.** The auto-dismiss timer and the
 * countdown both start on mount, and the host only mounts a toast once it
 * is actually visible, so a toast waiting behind a full stack cannot burn
 * its undo window unseen (`screen-states/03` — the window has to be a
 * genuine offer, not a formality).
 *
 * Tier-1 glass in the action bar's position (`DESIGN.md` §4/§9): floating
 * chrome over content, which is the one place `ui-conventions` §5 permits
 * glass on a toast. Never nested inside another glass surface, and never
 * over a chart.
 */
export function Toast({
  toastId,
  message,
  action,
  durationMs,
  showCountdown = false,
  isLeaving = false,
  onTimeout,
  testID,
}: ToastProps) {
  const reducedMotion = useReducedMotion();
  const themed = useThemedStyles();
  const progress = useSharedValue(0);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.ceil(durationMs / 1000));

  // Enter on mount, exit when the host resolves it — one effect, because
  // `react-hooks/immutability` allows a shared value to be written from a
  // single effect only.
  useEffect(() => {
    progress.value = withTiming(isLeaving ? 0 : 1, {
      duration: duration.state,
      easing: isLeaving ? EXIT_EASING : ENTER_EASING,
    });
    // `progress` is a Reanimated shared value: stable identity, not a
    // reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeaving]);

  // A toast is a state change a screen reader user is otherwise never told
  // about — an optimistic delete is silent by definition (`accessibility`
  // §2). Announced once, on appearance; the countdown is not announced at
  // all, or it would talk over everything else four times a second.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  useEffect(() => {
    const timer = setTimeout(() => onTimeout(toastId), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onTimeout, toastId]);

  useEffect(() => {
    if (!showCountdown) return;
    const startedAtMs = Date.now();
    const interval = setInterval(() => {
      const remainingMs = Math.max(0, durationMs - (Date.now() - startedAtMs));
      setSecondsLeft(Math.ceil(remainingMs / 1000));
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [durationMs, showCountdown]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduce Motion keeps the opacity fade and drops the travel
    // (`DESIGN.md` §13), rather than dropping the transition entirely.
    transform: [{ translateY: (reducedMotion ? 0 : TRAVEL) * (1 - progress.value) }],
  }));

  return (
    <Animated.View style={[themed.shadow, animatedStyle]} accessibilityRole="alert">
      <GlassSurface tier="tier1" interactive={action !== undefined} style={styles.surface}>
        <View style={[styles.row, action ? styles.rowWithAction : null]} testID={testID}>
          <Text size="body" tone="glass" style={styles.message}>
            {message}
          </Text>
          {showCountdown ? <Countdown secondsLeft={secondsLeft} /> : null}
          {action ? (
            <Button
              variant="secondary"
              size="md"
              // DESIGN.md §9 puts the dock and the action bar at 64px in
              // both apps, and 9px of padding around a 46px control is
              // exactly that. Chrome does not change size with density.
              density="coach"
              onPress={action.onPress}
              accessibilityLabel={action.label}
            >
              {action.label}
            </Button>
          ) : null}
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

/**
 * The remaining seconds, hidden from the reading order: a live numeral that
 * re-announces four times a second would bury the message it belongs to.
 * Nothing is communicated by it alone — the message and the labelled action
 * carry the whole meaning (`accessibility` §4).
 */
function Countdown({ secondsLeft }: { secondsLeft: number }): ReactNode {
  const themed = useThemedStyles();
  return (
    <View
      style={themed.countdown}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Metric value={secondsLeft} size="label" tone="glass" />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.full,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingHorizontal: spacing(18),
    paddingVertical: spacing(9),
    // A message-only toast still reads as the same bar as one with an
    // action: 9px + a 46px control is DESIGN.md §9's 64px dock height.
    minHeight: 64,
  },
  // The trailing control carries its own visual weight, so the padding
  // steps down to §9's action-bar 9px on that side only.
  rowWithAction: {
    paddingRight: spacing(9),
  },
  message: {
    flex: 1,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  // Tier-1's long soft drop sits on the outer view: `GlassSurface` clips its
  // own children (`overflow: hidden`), which would clip the shadow with them.
  shadow: {
    borderRadius: radius.full,
    ...theme.glass.tier1.shadow,
  },
  countdown: {
    // Min, never fixed — a `label` line box is 40px at 200% text and would
    // be cut in half by a 28px circle (`accessibility` §3).
    minWidth: COUNTDOWN_SIZE,
    minHeight: COUNTDOWN_SIZE,
    paddingHorizontal: spacing(6),
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.control.surface,
    borderWidth: 1,
    borderColor: theme.control.border,
  },
}));
