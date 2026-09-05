import { macroKcal, type MacroGrams } from '@coachos/utils';
import { StyleSheet, View } from 'react-native';

import { colors, dataviz, radius, spacing, type Density } from '../theme/tokens.ts';

import { Metric } from './Metric.tsx';
import { Text } from './Text.tsx';

/**
 * `DESIGN.md` §1.1's warm ramp, used exactly as §1.1 prescribes for a
 * multi-series graphic: "the palette's single accent cannot carry a
 * multi-series chart", so the three macros take the primary, second, and
 * third series stops. They are ordered by lightness, which is what makes the
 * bar survive greyscale — and the `P` / `C` / `F` labels beneath are the
 * second, non-colour channel §8 requires regardless.
 *
 * None of these is `colors.state.*`. A macro split is not an adherence
 * signal: a coach scanning thirty rows must not read a fat-heavy day as an
 * off-track client (`ui-primitives-data/02`).
 */
const SEGMENT_COLOR = {
  protein: colors.brand.DEFAULT,
  carbs: colors.brand.mid,
  fat: colors.brand.deep,
} as const;

// §7 — "Progress bar: height 5–8px, radius 3–4". The client app takes the
// top of that range because it is read at arm's length mid-day; the coach
// app takes the bottom because thirty of them stack on one screen (§1.3).
const BAR_HEIGHT: Record<Density, number> = { client: 8, coach: 6 };

// §7's target reference line: `#3F4B62`, the same muted over-target colour
// the ring uses. The prototype dashes it `3 5`; at 6–8px tall a dash reads as
// a gap rather than a line, so it renders solid at this size.
const MARKER_WIDTH = 2;

/**
 * Below this share of the bar, a segment's label is narrower than the two
 * characters it would have to render and collides with its neighbour. The
 * full breakdown is always in the `accessibilityLabel`, so nothing is lost —
 * and at least one segment always clears it, because three fractions summing
 * to 1 cannot all be under a third.
 */
const MIN_LABEL_FRACTION = 0.14;

export type MacroSegments = {
  proteinFraction: number;
  carbsFraction: number;
  fatFraction: number;
  proteinKcal: number;
  carbsKcal: number;
  fatKcal: number;
  totalKcal: number;
};

/**
 * The segment widths, as fractions of the filled portion of the bar.
 *
 * **Proportional to calories contributed, not to grams.** 40g of fat is
 * visually twice 40g of protein on a plate and in a diary; a bar drawn on
 * grams tells a client their high-fat day was balanced. The segments
 * therefore deliberately do not match the gram numbers printed beneath them —
 * that is the design, not a bug (`ui-primitives-data/02` risks §4). The 4/4/9
 * conversion is `macroKcal()` in `@coachos/utils`, never inlined here.
 *
 * The three fractions sum to exactly 1 whenever anything was eaten, and to
 * exactly 0 on an untouched day — the remainder is folded into the last
 * non-zero segment rather than left to floating point, so the bar never
 * shows a hairline of track down its right edge.
 */
export function macroBarSegments(grams: MacroGrams): MacroSegments {
  const { proteinKcal, carbsKcal, fatKcal, totalKcal } = macroKcal(grams);

  if (totalKcal <= 0) {
    return {
      proteinFraction: 0,
      carbsFraction: 0,
      fatFraction: 0,
      proteinKcal,
      carbsKcal,
      fatKcal,
      totalKcal,
    };
  }

  const proteinFraction = proteinKcal / totalKcal;
  const carbsFraction = carbsKcal / totalKcal;

  return {
    proteinFraction,
    carbsFraction,
    // The remainder, parenthesised: `1 - (a + b)` is the form that sums back
    // to exactly 1 in IEEE 754, where `1 - a - b` does not.
    fatFraction: 1 - (proteinFraction + carbsFraction),
    proteinKcal,
    carbsKcal,
    fatKcal,
    totalKcal,
  };
}

export type MacroBarFill = {
  /** 0–1. How much of the bar's width the segments occupy. */
  fillFraction: number;
  /** 0–1, or `null` when no target was given. Where the target reference line sits. */
  markerFraction: number | null;
};

/**
 * §7's overflow rule for a bar, which is the ring's rule in a different
 * shape. Under target, the bar's full width is the target and the segments
 * fill part of it. Over target, the segments **compress** to fill the whole
 * bar and the marker moves inside it. Nothing turns red and nothing
 * overflows the container.
 */
export function macroBarFill(totalKcal: number, targetKcal?: number | null): MacroBarFill {
  const hasTarget = typeof targetKcal === 'number' && Number.isFinite(targetKcal) && targetKcal > 0;
  const total = Number.isFinite(totalKcal) && totalKcal > 0 ? totalKcal : 0;

  if (!hasTarget) {
    // No target: the bar answers "how was this day composed", so the
    // composition owns the full width. An empty day owns none of it.
    return { fillFraction: total > 0 ? 1 : 0, markerFraction: null };
  }

  if (total <= targetKcal) {
    return { fillFraction: total / targetKcal, markerFraction: 1 };
  }

  return { fillFraction: 1, markerFraction: targetKcal / total };
}

export interface MacroBarProps {
  /** Grams of protein. Already a finished number — this component computes no totals. */
  proteinG: number;
  carbsG: number;
  fatG: number;
  /**
   * The coach-set calorie target. Omit it and the bar shows composition only:
   * three segments across the full width, no reference line.
   */
  targetKcal?: number | null;
  density?: Density;
  /**
   * Hides the `P` / `C` / `F` gram row. Only for a bar that already sits
   * beside the same three numbers — never to make a row denser, because the
   * labels are §8's non-colour channel.
   */
  hideLabels?: boolean;
  testID?: string;
}

