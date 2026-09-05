import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { radius, spacing, tapTarget } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import {
  CHART_MIN_SPAN,
  DEFAULT_GAP_DAYS,
  calendarDayNumber,
  chartAxisLabelIndices,
  chartSeriesShape,
  chartSummary,
  chartYDomain,
  formatAxisDate,
  formatSpokenDate,
  type ChartDomain,
  type ChartPoint,
  type ChartSeriesShape,
} from './chartDomain.ts';
import { Metric } from './Metric.tsx';
import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

export { CHART_MIN_SPAN };

/** `DESIGN.md` §7's chart canvas, before the labels above and below it. */
const DEFAULT_HEIGHT = 126;

/**
 * The prototypes' geometry, read off the two area charts in
 * `CoachOS-Client.dc.html` (viewBox `320×130`, axis `y=112`, points
 * `26–98`) and `CoachOS-Coach.dc.html` (`330×110`, axis `y=94`, points
 * `30–58`): the axis sits just above the canvas floor, and the plotted band
 * keeps a stroke-and-dot's headroom off both the axis and the ceiling so
 * the latest dot is never half-clipped.
 */
const AXIS_OFFSET = 4;
const PLOT_TOP = 14;
const PLOT_BOTTOM_GAP = 14;
const POINT_INSET = 8;

/**
 * Four to six x labels, never more, and fewer as the width shrinks. The
 * estimate is scaled by the OS text scale, so at 200% the labels REDUCE IN
 * COUNT rather than overlapping — rotating or shrinking them instead is the
 * clipping failure `accessibility` §3 describes, and a rotated axis label
 * at 200% is unreadable anyway.
 */
const MAX_AXIS_LABELS = 6;
const MIN_AXIS_LABELS = 2;
const LABEL_WIDTH_ESTIMATE = 58;

/**
 * One line on the chart. Every value is already converted for display and
 * named for its unit at the CALL site (`weightKg`, `energyScore` —
 * `CLAUDE.md` §17.2). This component does no fetching, no aggregation, no
 * unit conversion, and no rounding.
 */
export type LineChartSeries = {
  /** In date order. `value: null` is an explicit missing reading. */
  points: readonly ChartPoint[];
  /** What the line is: `"Weight"`, `"Energy"`. Shown, and spoken. */
  label: string;
  /** Printed beside the value: `"kg"`. */
  unit?: string;
  /** Spoken instead of `unit`: `"kilograms"` (`accessibility` §2). */
  unitLabel?: string;
  /**
   * The floor on the vertical window — `CHART_MIN_SPAN.bodyWeightKg`,
   * `.percent`, `.checkinScale`. Required, because the default that would
   * be right for weight is wrong for a 1–10 scale and a chart with the
   * wrong one lies (`chartDomain.ts`).
   */
  minSpan: number;
  /** Hard bounds of the metric itself — `{ min: 0, max: 100 }` for a percentage. */
  range?: { min?: number; max?: number };
  /** Cadence, in days. Readings further apart than this are not joined solid. */
  gapDays?: number;
  /**
   * The single dashed reference line §7 permits — a coach's target weight,
   * a target adherence. §7: "No gridlines beyond one reference line."
   * Drawn only for the first series, and only when it falls inside the
   * domain.
   */
  referenceValue?: number | null;
};

export type LineChartSelection = {
  seriesIndex: number;
  pointIndex: number;
  dateISO: string;
  value: number;
};

export interface LineChartProps {
  /**
   * One series, or two. **Not three** — §8.7 asks for exactly one overlay
   * (a check-in field against weight), and three lines on a 360dp chart
   * with two scales is unreadable. The tuple type is where that "no" lives,
   * so it is answered by the compiler and not in review.
   */
  series: readonly [LineChartSeries] | readonly [LineChartSeries, LineChartSeries];
  height?: number;
  /** Fired when a point is selected by touch. The screen decides what that means. */
  onPointPress?: (selection: LineChartSelection) => void;
  /**
   * Opens the same data as a list. A chart is invisible to a screen reader,
   * and the summary is a sentence, not the readings — this is how someone
   * using VoiceOver reaches their own history.
   */
  onRequestTable?: () => void;
  /** Rendered instead of the chart when nothing is plottable (§7.5). */
  emptyState?: ReactNode;
  testID?: string;
}

type ResolvedSeries = {
  source: LineChartSeries;
  shape: ChartSeriesShape;
  domain: ChartDomain | null;
  stroke: string;
  latest: { pointIndex: number; dateISO: string; value: number } | null;
};

