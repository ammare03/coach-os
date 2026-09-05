import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { type TextSize } from '../theme/tokens.ts';
import { useBoxTextScale } from '../theme/useBoxTextScale.ts';
import { useTheme } from '../theme/useTheme.ts';

import { Metric } from './Metric.tsx';
import { Text } from './Text.tsx';

export type ProgressRingSize = 'sm' | 'md' | 'lg';

/**
 * `DESIGN.md` §7 draws the ring at `r:52` inside a `120` box with a
 * `12–13` stroke. Both are kept as RATIOS of the diameter rather than as
 * three hand-tuned pixel triples, so the `sm` ring is the same graphic
 * scaled down and not a second design — and so the arithmetic below has one
 * geometry to reason about.
 */
const RADIUS_RATIO = 52 / 120;
const STROKE_RATIO = 13 / 120;

/** §7's overflow arc: thinner than the value sweep, and set one stroke width inside it. */
const EXCESS_STROKE_FACTOR = 0.6;

const DIAMETER: Record<ProgressRingSize, number> = {
  /** A habit row or a dense stat tile. Below this the sweep stops being readable at arm's length. */
  sm: 48,
  /** The default — a macro ring beside its siblings. */
  md: 80,
  /** The one-per-screen hero: the client's calorie budget. */
  lg: 120,
};

// §1.2's scale, picked so the widest realistic value (a four-digit calorie
// total) clears the inner diameter at each size. `sm` renders no sub-line at
// all — 28px of clear space fits a number or a word, not both — and the
// screen reader gets the full sentence either way.
const VALUE_SIZE: Record<ProgressRingSize, TextSize> = {
  sm: 'caption',
  md: 'h2',
  lg: 'stat',
};

const SUBLINE_SIZE: TextSize = 'micro';

/**
 * The ring grows with the OS text scale, capped at 2x. A fixed-diameter ring
 * with a scaling numeral inside it is the clipping bug `accessibility` §3
 * describes ("min-height, not height — let it grow"), and there is no way to
 * shrink the numeral instead without giving `Metric` a font-scale escape
 * hatch, which would then be reachable from every other number in the
 * product. 2x is the ceiling the acceptance criterion names; past it the
 * numeral outgrows the ring again rather than the ring outgrowing the phone.
 */
const MAX_RING_SCALE = 2;

export type ProgressRingSweep = {
  /** No usable target: render the track alone. Never a full ring, never `NaN`. */
  isIndeterminate: boolean;
  /** 0–1. The main sweep, capped at a full circle (§7's overflow rule). */
  fraction: number;
  /** 0–1. Everything past the target, drawn as a second inset arc. 0 when at or under target. */
  excessFraction: number;
  /** Rounded whole percent, for the spoken label. `null` when indeterminate. */
  percent: number | null;
};

/**
 * The two arithmetic cases that produce a crash or a lie, guarded once.
 *
 * A `target` of `0`, `null`, or anything non-finite is **indeterminate**, not
 * "complete": dividing by it yields `Infinity`, and a silently full ring
 * tells a client they have hit a target their coach never set. A `value` of
 * `0` is a genuinely empty track — the sweep is omitted entirely rather than
 * drawn at zero length, because a round-capped zero-length arc paints a dot
 * that reads as "a bit of progress" from arm's length.
 *
 * Exported so the arithmetic is testable without a Skia surface, and so
 * `04-line-chart` and the habit rings can reuse the same overflow rule
 * rather than re-deciding it.
 */
export function progressRingSweep(
  value: number,
  target: number | null | undefined,
): ProgressRingSweep {
  const hasTarget = typeof target === 'number' && Number.isFinite(target) && target > 0;
  if (!hasTarget) {
    return { isIndeterminate: true, fraction: 0, excessFraction: 0, percent: null };
  }

  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const ratio = safeValue / target;

  return {
    isIndeterminate: false,
    fraction: Math.min(ratio, 1),
    excessFraction: Math.min(Math.max(ratio - 1, 0), 1),
    percent: Math.round(ratio * 100),
  };
}

export interface ProgressRingProps {
  /**
   * Already converted for display, and named for its unit at the CALL site
   * (`caloriesKcal`, `proteinG` — `CLAUDE.md` §17.2). This component receives
   * a finished number: it does not convert, round, or compute a total.
   */
  value: number;
  /**
   * The coach-set target. `null` renders the indeterminate track — a client
   * with no macro target set is not a client at 0%.
   */
  target?: number | null;
  /** The unit symbol shown under the value, e.g. `"g"`, `"kcal"`. */
  unit?: string;
  /** A word under the value beside the unit, e.g. `"protein"`, `"left"`. Hidden at `sm`. */
  label?: string;
  size?: ProgressRingSize;
  /**
   * Forces the track-only state even when a target exists — for a value that
   * is still loading or still syncing. A spinner would be wrong here
   * (`DESIGN.md` §5 forbids "spinners where a skeleton belongs"), and an
   * animated sweep would be a second thing to read.
   */
  isIndeterminate?: boolean;
  /**
   * How the unit is SPOKEN: `"grams"`, not `"g"`. `accessibility` §2 — a stat
   * announces its value and its unit as words. Defaults to `unit`.
   */
  unitLabel?: string;
  testID?: string;
}