/**
 * How one day was composed, as three proportional segments. `DESIGN.md` §7's
 * progress bar: a recessed track, a rounded fill, and §7's muted reference
 * line where the target sits.
 *
 * **Three views, never a canvas.** A diary is a FlashList of day rows and
 * §19 requires ≥55fps on it; a Skia surface per row means a GPU surface
 * allocated and recycled on every scroll frame. Three rectangles are three
 * rectangles. If you are here to "unify" this with `ProgressRing`, read the
 * two-component boundary in `ui-primitives-data/02` first — one answers "how
 * much of this target is left", the other "how was this day composed", and
 * they share a prop bag rather than a purpose.
 */
export function MacroBar({
  proteinG,
  carbsG,
  fatG,
  targetKcal = null,
  density = 'client',
  hideLabels = false,
  testID,
}: MacroBarProps) {
  const segments = macroBarSegments({ proteinG, carbsG, fatG });
  const { fillFraction, markerFraction } = macroBarFill(segments.totalKcal, targetKcal);

  const height = BAR_HEIGHT[density];
  const parts = [
    { key: 'protein', grams: proteinG, fraction: segments.proteinFraction, glyph: 'P' },
    { key: 'carbs', grams: carbsG, fraction: segments.carbsFraction, glyph: 'C' },
    { key: 'fat', grams: fatG, fraction: segments.fatFraction, glyph: 'F' },
  ] as const;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={buildLabel({ proteinG, carbsG, fatG }, segments.totalKcal, targetKcal)}
      accessibilityValue={
        markerFraction === null
          ? undefined
          : { min: 0, max: round(targetKcal ?? 0), now: round(segments.totalKcal) }
      }
      testID={testID}
      style={styles.container}
    >
      <View style={[styles.track, { height, borderRadius: radius.cell }]}>
        <View style={[styles.fill, { width: toPercent(fillFraction) }]}>
          {parts.map((part) =>
            part.fraction > 0 ? (
              // `flexGrow`, not a percentage width: Yoga distributes the
              // container's full width across the three, so no sub-pixel
              // rounding gap of track shows between segments or at the fill's
              // right edge — whatever the three fractions round to.
              <View
                key={part.key}
                style={{
                  flexGrow: part.fraction,
                  flexBasis: 0,
                  backgroundColor: SEGMENT_COLOR[part.key],
                }}
              />
            ) : null,
          )}
        </View>
        {markerFraction === null ? null : (
          <View
            pointerEvents="none"
            style={[
              styles.marker,
              { left: toPercent(markerFraction), width: MARKER_WIDTH, marginLeft: -MARKER_WIDTH },
            ]}
          />
        )}
      </View>

      {hideLabels ? null : (
        // The legend sits under the FILLED portion at the segments' own
        // proportions, so each label lands beneath the segment it names. The
        // gate is on the label's real width in the bar — a 20%-of-fill
        // segment on a 30%-filled bar is 6% of the row, which is narrower
        // than the two characters it would have to render.
        <View style={[styles.labels, { width: toPercent(fillFraction) }]}>
          {parts.map((part) => (
            <View key={part.key} style={{ flexGrow: part.fraction, flexBasis: 0 }}>
              {part.fraction * fillFraction >= MIN_LABEL_FRACTION ? (
                <View style={styles.label}>
                  <Text size="micro" tone="subtle">
                    {part.glyph}
                  </Text>
                  <Metric value={round(part.grams)} unit="g" size="micro" tone="muted" />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function toPercent(fraction: number): `${number}%` {
  return `${fraction * 100}%`;
}

/**
 * `accessibility` §8 — a food diary is a long list of similar rows, and each
 * must read as one item rather than five fragments. The grams are spelled
 * out because the printed labels are abbreviated to single letters, and the
 * calorie total is included because it, not the grams, is what sized the
 * segments.
 */
function buildLabel(
  { proteinG, carbsG, fatG }: MacroGrams,
  totalKcal: number,
  targetKcal: number | null | undefined,
): string {
  const grams =
    `protein ${round(proteinG)} grams, ` +
    `carbohydrate ${round(carbsG)} grams, ` +
    `fat ${round(fatG)} grams`;

  if (typeof targetKcal === 'number' && Number.isFinite(targetKcal) && targetKcal > 0) {
    return `${grams}. ${round(totalKcal)} of ${round(targetKcal)} kilocalories`;
  }

  return `${grams}. ${round(totalKcal)} kilocalories`;
}

/** Clamped the same way `macroKcal` clamps, so a bad upstream value never reaches a screen reader as "NaN grams". */
function round(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

const styles = StyleSheet.create({
  container: {
    gap: spacing(5),
  },
  // §7 — the recessed well the fill sits in. `overflow: hidden` is what
  // rounds the segments' outer corners without giving each of the three its
  // own radius, which would round their shared edges too.
  track: {
    width: '100%',
    backgroundColor: dataviz.barTrack,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  fill: {
    flexDirection: 'row',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: dataviz.overTarget,
  },
  labels: {
    flexDirection: 'row',
  },
  label: {
    flexDirection: 'row',
    // Wraps rather than overflowing its segment: at 200% text "P" and "140 g"
    // are wider than the share of the bar the segment owns
    // (`accessibility` §3).
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing(3),
  },
});
