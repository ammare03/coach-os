import { Minus, Plus } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { useTextScale } from '../theme/TextScaleProvider.tsx';
import {
  density as densityTokens,
  fontFamily,
  fontSize,
  spacing,
  tapTarget,
  type Density,
  type TextSize,
} from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { Metric } from './Metric.tsx';
import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';
import { useLongPressRepeat } from './useLongPressRepeat.ts';

// DESIGN.md §9 — "52px square, radius 18". §1.4's ladder rounds the stepper
// into its "9–12px control" row and the two contradict each other; §9's
// specimen and all three prototypes (`DESIGN.dc.html`,
// `CoachOS-Client.dc.html`) render 18, so 18 it is. Component-specific
// geometry, like `Button`'s own size table — not a reusable radius.
const KEY_RADIUS = 18;

// §9 — the icon inside a stepper key: 20px, `fg.glass`, 2.6 stroke.
const ICON_SIZE = 20;
const ICON_STROKE_WIDTH = 2.6;

// §5 — press feedback at `scale(.92)`, the value the prototypes give these
// keys specifically (the product default is `.97`).
const KEY_PRESS_SCALE = 0.92;

// The client literal is §9's: 46/46 Space Grotesk. DESIGN.md gives no coach
// stepper, so coach steps down to the next Space Grotesk numeral size —
// still 30pt, an order above the 16pt floor.
const VALUE_SIZE: Record<Density, TextSize> = {
  client: 'numeral-xl',
  coach: 'stat',
};

const ADJUSTABLE_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

export interface NumberStepperProps {
  /**
   * Controlled, with no internal value state: in P09 the value lives in the
   * logger's Zustand draft and is persisted to SQLite between renders
   * (`code-conventions` §5). There is no empty state — the consumer always
   * supplies a sensible starting number, which is what makes "same weight as
   * last time" cost zero taps.
   */
  value: number;
  onChange: (value: number) => void;
  /**
   * ONE step size per instance, chosen by the consumer: 2.5 barbell, 2.0
   * dumbbell, 1 reps, 0.5 RPE, 0.1 body weight, 10 kcal. A second step size
   * on the same control would make one gesture mean two things. The ±5kg
   * jump is a separate affordance on P09's set row, not a mode here.
   */
  step: number;
  /** Defaults to 0 — a negative weight or rep count is never valid. */
  min?: number;
  /** Required: the sane ceiling for reps and for kilograms are three orders of magnitude apart. */
  max: number;
  /** Display unit, already converted (`CLAUDE.md` §17.2). This component never converts. */
  unit?: string;
  /** Spoken form of `unit` — "kilograms", not "kg". Defaults to `unit`. */
  unitLabel?: string;
  /** Decimal places. Defaults to the decimals in `step`. */
  precision?: number;
  density?: Density;
  isDisabled?: boolean;
  /**
   * The quantity, lower-case and unqualified — "weight", "reps", "RPE". The
   * keys derive "Increase weight" / "Decrease weight" from it.
   */
  accessibilityLabel: string;
  testID?: string;
}

function decimalPlacesOf(n: number): number {
  const text = String(Math.abs(n));
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export interface StepArgs {
  value: number;
  step: number;
  direction: 1 | -1;
  min: number;
  max: number;
  precision: number;
}

/**
 * One step, in integers. Floating-point stepping accumulates: adding 0.1
 * sixteen times gives 1.6000000000000003, and `set_logs.weight_kg` /
 * `rpe numeric(3,1)` are exact columns (`DATABASE.md` DB§5.2) that would
 * store the residue and surface it on a chart axis two phases later. The
 * arithmetic happens in hundredths or tenths; formatting happens at the
 * display boundary and nowhere else.
 */
export function nextStepValue({ value, step, direction, min, max, precision }: StepArgs): number {
  const scale = 10 ** precision;
  const ticks = Math.round(value * scale) + direction * Math.round(step * scale);
  const clamped = Math.min(Math.round(max * scale), Math.max(Math.round(min * scale), ticks));
  return clamped / scale;
}

/** Rounds and clamps a typed value. Snaps to `precision`, never to `step` — typing 63 with a 2.5 step is legitimate. */
export function clampToPrecision(
  value: number,
  min: number,
  max: number,
  precision: number,
): number {
  const scale = 10 ** precision;
  const ticks = Math.min(
    Math.round(max * scale),
    Math.max(Math.round(min * scale), Math.round(value * scale)),
  );
  return ticks / scale;
}

interface StepperKeyProps {
  icon: ComponentType<{ size: number; color: string; strokeWidth: number }>;
  size: number;
  hitSlop: number;
  disabled: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  testID?: string | undefined;
}

function StepperKey({
  icon: Icon,
  size,
  hitSlop,
  disabled,
  accessibilityLabel,
  onPress,
  onPressIn,
  onPressOut,
  testID,
}: StepperKeyProps) {
  const { colors } = useTheme();
  const themed = useThemedStyles();

  const style: StyleProp<ViewStyle> = [
    themed.key,
    disabled ? themed.keySurfaceDisabled : themed.keySurface,
    {
      width: size,
      height: size,
      borderWidth: disabled ? 0 : 1,
    },
  ];

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={disabled ? undefined : onPressOut}
      disabled={disabled}
      pressScale={KEY_PRESS_SCALE}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={style}
    >
      {/* §9's `inset 0 1px 0 rgba(255,255,255,.14)`, faked — React Native has
          no inset box-shadow (§12). It does NOT collapse on press: the
          prototypes' active state changes the transform only. */}
      <View pointerEvents="none" style={themed.keyHighlight} />
      <Icon
        size={ICON_SIZE}
        color={disabled ? colors.fg.faint : colors.fg.glass}
        strokeWidth={ICON_STROKE_WIDTH}
      />
    </Pressable>
  );
}

