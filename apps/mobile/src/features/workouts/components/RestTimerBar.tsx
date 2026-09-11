import { Button, Metric, Text } from '@coachos/ui';
import { density, radius, spacing, tapTarget, useTheme } from '@coachos/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRestTimerStore } from '../store/rest-timer-store.ts';

import { formatElapsed } from './SessionElapsed.tsx';

// `rest-timer/05` — the rest a client is taking, on the screen they are
// looking at. Tasks 03 and 04 cover the phone that is locked; this is the
// far more common posture, face-up on the bench with the app open.
//
// ============== WHERE IT SITS, AND WHY IT IS NOT UNDER THE CARD =========
//
// **It mounts ABOVE the logger body, not between the body and the foot.**
// That is the whole layout decision and it is arithmetic, not taste:
// everything from the body down is bottom-pinned — `body` is `flex: 1`
// above a fixed footer, then `ExercisePager`, the page, `SetEntrySlot`, and
// the composer as the slot's `flexShrink: 0` last child. **Anything
// inserted BELOW the body lifts the composer by its own height**, and
// `SetEntryRow`'s 205px card exists precisely so the confirm control sits
// at one screen coordinate for the entire session. Moving it forty times a
// session is the one thing that layout may not do. Inserted ABOVE the body,
// the bar changes the body's top edge and nothing else.
//
// The height comes out of `SetList`, which is the only elastic region on
// the screen and is elastic on purpose ("the list gives way; the card never
// does"). Measured on the 393×718 frame the list goes from 78px to 14px
// while a rest runs, so its rows are effectively off screen for the
// duration — clipped, never dropped, bottom-anchored so the newest row is
// the last to go, and whole again the moment the rest ends. That is the
// cost, and it is bounded: **the bar may never exceed what the list has to
// give**, or the composer starts moving. 52 + 12 against 78 is the margin.
//
// **The second reason not to seat it under the card** is that the skip
// control appears and disappears forty times a session, at exactly the
// moment a thumb is returning to the confirm. A new tappable target
// directly above the most-pressed control in the product is the mis-tap
// `SessionFinish` already refuses; opposite ends of the screen is the
// cheapest separation there is.
//
// ============== WHY THE SURFACE IS BUILT HERE AND NOT `Card` ============
//
// `Card` is the L2 primitive and this is an L2 surface, read from
// `elevation.raised` — nothing here is an invented value. What `Card`
// cannot do is be short: its padding is `density[d].cardPadding` (14 coach,
// 18 client) on all four sides, which puts a 46px control in a 74px bar and
// takes the total cost to 86 — more than the 78px the list has, at which
// point the composer moves. The alternative was a 32px control reached at
// 44 by `hitSlop`, on the surface a client presses between sets with chalky
// hands. The bar keeps the control and composes the surface.
//
// ============== WHAT IT READS, AND WHAT IT WRITES =======================
//
// **The number is the store's `remainingSeconds`, never a second
// computation.** This bar and task 03's lock-screen surface are the same
// number, and one source is the only way to guarantee that; a local
// recomputation that disagreed by a second would have the client reading
// one number while hearing the alert for another.
//
// **Skip calls `stopRest()`** — the store's only cancellation, which lands
// in FULL idle (`startedAtMs: null`, `targetSeconds: 0`). That is precisely
// the transition tasks 03 and 04 read as *cancelled* rather than
// *completed*: no haptic, no sound, the background surface cleared
// silently. There is no second path out, and this surface fires no alert of
// its own.
//
// **It takes no `sessionLocalId`.** The store's own invariant is one rest
// in the app at a time — one interval, one anchor — so a rest running while
// this screen is mounted is this screen's rest, and a rest started without
// a session named (the store's decision (e)) is still a real rest a client
// is taking.
//
// ============== ZERO IS A STATE, NOT AN ERROR ==========================
//
// At zero the store stops but keeps its anchor, so the bar stays and
// switches: the label becomes "Rest done", the numeral becomes the time
// since the target with a leading `+`, the meter empties, and the control
// becomes Dismiss. It counts up because a client who looked away wants to
// know how long they have actually been standing there — and it says
// nothing else. No "time's up", no "back to it", and **never `urgent`**:
// `DESIGN.md` §1.1 reserves that red for missed, overdue and destructive,
// and a client forty seconds past their coach's target has done none of
// those. `COPY.md` §CO2's no-shame rule applies to a number exactly as it
// does to a sentence.
//
// The count past zero is the one value the store does not hold — it stops
// ticking there — so it is derived here from the store's OWN anchor
// (`startedAtMs`, `targetSeconds`), which is the same model, not a second
// one. Nothing else renders it, so there is nothing for it to disagree
// with.
//
// ============== NOTHING ANIMATES =======================================
//
// `DESIGN.md` §5 forbids motion on a value the client is reading, and this
// bar is nothing but such a value — the same call `ProgramChangedNotice`
// makes from this same slot. The meter steps once a second with no
// transition, and §9's rolling-digit timer is deliberately unused: a
// per-digit 320ms translate, ninety times per rest, is continuous
// peripheral motion charged against §19's ≥55fps and 25%-battery budgets
// for nothing a tabular numeral does not already say. Reduce Motion
// therefore needs no branch here; there is no motion to reduce.

