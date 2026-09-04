import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, dataviz } from '../theme/tokens.ts';

import {
  DEFAULT_GAP_DAYS,
  calendarDayNumber,
  chartSeriesShape,
  chartTrend,
  type ChartPoint,
  type ChartTrend,
} from './chartDomain.ts';

/** `CoachOS-Coach.dc.html`'s working-weights row: a `76×26` mark, `2` stroke. */
const DEFAULT_WIDTH = 76;
const DEFAULT_HEIGHT = 24;

/**
 * The cap. A client's row is ~100px wide; four hundred segments drawn into
 * it are four hundred segments nobody can see, on a screen budgeted at
 * ≥55fps over 100 rows (`CLAUDE.md` §19). The OLDEST points are dropped —
 * a row-level spark is about the recent shape, and the full history is one
 * tap away on the detail screen.
 */
const MAX_POINTS = 60;

const TREND_WORD: Record<ChartTrend, string> = {
  up: 'trending up',
  flat: 'unchanged',
  down: 'trending down',
};

export interface SparklineProps {
  /** In date order. `value: null` breaks the line, exactly as in `LineChart`. */
  points: readonly ChartPoint[];
  /** `DESIGN.md` §9's list row leaves 24–26px for the mark. */
  height?: number;
  width?: number;
  /** Cadence, in days. A hole wider than this breaks the line. */
  gapDays?: number;
  /**
   * Overrides the direction stated in the spoken label. It never changes
   * the COLOUR: §7 draws every row spark in `#FFA586` regardless of
   * direction, and §10.4 is explicit that a flat number gets no arrow and
   * no colour. Pass it only when the row's own delta was computed
   * elsewhere and the two must agree.
   */
  trend?: ChartTrend;
  /**
   * What the line is, spoken: `"Bench press working weight"`. A mark with
   * no label is noise in the reading order; a mark with one is the row's
   * trend in a word.
   */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * One line, in a list row. No axes, no labels, no touch, no state, no
 * effect, no animation — every capability it does not have is a capability
 * that cannot cost a frame on the coach dashboard.
 *
 * **Do not unify this with `LineChart` behind a `variant` prop.** That
 * would pull the full chart's imports, handlers, and layout state into
 * every one of a hundred rows, which is the entire reason this file exists
 * separately (`ui-primitives-data/04` approach §5).
 *
 * **It will not grow a tooltip.** Somebody will want to tap it. That turns
 * a 100-row list into 100 gesture handlers, and the row is already tappable
 * and already goes to the detail screen, where the full chart lives.
 *
 * The gap rule holds here too: a hole wider than the cadence simply breaks
 * the line. At 24px tall a dashed bridge is invisible, so the honest
 * treatment is to draw nothing rather than something unreadable — either
 * way, no segment asserts progress that did not happen.
 */
export const Sparkline = memo(function Sparkline({
  points,
  height = DEFAULT_HEIGHT,
  width = DEFAULT_WIDTH,
  gapDays = DEFAULT_GAP_DAYS,
  trend,
  accessibilityLabel,
  testID,
}: SparklineProps) {
  const capped = useMemo(
    () => (points.length > MAX_POINTS ? points.slice(points.length - MAX_POINTS) : points),
    [points],
  );

  const path = useMemo(() => {
    const shape = chartSeriesShape(capped, gapDays);
    if (shape.plotted.length === 0) return null;

    const values = shape.plotted
      .map((index) => capped[index]?.value)
      .filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return null;

    // No `minSpan` here, and that is deliberate: a row spark is a SHAPE,
    // read at 76×24 beside a number that carries the magnitude. The
    // `minSpan` floor exists to stop a full chart exaggerating a 200g
    // change into a cliff; at this size there is no scale to exaggerate,
    // and a floor would flatten every row into the same straight line.
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;

    const inset = dataviz.sparkStroke;
    const innerWidth = Math.max(width - inset * 2, 1);
    const innerHeight = Math.max(height - inset * 2, 1);
    const dayMin = shape.dayMin;
    const dayspan = shape.dayMax - shape.dayMin;

    const built = Skia.Path.Make();
    let drew = false;

    for (const run of shape.runs) {
      let started = false;
      for (const index of run) {
        const point = capped[index];
        if (point?.value == null) continue;
        const day = calendarDayNumber(point.dateISO);
        if (day === null) continue;

        const x = inset + (dayspan <= 0 ? 0.5 : (day - dayMin) / dayspan) * innerWidth;
        // A flat series sits on the centre line, not on the floor — a line
        // pinned to the bottom edge reads as "at zero".
        const y = inset + (1 - (span <= 0 ? 0.5 : (point.value - min) / span)) * innerHeight;

        if (started) {
          built.lineTo(x, y);
        } else {
          built.moveTo(x, y);
          started = true;
        }
        drew = true;
      }
    }

    return drew ? built : null;
  }, [capped, gapDays, width, height]);

  const direction = trend ?? chartTrend(capped);
  const label =
    accessibilityLabel === undefined
      ? undefined
      : direction === null
        ? `${accessibilityLabel}, no entries yet`
        : `${accessibilityLabel}, ${TREND_WORD[direction]}`;

  return (
    <View
      testID={testID}
      style={[styles.root, { width, height }]}
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? undefined : 'image'}
      accessibilityLabel={label}
      // An unlabelled mark is decorative, and decorative elements are noise
      // in the reading order (`accessibility` §2).
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
    >
      {path === null ? null : (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path
            path={path}
            style="stroke"
            strokeWidth={dataviz.sparkStroke}
            strokeCap="round"
            strokeJoin="round"
            color={colors.brand.DEFAULT}
          />
        </Canvas>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flexGrow: 0,
    flexShrink: 0,
  },
});