/**
 * A line over time. `DESIGN.md` §7: `2.5` stroke in `#FFA586`, round
 * linecap and linejoin, an area fill from `stop-opacity .34` to `0`, a
 * `4.5r` `#FFFFFF` dot on the latest point, one solid axis line in
 * `#384358`, and at most one dashed `#3F4B62` reference line — no
 * gridlines, no legend where a label fits on the mark, no axis a coach
 * does not need.
 *
 * Two rules are not styling and are not optional:
 *
 * - **The y-domain never anchors at zero.** It pads around the data and is
 *   floored at `minSpan`, so 84.2kg → 82.1kg over eight weeks reads as
 *   progress and 200g over a week does not read as a cliff.
 * - **A line is never drawn through a gap.** A hole longer than the
 *   series' cadence renders dashed and dimmed. A solid segment across
 *   eleven silent days is a picture of steady progress that never happened,
 *   and the coach reads it as data.
 *
 * **No curve smoothing, ever.** A monotone spline through weigh-ins invents
 * intermediate values that look like measurements. Straight segments only.
 *
 * **Nothing animates.** §7 specifies a self-drawing stroke for this
 * graphic; `ui-primitives-data/04` overrides it, because this chart shares
 * the client-detail screen with a list of sparklines and motion on a value
 * a coach is reading is `DESIGN.md` §5's own forbidden list. If a draw-in
 * is added later it is a Reanimated worklet and it respects reduced motion.
 */