const SECOND_MS = 1_000;

/** Below this, each second matters and the spoken value stops rounding. */
const FINAL_SECONDS = 10;

const SPOKEN_STEP_SECONDS = 10;
const SPOKEN_COARSE_STEP_SECONDS = 30;
const MINUTE_SECONDS = 60;

/** Every word this surface says, and the only place it says them (`product-copy` §6). */
export const REST_TIMER_COPY = {
  /** Rendered uppercase by the `eyebrow` token, not by the string. */
  running: 'Rest',
  done: 'Rest done',
  skip: 'Skip',
  /** The action, not the glyph — `accessibility` §2. */
  skipAction: 'Skip rest',
  dismiss: 'Dismiss',
  dismissAction: 'Dismiss the rest timer',
} as const;

/** `+0:18` — time past the target, marked as such so it cannot read as time remaining. */
export function formatOvertime(seconds: number): string {
  return `+${formatElapsed(seconds)}`;
}

function plural(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

/**
 * The countdown in words, and **coarser than the drawn value on purpose**.
 *
 * Two requirements meet here. A screen reader must not recite a number once
 * a second (this element carries no live region, so a label only speaks
 * when focus lands on it — but focus does land, and a label that changed
 * every second would be unreadable when it did). And it must never offer
 * time the client does not have, so every rounding is DOWN.
 *
 * Ten-second steps under a minute, half-minutes above one, and single
 * seconds only in the last ten, where each one is the point.
 */
export function speakRestRemaining(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total <= FINAL_SECONDS) return `${REST_TIMER_COPY.running}, ${plural(total, 'second')} left`;

  if (total <= MINUTE_SECONDS) {
    const stepped = Math.floor(total / SPOKEN_STEP_SECONDS) * SPOKEN_STEP_SECONDS;
    return `${REST_TIMER_COPY.running}, ${plural(stepped, 'second')} left`;
  }

  const stepped = Math.floor(total / SPOKEN_COARSE_STEP_SECONDS) * SPOKEN_COARSE_STEP_SECONDS;
  const minutes = Math.floor(stepped / MINUTE_SECONDS);
  const rest = stepped % MINUTE_SECONDS;
  const segments =
    rest === 0 ? [plural(minutes, 'minute')] : [plural(minutes, 'minute'), plural(rest, 'second')];
  // "about", because the spoken value is deliberately behind the drawn one.
  return `${REST_TIMER_COPY.running}, about ${segments.join(' ')} left`;
}

/**
 * Past the target, in words. A fact about the clock and never one about the
 * client (`COPY.md` §CO2) — and the zero case says only that the rest is
 * done, rather than "0 seconds over", which reads as a countdown that has
 * failed to stop.
 */