/**
 * The core input of the workout logger, and the reason logging stays cheap
 * enough to happen at all: a client standing in a gym, breathing hard, one
 * thumb, chalky fingers, sixty seconds of rest. Every competing product
 * costs six interactions and a keyboard for the same set, which is why
 * people stop logging by week three.
 *
 * The contract, which every later consumer will be tempted to break:
 * **one step size, no internal value store, no mode.** P13 wants a calorie
 * stepper, P17 a 1–10 scale, P18 body weight — all are this control with a
 * different `step` and `precision`. Anything else is a request to make the
 * logger slower.
 *
 * Synchronous by design: `onChange` fires, the parent's state updates, the
 * number changes on the next frame. No animation on the value, no layout
 * transition, nothing async (`CLAUDE.md` §19: <100ms to visual
 * confirmation). And no haptics — `ui-conventions` §5 permits `Light` on
 * **set logged**, fired once by P09's commit handler, not per digit.
 */
export function NumberStepper({
  value,
  onChange,
  step,
  min = 0,
  max,
  unit,
  unitLabel,
  precision,
  density: densityProp = 'client',
  isDisabled = false,
  accessibilityLabel,
  testID,
}: NumberStepperProps) {
  const resolvedPrecision = precision ?? decimalPlacesOf(step);
  const scale = 10 ** resolvedPrecision;

  const [draft, setDraft] = useState<string | null>(null);
  // Mirrors `draft` so a submit and the blur it triggers cannot both commit.
  const draftRef = useRef<string | null>(null);

  // A long press emits faster than the parent commits, so each repeat steps
  // from the last value this control emitted rather than from the last one
  // it rendered. Without it a held key would step once and then repeat the
  // same arithmetic from a stale prop. The prop still wins: this resynchs
  // after every commit, so a parent that clamps is obeyed.
  const emittedRef = useRef(value);
  useEffect(() => {
    emittedRef.current = value;
  });

  const atMin = Math.round(value * scale) <= Math.round(min * scale);
  const atMax = Math.round(value * scale) >= Math.round(max * scale);

  const applyStep = (direction: 1 | -1) => {
    if (isDisabled) return;
    const base = emittedRef.current;
    const next = nextStepValue({
      value: base,
      step,
      direction,
      min,
      max,
      precision: resolvedPrecision,
    });
    if (next === base) return;
    emittedRef.current = next;
    onChange(next);
  };

  const decrementRepeat = useLongPressRepeat({ onRepeat: () => applyStep(-1) });
  const incrementRepeat = useLongPressRepeat({ onRepeat: () => applyStep(1) });

  // `onPressOut` runs before `onPress`, so a hold that already repeated must
  // not land one more step once the finger lifts.
  const handleKeyPress = (direction: 1 | -1) => {
    const repeat = direction === 1 ? incrementRepeat : decrementRepeat;
    if (repeat.didRepeat()) return;
    applyStep(direction);
  };

  const setDraftText = (text: string | null) => {
    draftRef.current = text;
    setDraft(text);
  };

  const commitDraft = () => {
    const text = draftRef.current;
    if (text === null) return;
    setDraftText(null);
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (Number.isNaN(parsed)) return;
    const next = clampToPrecision(parsed, min, max, resolvedPrecision);
    if (next === emittedRef.current) return;
    emittedRef.current = next;
    onChange(next);
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') applyStep(1);
    if (event.nativeEvent.actionName === 'decrement') applyStep(-1);
  };

  const themed = useThemedStyles();
  const textScale = useTextScale();
  const keySize = densityTokens[densityProp].button;
  // Mirrors `Button`'s pattern: the visible box is the design's, the tap
  // area reaches the floor through symmetric `hitSlop` rather than by
  // growing the box. §13's floor for a mid-set control is 52.
  const keyHitSlop = Math.max(0, Math.ceil((tapTarget.MID_SET - keySize) / 2));

  const formatted = value.toFixed(resolvedPrecision);
  const spokenUnit = unitLabel ?? unit;

  return (
    <View style={styles.row} testID={testID}>
      <StepperKey
        icon={Minus}
        size={keySize}
        hitSlop={keyHitSlop}
        disabled={isDisabled || atMin}
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
        onPress={() => handleKeyPress(-1)}
        onPressIn={decrementRepeat.start}
        onPressOut={decrementRepeat.stop}
        testID={testID === undefined ? undefined : `${testID}-decrement`}
      />

      {/* The `adjustable` role sits on the value, not on a wrapper around the
          whole control: a VoiceOver or TalkBack user swipes up and down here
          and never hunts for either key, while the keys stay individually
          focusable so their disabled state at min and max is still
          announced. Wrapping the lot in one accessible element would trade
          the second for the first. */}
      <Pressable
        onPress={isDisabled ? undefined : () => setDraftText(formatted)}
        disabled={isDisabled}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Double tap to type a value"
        accessibilityState={{ disabled: isDisabled }}
        accessibilityValue={{
          min,
          max,
          now: value,
          text: spokenUnit === undefined ? formatted : `${formatted} ${spokenUnit}`,
        }}
        accessibilityActions={ADJUSTABLE_ACTIONS}
        onAccessibilityAction={handleAccessibilityAction}
        testID={testID === undefined ? undefined : `${testID}-value`}
        containerStyle={styles.valueArea}
        style={styles.valueInner}
      >
        {draft === null ? (
          <View style={styles.valueLine}>
            <Metric
              value={formatted}
              size={VALUE_SIZE[densityProp]}
              tone={isDisabled ? 'muted' : 'bright'}
            />
            {unit === undefined ? null : (
              <Text size="label" tone="warm-muted">
                {unit}
              </Text>
            )}
          </View>
        ) : (
          /* The escape hatch, deliberately second-class: it exists for the
             140kg-from-20kg case and for accessibility, it never opens on
             mount, and it commits on blur as well as on submit so a value
             typed and tapped away from is not lost. It edits in place at the
             same face and size, so the row height never moves under a thumb. */
          <TextInput
            value={draft}
            onChangeText={setDraftText}
            onBlur={commitDraft}
            onSubmitEditing={commitDraft}
            autoFocus
            selectTextOnFocus
            keyboardType="decimal-pad"
            returnKeyType="done"
            accessibilityLabel={accessibilityLabel}
            testID={testID === undefined ? undefined : `${testID}-input`}
            style={[
              themed.valueInput,
              {
                minHeight: keySize,
                // Scaled explicitly for the same reason `Input`'s is: a raw
                // `TextInput` tracks the OS font setting but not the gallery's
                // scale toggle (`component-gallery/02`).
                fontSize: fontSize[VALUE_SIZE[densityProp]][0] * textScale,
              },
            ]}
          />
        )}
      </Pressable>

      <StepperKey
        icon={Plus}
        size={keySize}
        hitSlop={keyHitSlop}
        disabled={isDisabled || atMax}
        accessibilityLabel={`Increase ${accessibilityLabel}`}
        onPress={() => handleKeyPress(1)}
        onPressIn={incrementRepeat.start}
        onPressOut={incrementRepeat.stop}
        testID={testID === undefined ? undefined : `${testID}-increment`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // §9 / `CoachOS-Client.dc.html` — keys at the outer edges, value centred
  // between them, `gap: 14`.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(14),
  },
  valueArea: {
    flex: 1,
  },
  valueInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wraps rather than truncates: at 200% text a four-digit calorie value
  // drops its unit to a second line instead of colliding with a key.
  valueLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing(6),
  },
});

// Everything the stepper draws that follows the scheme. The layout above
// does not, so it stays at module scope where it costs nothing.
const useThemedStyles = createThemedStyles((theme) => ({
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: KEY_RADIUS,
    borderColor: theme.control.borderBright,
    // Clips the faked inset hairline to the radius. `hitSlop` sits on the
    // outer pressable, so this does not shrink the tap area.
    overflow: 'hidden',
  },
  keySurface: {
    backgroundColor: theme.control.surface,
  },
  keySurfaceDisabled: {
    backgroundColor: theme.control.surfaceDisabled,
  },
  keyHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.control.stepperHighlight,
  },
  valueInput: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: theme.colors.fg.bright,
    fontFamily: fontFamily['display-bold'],
    fontVariant: ['tabular-nums'],
  },
}));
