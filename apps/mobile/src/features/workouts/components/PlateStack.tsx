import { Pressable, Text } from '@coachos/ui';
import {
  createThemedValue,
  duration as durationTokens,
  easing,
  spacing,
  tapTarget,
  useReducedMotion,
} from '@coachos/ui/theme';
import { formatWeight, resolvePlateLoad, type WeightUnit } from '@coachos/utils';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// `set-entry/02` — what is actually on the bar, drawn as mirrored pips in
// the composer's 20px context band, plus the one-tap line that appears when
// the requested weight is not makeable.
//
// **The maths is not here.** `resolvePlateLoad` lives in `packages/utils`
// (`code-conventions` §1) because the API computes the same breakdown; a
// second implementation in a component is the exact failure this task's
// Risks section names. This file reads its result and draws it.
//
// **The rack follows the client's unit** (Ammar, 11 Sep 2026). A client in
// an imperial gym is not loading 25 kg plates, so a lb client gets the US
// rack — 45/35/25/10/5/2.5 lb on a 45 lb bar — computed in pounds end to
// end. Kilograms are still what gets stored and what crosses this
// component's props; the unit picks a rack, never a storage format.
//
// **`plates` is already ONE SIDE.** It is never halved and never doubled —
// the mirror below renders the same array twice, once reversed. A client
// with gym experience sees a wrong breakdown instantly, and the per-side
// versus total confusion is the way it goes wrong.
//
// **Two components, because the design puts them in two places.** The pips
// sit inside the context band (left of `PreviousSetLine`); the nearest line
// sits *below* the band and is the only thing in this feature permitted to
// change the composer's height — 205px → 229px, resolved in one tap. Both
// take the same three inputs and resolve them through `resolvePlateStack`,
// so they can never disagree about whether a weight is makeable.
//
// **Nothing here waits for a network.** It is a pure function of the weight
// in the stepper, so there is no loading, pending, or error state — and a
// spinner in this band would be a lie about an offline calculation.

/** Marks one drawn plate. Not in the accessibility tree — the stack speaks for all of them. */
export const PLATE_PIP_TEST_ID = 'plate-stack-pip';

/** Every string this component says. Final copy, from the design's copy table. */
export const PLATE_STACK_COPY = {
  perSidePrefix: 'Plates per side:',
  bareBar: 'Just the bar',
  nearestPrefix: 'Nearest with these plates',
  under: 'under',
  over: 'over',
} as const;

export interface PlateStackProps {
  /**
   * `exercises.equipment` — free text at the DB (DB§4), so this is matched,
   * not switched on. Taken as a prop rather than inferred from the exercise
   * name, which is how a "Dumbbell bench press" ends up drawing a barbell.
   */
  equipment: string | null | undefined;
  /** The weight currently in the composer's stepper. Kilograms (DB§5.1.1). */
  weightKg: number;
  /**
   * `users.weight_unit` — which rack this client's gym has, not how the
   * weight is stored. Taken as a prop rather than read from a hook so the
   * slot's unit and this block's rack cannot drift apart, and so a caller
   * cannot silently fall back to metric for a lb client (the defect).
   */
  unit: WeightUnit;
  /** The bar being loaded, in kilograms. Defaults to the unit's own standard bar. */
  barbellWeightKg?: number;
}

export interface NearestWeightLineProps extends PlateStackProps {
  /** Tapping the line sets the composer's weight to the achievable load. */
  onSelectNearest: (weightKg: number) => void;
}

export type PlateStackState =
  | { kind: 'hidden' }
  | { kind: 'exact'; plates: number[]; achievableKg: number }
  | { kind: 'inexact'; plates: number[]; achievableKg: number; deltaKg: number };

/**
 * Whether a plate breakdown means anything for this equipment.
 *
 * Substring, because `exercises.equipment` is free text and the seed alone
 * carries `Incline Barbell`, `Close-Grip Barbell`, `Sumo Barbell` and four
 * more. `EZ-Bar`, `Trap Bar` and `T-Bar` deliberately do **not** match:
 * each has a different bar weight, so a stack drawn against the 20 kg
 * default would be confidently wrong. No breakdown beats a wrong one.
 */
export function isBarbellEquipment(equipment: string | null | undefined): boolean {
  return typeof equipment === 'string' && equipment.toLowerCase().includes('barbell');
}