export function speakRestOvertime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return REST_TIMER_COPY.done;
  const minutes = Math.floor(total / MINUTE_SECONDS);
  const rest = total % MINUTE_SECONDS;
  const segments = minutes === 0 ? [] : [plural(minutes, 'minute')];
  if (rest !== 0 || minutes === 0) segments.push(plural(rest, 'second'));
  return `${REST_TIMER_COPY.done}, ${segments.join(' ')} over`;
}

export interface RestTimerBarProps {
  /**
   * Freezes the count past zero. Injected so the over-state is testable;
   * the countdown itself never reads it, because that value belongs to the
   * store.
   */
  now?: Date | undefined;
}

export function RestTimerBar({ now }: RestTimerBarProps) {
  // Field by field rather than one object selector: each is a primitive, so
  // Zustand's default equality is enough and there is no snapshot to
  // rebuild per render (`frontend-performance` §3).
  const isRunning = useRestTimerStore((state) => state.isRunning);
  const remainingSeconds = useRestTimerStore((state) => state.remainingSeconds);
  const targetSeconds = useRestTimerStore((state) => state.targetSeconds);
  const startedAtMs = useRestTimerStore((state) => state.startedAtMs);
  const stopRest = useRestTimerStore((state) => state.stopRest);

  if (isRunning) {
    return (
      <RestBar
        label={REST_TIMER_COPY.running}
        value={formatElapsed(remainingSeconds)}
        spoken={speakRestRemaining(remainingSeconds)}
        action={REST_TIMER_COPY.skip}
        actionLabel={REST_TIMER_COPY.skipAction}
        onAction={stopRest}
        // Drains rather than fills, so its length mirrors the numeral.
        // `DESIGN.md` §8's second, non-hue channel: the states differ by
        // length before they differ by tint, and the bar survives being
        // desaturated.
        remainingFraction={
          targetSeconds === 0 ? 0 : Math.min(1, Math.max(0, remainingSeconds / targetSeconds))
        }
        isFinal={remainingSeconds <= FINAL_SECONDS}
        isOver={false}
      />
    );
  }

  // A rest that ran OUT, as opposed to one that was skipped: the store keeps
  // the anchor and the target on completion and clears both on `stopRest`.
  if (startedAtMs === null || targetSeconds === 0) return null;

  return (
    // Keyed on the anchor, so a second rest that has already run out mounts
    // a fresh count rather than inheriting the previous one's.
    <RestOvertimeBar
      key={String(startedAtMs)}
      startedAtMs={startedAtMs}
      targetSeconds={targetSeconds}
      now={now}
      onDismiss={stopRest}
    />
  );
}

interface RestOvertimeBarProps {
  startedAtMs: number;
  targetSeconds: number;
  now: Date | undefined;
  onDismiss: () => void;
}

/**
 * The rest after zero, and its own component so that it MOUNTS when that
 * state begins — which is what lets the clock be read in a `useState`
 * initialiser rather than during a render or inside an effect.
 *
 * That is also what keeps the first frame honest. A rest that ran out while
 * the app was asleep reaches this state through
 * `ensureRestTimerForegroundSync`'s single tick, minutes after the fact, and
 * has to read as minutes over immediately rather than as a `+0:00` that
 * jumps a second later.
 */
function RestOvertimeBar({ startedAtMs, targetSeconds, now, onDismiss }: RestOvertimeBarProps) {
  const frozen = now !== undefined;
  const [atMs, setAtMs] = useState(() => (now ?? new Date()).getTime());

  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setAtMs(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [frozen]);

  const overSeconds = Math.max(0, Math.floor((atMs - startedAtMs) / SECOND_MS) - targetSeconds);

  return (
    <RestBar
      label={REST_TIMER_COPY.done}
      value={formatOvertime(overSeconds)}
      spoken={speakRestOvertime(overSeconds)}
      action={REST_TIMER_COPY.dismiss}
      actionLabel={REST_TIMER_COPY.dismissAction}
      onAction={onDismiss}
      remainingFraction={0}
      isFinal={false}
      isOver
    />
  );
}

interface RestBarProps {
  label: string;
  value: string;
  spoken: string;
  action: string;
  actionLabel: string;
  onAction: () => void;
  remainingFraction: number;
  isFinal: boolean;
  isOver: boolean;
}