/**
 * One value against one target, as an arc. `DESIGN.md` §7: `r:52` in a `120`
 * box, `13` stroke, remainder in the ring track, value in `brand`, round
 * caps, starting at twelve o'clock and sweeping clockwise.
 *
 * **Over target is not a failure.** Above 100% the sweep caps at a full
 * circle and a second, inset arc shows the excess in §7's muted over-target
 * colour; the number keeps counting past the target. Nothing turns red —
 * §8 reserves the urgent hue for adherence, and a client in a muscle-gain
 * phase is *supposed* to exceed a maintenance number.
 *
 * **Do not put this in a list row.** It allocates a GPU surface per instance;
 * a diary is a FlashList of day rows and thirty of them is thirty surfaces
 * recycled on every scroll frame (`CLAUDE.md` §19, ≥55fps). One value in a
 * row is a `MacroBar` or a bare `Metric`. If a ring genuinely belongs in a
 * scrolling list it must be `sm` and the list must be re-measured on a
 * physical mid-range Android.
 *
 * **Un-animated by design.** A sweep that fills on mount looks lovely once
 * and costs a frame budget on every re-render of a quick-add
 * (`ui-primitives-data/02` approach §6). Motion here belongs on a Reanimated
 * shared value, respecting reduced motion, and never in a row.
 */
export function ProgressRing({
  value,
  target = null,
  unit,
  label,
  size = 'md',
  isIndeterminate = false,
  unitLabel,
  testID,
}: ProgressRingProps) {
  // Skia paints take a colour prop, not a style, so these read from the
  // theme directly rather than through a themed `StyleSheet`.
  const { colors, dataviz } = useTheme();
  const sweep = progressRingSweep(value, target);
  const indeterminate = isIndeterminate || sweep.isIndeterminate;

  // `useBoxTextScale` folds the gallery's scale toggle in with the OS font
  // scale, so `component-gallery/02`'s 200% pass reaches the ring and not
  // only the numeral inside it. Same 2x ceiling either way.
  const scale = Math.min(useBoxTextScale(), MAX_RING_SCALE);
  const diameter = DIAMETER[size] * scale;
  const strokeWidth = diameter * STROKE_RATIO;
  const ringRadius = diameter * RADIUS_RATIO;
  const centre = diameter / 2;
  const excessStroke = strokeWidth * EXCESS_STROKE_FACTOR;
  const excessRadius = ringRadius - strokeWidth;

  const trackPath = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(centre, centre, ringRadius);
    return path;
  }, [centre, ringRadius]);

  // -90° is twelve o'clock in Skia's coordinate space, and a positive sweep
  // runs clockwise — `DESIGN.md` §7's `rotate(-90deg)` on the SVG, expressed
  // as a start angle instead of a transform.
  const valuePath = useMemo(() => {
    if (indeterminate || sweep.fraction <= 0) return null;
    const path = Skia.Path.Make();
    path.addArc(ovalOf(centre, ringRadius), -90, sweep.fraction * 360);
    return path;
  }, [centre, ringRadius, indeterminate, sweep.fraction]);

  const excessPath = useMemo(() => {
    if (indeterminate || sweep.excessFraction <= 0 || excessRadius <= 0) return null;
    const path = Skia.Path.Make();
    path.addArc(ovalOf(centre, excessRadius), -90, sweep.excessFraction * 360);
    return path;
  }, [centre, excessRadius, indeterminate, sweep.excessFraction]);

  const subline = [unit, label].filter(Boolean).join(' ');
  const showSubline = size !== 'sm' && subline.length > 0;
  const innerWidth = diameter - strokeWidth * 2;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={buildLabel({
        value,
        target,
        unit,
        unitLabel,
        label,
        sweep,
        indeterminate,
      })}
      accessibilityValue={
        indeterminate || target == null
          ? undefined
          : { min: 0, max: Math.round(target), now: Math.round(value) }
      }
      testID={testID}
      style={[styles.ring, { width: diameter, height: diameter }]}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={trackPath} style="stroke" strokeWidth={strokeWidth} color={dataviz.ringTrack} />
        {valuePath ? (
          <Path
            path={valuePath}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            color={colors.brand.DEFAULT}
          />
        ) : null}
        {excessPath ? (
          <Path
            path={excessPath}
            style="stroke"
            strokeWidth={excessStroke}
            strokeCap="round"
            color={dataviz.overTarget}
          />
        ) : null}
      </Canvas>

      <View style={[styles.centre, { maxWidth: innerWidth }]}>
        <Metric value={value} size={VALUE_SIZE[size]} tone={size === 'lg' ? 'bright' : 'default'} />
        {showSubline ? (
          <Text size={SUBLINE_SIZE} tone="muted">
            {subline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ovalOf(centre: number, radius: number) {
  return {
    x: centre - radius,
    y: centre - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

/**
 * `accessibility` §2 — value, target, unit, percentage, as a sentence. A ring
 * is invisible to a screen reader, and the number inside it announced alone
 * carries no context at all: "142" tells a client nothing they can act on.
 */
function buildLabel({
  value,
  target,
  unit,
  unitLabel,
  label,
  sweep,
  indeterminate,
}: {
  value: number;
  target: number | null | undefined;
  unit: string | undefined;
  unitLabel: string | undefined;
  label: string | undefined;
  sweep: ProgressRingSweep;
  indeterminate: boolean;
}): string {
  const spokenUnit = unitLabel ?? unit;
  const suffix = spokenUnit ? ` ${spokenUnit}` : '';
  const prefix = label ? `${label}, ` : '';

  if (indeterminate || target == null || sweep.percent === null) {
    // §10.5 — absence of a target is not a failure, and must not be
    // announced as 0%.
    return `${prefix}${value}${suffix}, no target set`;
  }

  return `${prefix}${value} of ${target}${suffix}, ${sweep.percent} percent`;
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    alignItems: 'center',
  },
});