export function LineChart({
  series,
  height = DEFAULT_HEIGHT,
  onPointPress,
  onRequestTable,
  emptyState,
  testID,
}: LineChartProps) {
  const { fontScale } = useWindowDimensions();
  const { colors, dataviz } = useTheme();
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState<LineChartSelection | null>(null);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const resolved = useMemo<readonly ResolvedSeries[]>(
    () =>
      series.map((entry, index) => {
        const shape = chartSeriesShape(entry.points, entry.gapDays ?? DEFAULT_GAP_DAYS);
        const values = shape.plotted
          .map((pointIndex) => entry.points[pointIndex]?.value)
          .filter((value): value is number => typeof value === 'number');

        const lastIndex = shape.plotted[shape.plotted.length - 1];
        const lastPoint = lastIndex === undefined ? undefined : entry.points[lastIndex];

        return {
          source: entry,
          shape,
          domain: chartYDomain(values, {
            minSpan: entry.minSpan,
            min: entry.range?.min,
            max: entry.range?.max,
          }),
          // §1.1 — the single accent cannot carry two lines, so the second
          // series takes the interpolated mid-tone the palette provides
          // for exactly this.
          stroke: index === 0 ? colors.brand.DEFAULT : colors.brand.mid,
          latest:
            lastIndex === undefined || lastPoint?.value == null
              ? null
              : { pointIndex: lastIndex, dateISO: lastPoint.dateISO, value: lastPoint.value },
        } satisfies ResolvedSeries;
      }),
    [series, colors.brand],
  );

  // A shared x scale, so an overlay compares like with like. Two series
  // plotted on their own date ranges would put different weeks above each
  // other, which is the same class of lie as bridging a gap.
  const xRange = useMemo(() => {
    const mins = resolved
      .filter((entry) => entry.shape.plotted.length > 0)
      .map((e) => e.shape.dayMin);
    const maxes = resolved
      .filter((entry) => entry.shape.plotted.length > 0)
      .map((e) => e.shape.dayMax);
    if (mins.length === 0 || maxes.length === 0) return null;
    return { dayMin: Math.min(...mins), dayMax: Math.max(...maxes) };
  }, [resolved]);

  const primary = resolved[0];
  const hasData = resolved.some((entry) => entry.shape.plotted.length > 0);

  const summary = useMemo(
    () =>
      resolved
        .map((entry) =>
          chartSummary({
            label: entry.source.label,
            points: entry.source.points,
            unitLabel: entry.source.unitLabel ?? entry.source.unit,
            gapDays: entry.source.gapDays ?? DEFAULT_GAP_DAYS,
          }),
        )
        .join('. '),
    [resolved],
  );

  const plotHeight = Math.max(height, PLOT_TOP + PLOT_BOTTOM_GAP + AXIS_OFFSET + 1);
  const axisY = plotHeight - AXIS_OFFSET;
  const bandTop = PLOT_TOP;
  const bandBottom = axisY - PLOT_BOTTOM_GAP;
  const plotWidth = Math.max(width, 0);
  const innerWidth = Math.max(plotWidth - POINT_INSET * 2, 1);

  const xFor = useCallback(
    (dateISO: string): number => {
      if (xRange === null) return POINT_INSET;
      const day = calendarDayNumber(dateISO);
      if (day === null) return POINT_INSET;
      // A single date, or every reading on the same day: centred, not
      // pinned to the left edge where it reads as "the start of something".
      const span = xRange.dayMax - xRange.dayMin;
      const fraction = span <= 0 ? 0.5 : (day - xRange.dayMin) / span;
      return POINT_INSET + fraction * innerWidth;
    },
    [xRange, innerWidth],
  );

  const yFor = useCallback(
    (value: number, domain: ChartDomain | null): number => {
      if (domain === null || domain.span <= 0) return (bandTop + bandBottom) / 2;
      const fraction = (value - domain.min) / domain.span;
      return bandBottom - fraction * (bandBottom - bandTop);
    },
    [bandTop, bandBottom],
  );

  // Nearest-point snapping for the crosshair. The finger covers the point,
  // so the value is rendered in a FIXED position above the chart rather
  // than in a tooltip that follows the touch.
  //
  // The raw responder props rather than a `PanResponder`: all this needs is
  // `locationX`, and a `PanResponder` would additionally compute a centroid
  // and a velocity from the touch history on every move event, for a
  // gesture that snaps to at most forty positions.
  const handleScrub = useCallback(
    (event: GestureResponderEvent) => {
      const entry = resolved[0];
      if (entry === undefined || entry.shape.plotted.length === 0) return;
      const touchX = event.nativeEvent.locationX;

      let best: LineChartSelection | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const pointIndex of entry.shape.plotted) {
        const point = entry.source.points[pointIndex];
        if (point?.value == null) continue;
        const distance = Math.abs(xFor(point.dateISO) - touchX);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { seriesIndex: 0, pointIndex, dateISO: point.dateISO, value: point.value };
        }
      }
      // Bail before `setState` when the snap has not moved. A scrub across a
      // 40-point series fires hundreds of move events and has forty distinct
      // answers; re-rendering on the rest is the jitter §19 budgets against.
      if (best === null || best.pointIndex === selection?.pointIndex) return;
      setSelection(best);
      onPointPress?.(best);
    },
    [resolved, xFor, onPointPress, selection],
  );

  const clearScrub = useCallback(() => setSelection(null), []);

  const paths = useMemo(() => {
    if (plotWidth <= 0) return null;
    return resolved.map((entry, index) => buildSeriesPaths(entry, index, xFor, yFor, axisY));
  }, [resolved, plotWidth, xFor, yFor, axisY]);

  const axisLabels = useMemo(() => {
    const entry = resolved[0];
    if (entry === undefined || entry.shape.plotted.length === 0 || plotWidth <= 0) return [];
    const labelWidth = LABEL_WIDTH_ESTIMATE * Math.max(fontScale, 1);
    const capacity = Math.max(
      MIN_AXIS_LABELS,
      Math.min(MAX_AXIS_LABELS, Math.floor(plotWidth / labelWidth)),
    );
    return chartAxisLabelIndices(entry.shape.plotted.length, capacity).map((slot) => {
      const pointIndex = entry.shape.plotted[slot];
      const point = pointIndex === undefined ? undefined : entry.source.points[pointIndex];
      return { key: `${slot}`, label: point ? formatAxisDate(point.dateISO) : '' };
    });
  }, [resolved, plotWidth, fontScale]);

  if (!hasData || primary === undefined) {
    return (
      <View testID={testID} style={styles.root}>
        {emptyState ?? (
          <Text size="body-sm" tone="muted">
            {`No ${primary?.source.label.toLowerCase() ?? 'chart'} entries yet`}
          </Text>
        )}
      </View>
    );
  }

  const referenceValue = primary.source.referenceValue;
  const referenceY =
    referenceValue == null || primary.domain === null
      ? null
      : referenceValue >= primary.domain.min && referenceValue <= primary.domain.max
        ? yFor(referenceValue, primary.domain)
        : null;

  const crosshairX = selection === null ? null : xFor(selection.dateISO);

  return (
    <View testID={testID} style={styles.root}>
      {/* Every number here goes through `Metric` — the scrubbed value, the
          per-series scale, and the date axis — so nothing on the chart can
          change width as the finger moves (`ui-conventions` §3, and §1.2's
          tabular-numerals rule, which is the whole reason `Metric` exists).
          The value sits ABOVE the plot at a fixed position for the same
          reason: the finger covers the point.
          `tone="muted"`, never `subtle`, because these render at 11px and
          §13 allows `fg.subtle` at ≥14px only. */}
      {resolved.map((entry, index) => {
        const shown = index === 0 && selection !== null ? selection.value : entry.latest?.value;
        return (
          <View key={entry.source.label} style={styles.headerRow}>
            <View style={[styles.swatch, { backgroundColor: entry.stroke }]} />
            <Text size="eyebrow" tone="muted">
              {entry.source.label.toUpperCase()}
            </Text>
            {resolved.length > 1 && entry.domain !== null ? (
              <Metric
                value={`${round1(entry.domain.min)}–${round1(entry.domain.max)}`}
                size="micro"
                tone="muted"
              />
            ) : null}
            <View style={styles.spacer} />
            {shown === undefined ? null : (
              <Metric
                value={shown}
                {...(entry.source.unit === undefined ? {} : { unit: entry.source.unit })}
                size={index === 0 ? 'h2' : 'body-lg'}
                tone={index === 0 ? 'default' : 'warm'}
              />
            )}
          </View>
        );
      })}

      {/* The scrubbed date, in its own fixed slot, so nothing below it
          reflows as the finger moves. A non-breaking space, not an empty
          string: the slot has to keep its height when nothing is selected.
          Through `Metric` because it carries a number. */}
      <Metric
        value={selection === null ? ' ' : formatSpokenDate(selection.dateISO)}
        size="micro"
        tone="muted"
      />

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        onLayout={handleLayout}
        style={[styles.plot, { height: plotHeight }]}
        onStartShouldSetResponder={returnTrue}
        onMoveShouldSetResponder={returnTrue}
        onResponderGrant={handleScrub}
        onResponderMove={handleScrub}
        onResponderRelease={clearScrub}
        // Termination is ALLOWED: the chart sits in a scrolling screen, and
        // a mark that captures a vertical drag traps the page behind it.
        onResponderTerminate={clearScrub}
      >
        {plotWidth > 0 && paths !== null ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {/* §7 — one solid axis line, and no gridlines. */}
            <Path
              path={linePath(0, axisY, plotWidth, axisY)}
              style="stroke"
              strokeWidth={1}
              color={colors.border.DEFAULT}
            />

            {referenceY === null ? null : (
              <Path
                path={linePath(0, referenceY, plotWidth, referenceY)}
                style="stroke"
                strokeWidth={1}
                color={dataviz.overTarget}
              >
                <DashPathEffect intervals={[...dataviz.referenceDash]} />
              </Path>
            )}

            {paths.map((entry, index) => (
              <Group key={index}>
                {index === 0 && entry.area !== null ? (
                  <Path path={entry.area} style="fill">
                    <LinearGradient
                      start={vec(0, bandTop)}
                      end={vec(0, axisY)}
                      colors={[...dataviz.seriesFill]}
                    />
                  </Path>
                ) : null}

                {entry.bridges === null ? null : (
                  <Path
                    path={entry.bridges}
                    style="stroke"
                    strokeWidth={dataviz.seriesStroke}
                    strokeCap="round"
                    strokeJoin="round"
                    color={entry.stroke}
                    opacity={dataviz.gapOpacity}
                  >
                    <DashPathEffect intervals={[...dataviz.gapDash]} />
                  </Path>
                )}

                {entry.runs === null ? null : (
                  <Path
                    path={entry.runs}
                    style="stroke"
                    strokeWidth={dataviz.seriesStroke}
                    strokeCap="round"
                    strokeJoin="round"
                    color={entry.stroke}
                  />
                )}

                {entry.singles.map((point) => (
                  <Circle
                    key={`${index}-${point.x}-${point.y}`}
                    cx={point.x}
                    cy={point.y}
                    r={dataviz.seriesStroke}
                    color={entry.stroke}
                  />
                ))}

                {entry.latest === null ? null : (
                  <Circle
                    cx={entry.latest.x}
                    cy={entry.latest.y}
                    r={dataviz.latestPointRadius}
                    color={dataviz.latestPoint}
                  />
                )}
              </Group>
            ))}

            {crosshairX === null ? null : (
              <Path
                path={linePath(crosshairX, 0, crosshairX, axisY)}
                style="stroke"
                strokeWidth={1}
                color={dataviz.crosshair}
              />
            )}
          </Canvas>
        ) : null}
      </View>

      <View style={styles.axisRow}>
        {axisLabels.map((label) => (
          // Each label shrinks inside its own share of the row: at 200% text
          // three dates are wider than the plot, and without this they push
          // past the chart's own bounds instead of wrapping
          // (`accessibility` §3).
          <View key={label.key} style={styles.axisLabel}>
            <Metric value={label.label} size="micro" tone="muted" />
          </View>
        ))}
      </View>

      {onRequestTable === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Read ${primary.source.label.toLowerCase()} entries as a list`}
          onPress={onRequestTable}
          style={styles.tableAction}
        >
          <Text size="body-sm" tone="warm">
            Read as a list
          </Text>
        </Pressable>
      )}
    </View>
  );
}

type BuiltPaths = {
  stroke: string;
  runs: ReturnType<typeof Skia.Path.Make> | null;
  bridges: ReturnType<typeof Skia.Path.Make> | null;
  area: ReturnType<typeof Skia.Path.Make> | null;
  singles: { x: number; y: number }[];
  latest: { x: number; y: number } | null;
};

/**
 * Two passes, deliberately: the solid runs as one path, the gap bridges as
 * another. A single path with a dash pattern applied conditionally would
 * hide the gap rule inside a stroke setting; this way it is visible in the
 * code (`ui-primitives-data/04` approach §3).
 */
function buildSeriesPaths(
  entry: ResolvedSeries,
  index: number,
  xFor: (dateISO: string) => number,
  yFor: (value: number, domain: ChartDomain | null) => number,
  axisY: number,
): BuiltPaths {
  const runs = Skia.Path.Make();
  const bridges = Skia.Path.Make();
  const area = Skia.Path.Make();
  const singles: { x: number; y: number }[] = [];

  let hasRuns = false;
  let hasBridges = false;
  let hasArea = false;
  let areaStartX = 0;
  let areaEndX = 0;

  const coordsOf = (pointIndex: number): { x: number; y: number } | null => {
    const point = entry.source.points[pointIndex];
    if (point?.value == null) return null;
    return { x: xFor(point.dateISO), y: yFor(point.value, entry.domain) };
  };

  for (const run of entry.shape.runs) {
    const coords = run.map(coordsOf).filter((c): c is { x: number; y: number } => c !== null);
    const first = coords[0];
    if (first === undefined) continue;

    // A run of one is a dot, not a zero-length stroke: a round-capped
    // zero-length segment paints a blob that reads as a heavier reading.
    if (coords.length === 1) {
      singles.push(first);
    } else {
      runs.moveTo(first.x, first.y);
      for (let i = 1; i < coords.length; i += 1) {
        const next = coords[i];
        if (next === undefined) continue;
        runs.lineTo(next.x, next.y);
      }
      hasRuns = true;
    }

    if (index === 0) {
      if (!hasArea) {
        area.moveTo(first.x, axisY);
        areaStartX = first.x;
        hasArea = true;
      }
      for (const coord of coords) {
        area.lineTo(coord.x, coord.y);
        areaEndX = coord.x;
      }
    }
  }

  for (const [fromIndex, toIndex] of entry.shape.bridges) {
    const from = coordsOf(fromIndex);
    const to = coordsOf(toIndex);
    if (from === null || to === null) continue;
    bridges.moveTo(from.x, from.y);
    bridges.lineTo(to.x, to.y);
    hasBridges = true;
  }

  if (hasArea) {
    area.lineTo(areaEndX, axisY);
    area.lineTo(areaStartX, axisY);
    area.close();
  }

  const latestCoords = entry.latest === null ? null : coordsOf(entry.latest.pointIndex);

  return {
    stroke: entry.stroke,
    runs: hasRuns ? runs : null,
    bridges: hasBridges ? bridges : null,
    // The area follows the whole series, gaps included — a hole in the fill
    // would read as a second, absent metric. The LINE is what carries the
    // gap rule, and the fill sits at .34 opacity behind it.
    area: index === 0 && hasArea ? area : null,
    singles,
    latest: latestCoords,
  };
}

function returnTrue(): boolean {
  return true;
}

function linePath(x1: number, y1: number, x2: number, y2: number) {
  const path = Skia.Path.Make();
  path.moveTo(x1, y1);
  path.lineTo(x2, y2);
  return path;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const styles = StyleSheet.create({
  root: {
    gap: spacing(4),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(7),
    // Min-height, never height — a `Metric` at 200% OS text size has to be
    // able to grow the row rather than clip inside it (`accessibility` §3).
    minHeight: spacing(24),
  },
  // The colour identity of a series, so the overlay is not read by hue
  // alone — the label sits next to it (§8's second-channel rule).
  swatch: {
    width: spacing(10),
    height: spacing(3),
    borderRadius: radius.cell,
  },
  spacer: {
    flex: 1,
  },
  plot: {
    width: '100%',
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing(4),
    paddingHorizontal: spacing(6),
  },
  axisLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  tableAction: {
    minHeight: tapTarget.MIN,
    justifyContent: 'center',
  },
});