/** The surface both states share. Holds no state and reads no clock. */
function RestBar({
  label,
  value,
  spoken,
  action,
  actionLabel,
  onAction,
  remainingFraction,
  isFinal,
  isOver,
}: RestBarProps) {
  const theme = useTheme();
  const raised = theme.elevation.raised;

  return (
    // Its OWN gutter, because it mounts as a sibling of the logger's body
    // rather than inside it — `ProgramChangedNotice`'s rule, same slot, and
    // the same `density.client.gutter` so the edges line up.
    <View style={styles.wrap} testID="rest-timer-bar">
      <View
        style={[
          styles.bar,
          raised.shadow,
          { borderWidth: raised.borderWidth, borderColor: raised.borderColor },
        ]}
      >
        <LinearGradient
          colors={raised.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* React Native has no inset `box-shadow`; `DESIGN.md` §12 calls
            this faked top hairline essential to the raised surface. */}
        <View
          pointerEvents="none"
          style={[styles.topHighlight, { backgroundColor: raised.highlight }]}
        />

        {/* One accessible element, one announcement — the numerals are not
            read as they are drawn, the way `SessionElapsed` groups its own.
            Deliberately NO `accessibilityLiveRegion`: this must be readable
            on focus, not recited once a second. */}
        <View
          style={styles.value}
          accessible
          accessibilityRole="text"
          accessibilityLabel={spoken}
          testID="rest-timer-group"
        >
          <Text size="eyebrow" tone="muted" style={styles.upper} testID="rest-timer-label">
            {label}
          </Text>
          <Metric
            value={value}
            size="stat"
            tone={isOver ? 'warm' : isFinal ? 'bright' : 'default'}
            // `accessibility` §3's one-size cap, and the only one on this
            // bar: uncapped at 200% the numeral wraps the row and the bar
            // costs more than the list has to give, which moves the
            // composer. The label and the control's word scale in full.
            maxFontSizeMultiplier={1.6}
            testID="rest-timer-value"
          />
        </View>

        <View style={styles.spacer} />

        <Button
          variant="secondary"
          size="md"
          // 46px, not the client density's 52 — the geometry, not a role
          // claim, the same way `SetEntryRow` reads `density="coach"` for
          // its 14px card padding. 46 clears the 44 floor on its own.
          density="coach"
          onPress={onAction}
          accessibilityLabel={actionLabel}
          testID="rest-timer-skip"
        >
          {action}
        </Button>

        <View
          style={[styles.meter, { backgroundColor: theme.colors.bg.inset }]}
          pointerEvents="none"
        >
          {/* A grow pair rather than a percentage width: RN types a
              percentage as a template-literal string, and the proportion is
              what is being expressed. */}
          <View
            style={{
              flexGrow: remainingFraction,
              backgroundColor: isFinal ? theme.colors.brand.lift : theme.colors.brand.DEFAULT,
            }}
            testID="rest-timer-meter-fill"
          />
          <View style={{ flexGrow: 1 - remainingFraction }} />
        </View>
      </View>
    </View>
  );
}

const METER_HEIGHT = 3;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: density.client.gutter,
    paddingBottom: spacing(12),
  },
  bar: {
    // `tapTarget.MID_SET` is 52 and is exactly the 46px control plus the 3px
    // either side of it. Nothing sets a height: at 200% text the row grows
    // rather than clipping (`accessibility` §3).
    minHeight: tapTarget.MID_SET,
    borderRadius: radius.card,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing(14),
    paddingRight: spacing(6),
    paddingVertical: spacing(3),
    gap: spacing(12),
    // At 200% the label, the numeral and the control stop fitting on one
    // line; wrapping is the only alternative to overflowing the row.
    flexWrap: 'wrap',
    rowGap: spacing(6),
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  value: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing(10),
    flexShrink: 1,
    minWidth: 0,
  },
  upper: {
    textTransform: 'uppercase',
  },
  spacer: {
    flexGrow: 1,
    minWidth: spacing(6),
  },
  meter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: METER_HEIGHT,
    flexDirection: 'row',
  },
});