/**
 * The one decision both components make, made once.
 *
 * `hidden` covers three different reasons the block is absent, all of which
 * render the same nothing: the equipment is not a barbell, the weight is
 * not a number, or the ask is below the bare bar. That last one is **not**
 * an "over" rounding case — `resolvePlateLoad` returns a negative remainder
 * there, and the design suppresses the block rather than telling a client
 * their 15 kg cannot be made on a 20 kg bar.
 *
 * `plates` come back in the **rack's** unit, which is `unit`: kilogram
 * plates for a kg client, pound plates for a lb one.
 */
export function resolvePlateStack({
  equipment,
  weightKg,
  unit,
  barbellWeightKg,
}: PlateStackProps): PlateStackState {
  if (!isBarbellEquipment(equipment)) return { kind: 'hidden' };
  // `resolvePlateLoad` throws a `RangeError` on either of these. A throw in
  // the context band would take the confirm button down with it, so the
  // guard is here rather than a boundary.
  if (!Number.isFinite(weightKg)) return { kind: 'hidden' };
  if (barbellWeightKg !== undefined && (!Number.isFinite(barbellWeightKg) || barbellWeightKg < 0)) {
    return { kind: 'hidden' };
  }

  const { plates, achievableKg, remainderKg } = resolvePlateLoad({
    weightKg,
    barbellWeightKg,
    unit,
  });
  if (remainderKg < 0) return { kind: 'hidden' };

  if (remainderKg === 0) return { kind: 'exact', plates, achievableKg };
  return { kind: 'inexact', plates, achievableKg, deltaKg: remainderKg };
}

/**
 * The mirrored pips. One accessible element with the plates spelled out —
 * a dozen separately-focusable rectangles would be a worse experience than
 * no stack at all (`accessibility` §2).
 *
 * Renders an empty view rather than `null` when nothing applies: the band
 * is `space-between`, and returning `null` would slide the previous-set
 * line across to where the plates belong.
 */
export function PlateStack(props: PlateStackProps) {
  const state = resolvePlateStack(props);
  const palette = usePlatePalette();
  const reducedMotion = useReducedMotion();
  const plates = state.kind === 'hidden' ? [] : state.plates;

  // The signature, not the array: a rebuild is what `DESIGN.md` §9 animates,
  // and two renders that resolve to the same plates are not one.
  const signature = state.kind === 'hidden' ? '' : plates.join('/');
  const rise = useSharedValue(0);

  useEffect(() => {
    // Restart from nothing so a changed stack rebuilds rather than sitting
    // already-arrived (`DESIGN.md` §9, "rebuilds on every change").
    rise.value = 0;
    // Reduced motion keeps the state change and drops the travel
    // (`accessibility` §6) — a shorter cross-fade, never a removal.
    rise.value = reducedMotion
      ? withTiming(1, { duration: durationTokens.press, easing: FADE_EASING })
      : withTiming(1, { duration: durationTokens.enter, easing: RISE_EASING });
    // `rise` is a shared value: stable identity, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, signature]);

  const riseStyle = useAnimatedStyle(() =>
    reducedMotion
      ? { opacity: rise.value }
      : {
          opacity: rise.value,
          transform: [
            { translateY: PIP_RISE_PX * (1 - rise.value) },
            { scale: 0.95 + 0.05 * rise.value },
          ],
        },
  );

  if (state.kind === 'hidden') return <View />;

  return (
    <Animated.View
      style={[styles.stack, riseStyle]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={labelPlates(plates, props.unit)}
    >
      {/* Outer plate first on the left, so the heaviest sits against the
          bar exactly as it does on a real rack. */}
      {[...plates].reverse().map((plate, index) => (
        <Pip key={`l${String(index)}`} rungKg={rungFor(plate, props.unit)} palette={palette} />
      ))}
      <LinearGradient
        colors={palette.bar}
        style={styles.bar}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {plates.map((plate, index) => (
        <Pip key={`r${String(index)}`} rungKg={rungFor(plate, props.unit)} palette={palette} />
      ))}
    </Animated.View>
  );
}

/**
 * The one-tap fix for a weight the rack cannot make. `button`, not a hint
 * on the stack: it performs an action, and a gesture with no visible,
 * labelled equivalent is not reachable (`accessibility` §7).
 */
export function NearestWeightLine({ onSelectNearest, ...props }: NearestWeightLineProps) {
  const state = resolvePlateStack(props);

  if (state.kind !== 'inexact') return null;

  const { achievableKg, deltaKg } = state;
  const copy = labelNearest(achievableKg, deltaKg, props.unit);

  return (
    <Pressable
      onPress={() => {
        onSelectNearest(achievableKg);
      }}
      accessibilityRole="button"
      accessibilityLabel={copy.spoken}
      // 20px of line inside the 44px floor, reached with hitSlop rather
      // than by growing the box — the band's height is load-bearing.
      hitSlop={Math.ceil((tapTarget.MIN - NEAREST_LINE_HEIGHT) / 2)}
      style={styles.nearest}
    >
      <Text size="micro" tone="warm">
        {copy.lead}
      </Text>
      <Text size="micro" tone="muted">
        {copy.delta}
      </Text>
    </Pressable>
  );
}

/**
 * The nearest line's three strings.
 *
 * `under` when the plates fall short, `over` when they overshoot. The
 * greedy loader only ever loads what fits, so `over` is unreachable through
 * `resolvePlateStack` today — it is here because the design's copy table
 * names both, and a different inventory must not be able to introduce the
 * wrong word silently.
 */
export function labelNearest(
  achievableKg: number,
  deltaKg: number,
  unit: WeightUnit,
): { lead: string; delta: string; spoken: string } {
  const achievable = printWeight(achievableKg, unit);
  const gap = printWeight(Math.abs(deltaKg), unit);
  const direction = deltaKg < 0 ? PLATE_STACK_COPY.over : PLATE_STACK_COPY.under;

  return {
    lead: `${PLATE_STACK_COPY.nearestPrefix} ${achievable} ${unit}`,
    delta: `· ${gap} ${unit} ${direction}`,
    spoken: `Set weight to ${speakWeight(achievableKg, unit)}, the nearest these plates make`,
  };
}

/**
 * `Plates per side: 25, 5 and 1.25 kilograms` · `Plates per side: 45, 25
 * and 10 pounds` — one utterance for the whole stack, every physical plate
 * named, in the unit of the rack it came off. Never a converted number: a
 * 25 kg plate read out as "55 pounds" would be a plate that does not exist,
 * and so would a 45 lb one read out in kilograms.
 */
function labelPlates(plates: number[], unit: WeightUnit): string {
  if (plates.length === 0) return PLATE_STACK_COPY.bareBar;

  const names = plates.map((plate) => String(plate));
  const last = names[names.length - 1] ?? '';
  const list = names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;

  return `${PLATE_STACK_COPY.perSidePrefix} ${list} ${PLATE_NOUN[unit]}`;
}

/**
 * Which rung of `DESIGN.md` §9's ladder a plate is drawn at.
 *
 * The ladder is keyed in kilograms because the drawn frames pin it that
 * way. An imperial plate takes the rung of the metric plate closest to its
 * actual mass — 45 lb is 20.4 kg, so it sits where the 20 kg plate sits —
 * which keeps height a channel for real mass rather than for a numeral.
 */
function rungFor(plate: number, unit: WeightUnit): number {
  return unit === 'lb' ? (LB_PLATE_RUNG_KG.get(plate) ?? plate) : plate;
}

function Pip({ rungKg, palette }: { rungKg: number; palette: PlatePalette }) {
  const size = PIP_SIZE.get(rungKg) ?? SMALLEST_PIP;
  const stop = palette.plate.get(rungKg) ?? palette.fallback;

  return (
    <LinearGradient
      testID={PLATE_PIP_TEST_ID}
      colors={stop.fill}
      style={[styles.pip, { width: size.width, height: size.height, borderColor: stop.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Display numeral, trailing `.0` dropped — `formatWeight` pads kg to one place. */
function printWeight(kg: number, unit: WeightUnit): string {
  return String(Number(formatWeight(kg, unit)));
}

/** `82.5 kilograms` · `180 pounds`. The numeral rounds exactly as the printed one does. */
function speakWeight(kg: number, unit: WeightUnit): string {
  const value = Number(formatWeight(kg, unit));
  const noun = PLATE_NOUN_SINGULAR[unit];
  return `${String(value)} ${value === 1 ? noun : `${noun}s`}`;
}

/** Spoken unit names, per rack. The abbreviations are `formatWeight`'s caller's job. */
const PLATE_NOUN_SINGULAR: Record<WeightUnit, string> = { kg: 'kilogram', lb: 'pound' };
const PLATE_NOUN: Record<WeightUnit, string> = { kg: 'kilograms', lb: 'pounds' };

// The US rack mapped onto the metric ladder by mass, heaviest to lightest.
// Six imperial plates, six of the seven metric rungs — the 25 kg rung has
// no imperial equivalent, so nothing is drawn at it.
const LB_PLATE_RUNG_KG = new Map<number, number>([
  [45, 20],
  [35, 15],
  [25, 10],
  [10, 5],
  [5, 2.5],
  [2.5, 1.25],
]);

const NEAREST_LINE_HEIGHT = 20;
const PIP_RISE_PX = 8;
const PIP_GAP_PX = 2;
const RISE_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const FADE_EASING = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

// `DESIGN.md` §9's plate ladder at the 20px scale the composer's context
// band allows, so the whole stack stays on one line. The 25 kg rung is the
// design's addition — §9 stops at 20 and a standard rack does not. Height
// is the channel that separates the rungs; width and warmth reinforce it.
const PIP_SIZE = new Map<number, { width: number; height: number }>([
  [25, { width: 6, height: 18 }],
  [20, { width: 6, height: 17 }],
  [15, { width: 5, height: 15 }],
  [10, { width: 5, height: 13 }],
  [5, { width: 4, height: 10 }],
  [2.5, { width: 3, height: 8 }],
  [1.25, { width: 3, height: 6 }],
]);

const SMALLEST_PIP = { width: 3, height: 6 };

interface PlateStop {
  fill: readonly [string, string];
  border: string;
}

interface PlatePalette {
  plate: Map<number, PlateStop>;
  fallback: PlateStop;
  bar: readonly [string, string];
}

// Composed from the scheme rather than the prototype's hexes so a coach's
// white-label brand carries through (P25) and the stack is not a second
// place the palette lives — the substitution `TodayCardArt` already makes
// for the same reason. The three rungs the built frames pin literally
// (25, 5, 1.25) resolve to exactly their drawn colours; the four between
// interpolate along §1.1's warm ramp so the stack reads heaviest-warmest.
const usePlatePalette = createThemedValue<PlatePalette>(({ colors }) => {
  const steel: PlateStop = {
    fill: [colors.border.strong, colors.bg.raised],
    border: colors.border.tinted,
  };

  return {
    plate: new Map<number, PlateStop>([
      [25, { fill: [colors.primary.from, colors.brand.DEFAULT], border: colors.primary.from }],
      [20, { fill: [colors.brand.lift, colors.brand.mid], border: colors.brand.lift }],
      [15, { fill: [colors.brand.DEFAULT, colors.brand.deep], border: colors.brand.DEFAULT }],
      [10, { fill: [colors.brand.mid, colors.brand.shade], border: colors.brand.mid }],
      [5, { fill: [colors.brand.mid, colors.border.strong], border: colors.brand.mid }],
      [2.5, { fill: [colors.brand.shade, colors.border.strong], border: colors.brand.shade }],
      [1.25, steel],
    ]),
    fallback: steel,
    bar: [colors.fg.warm, colors.brand.DEFAULT],
  };
});

const styles = StyleSheet.create({
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
    // Part of the glyph, like the pip widths below — not layout spacing, so
    // it is not on §1.4's scale, which starts at 3.
    columnGap: PIP_GAP_PX,
    // Shrinks rather than pushing the previous-set line out of the band on
    // an implausibly heavy lift. `minHeight`, never `height`: the band must
    // be free to grow with the type around it (`accessibility` §3).
    flexShrink: 1,
    minHeight: 18,
    overflow: 'hidden',
  },
  pip: {
    borderRadius: 2,
    borderWidth: 1,
  },
  bar: {
    width: 30,
    height: 3,
    borderRadius: 2,
    flexGrow: 0,
    flexShrink: 0,
  },
  nearest: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps rather than truncating at 200% text — the weight a client is
    // about to load is not something to drop off the end of a line.
    flexWrap: 'wrap',
    columnGap: spacing(6),
    minHeight: NEAREST_LINE_HEIGHT,
    marginTop: spacing(4),
  },
});
