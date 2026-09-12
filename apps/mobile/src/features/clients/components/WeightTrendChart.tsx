import {
  CHART_MIN_SPAN,
  Card,
  LineChart,
  Metric,
  Text,
  spacing,
  type ChartPoint,
} from '@coachos/ui';
import { diffCalendarDays, formatWeight, kgToLb, type WeightUnit } from '@coachos/utils';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { WeightTrendPoint } from '../api.ts';

// §8.3's weight trend, over `packages/ui`'s `LineChart`.
//
// **Weekly averages, never a raw daily plot** — DB§22's cookbook query is
// what the server runs and this component draws exactly what it returns.
// Day-to-day body weight is mostly water: a daily line shows a coach a
// 1.2kg "gain" that was a salty dinner, and they read it as data. The
// eyebrow says "weekly average" out loud for the same reason.
//
// ⚠️ The task's Files table says this wraps `victory-native`. That is stale:
// `CLAUDE.md` §3.1 rejected victory-native outright and `LineChart` is
// hand-drawn on Skia in `packages/ui`. Nothing is installed here.

/**
 * One week to the next is exactly 7 days (`date_trunc('week', …)`), so the
 * default 3-day cadence would break every segment of a perfectly regular
 * series. 7 joins consecutive weeks and breaks on a skipped one — which is
 * the honest picture: a solid line across a fortnight with no weigh-in is
 * progress that was never measured (`packages/ui`'s chart contract).
 */
const WEEKLY_GAP_DAYS = 7;

export interface WeightTrendChartProps {
  points: readonly WeightTrendPoint[];
  /** The COACH's display preference. Storage is always kg (`CLAUDE.md` §0). */
  unit: WeightUnit;
  testID?: string;
}

export function WeightTrendChart({ points, unit, testID }: WeightTrendChartProps) {
  const chartPoints = useMemo<ChartPoint[]>(
    () =>
      points.map((point) => ({
        dateISO: point.weekStartISO,
        // `formatWeight` is the one place a stored kilogram becomes a
        // displayed number (`packages/utils`) — read back as a number so the
        // chart's own axis, dot and spoken summary all agree with the value
        // printed above them rather than rounding a second time.
        value: Number(formatWeight(point.weightKg, unit)),
      })),
    [points, unit],
  );

  const latest = points.at(-1) ?? null;
  const first = points[0] ?? null;

  return (
    <Card density="coach" testID={testID ?? 'weight-trend'}>
      <Text size="eyebrow" tone="muted">
        WEIGHT · WEEKLY AVERAGE
      </Text>

      <View style={styles.headline}>
        {latest === null ? (
          // A reserved line, not a dash: the empty chart below already says
          // there are no weigh-ins, and saying it twice reads as a bug.
          <Text size="body-sm" tone="muted">
            {' '}
          </Text>
        ) : (
          <>
            <Metric value={formatWeight(latest.weightKg, unit)} unit={unit} size="stat" />
            {first === null || first === latest ? null : (
              <Text size="caption" tone="muted" style={styles.delta}>
                {describeDelta(first, latest, unit)}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={styles.chart}>
        <LineChart
          series={[
            {
              points: chartPoints,
              label: 'Weight',
              unit,
              unitLabel: unit === 'lb' ? 'pounds' : 'kilograms',
              // The floor on the vertical window. A pure scale factor with
              // no offset, so a SPAN converts exactly as a value does.
              minSpan:
                unit === 'lb' ? kgToLb(CHART_MIN_SPAN.bodyWeightKg) : CHART_MIN_SPAN.bodyWeightKg,
              gapDays: WEEKLY_GAP_DAYS,
            },
          ]}
          emptyState={
            <Text size="body-sm" tone="muted">
              No weigh-ins yet
            </Text>
          }
        />
      </View>
    </Card>
  );
}

/**
 * "−2.1 kg over 24 weeks". A fact, with **no arrow and no colour** — the
 * product does not know whether a client losing weight is progress or a
 * problem, and colouring it would be a judgement it is not qualified to
 * make (`DESIGN.md` §10.1/§10.4, `product-copy` §2).
 *
 * The span is measured from the data rather than stated as the query's
 * six-month window: a client eight weeks in has eight weeks of line, and
 * "over 6 months" over it would be a number the chart does not show.
 *
 * A true minus sign (U+2212), not a hyphen: against tabular numerals a
 * hyphen sits at a different height and reads as a dash.
 */
export function describeDelta(
  first: WeightTrendPoint,
  latest: WeightTrendPoint,
  unit: WeightUnit,
): string {
  // The difference of the two numbers the coach can see, not of the two
  // stored values — so the delta always reconciles with the figures either
  // side of it. `PRECISION` is `formatWeight`'s own rounding re-applied to
  // that difference; it cleans binary float noise (80.5 − 78.4 =
  // 2.0999999999999996) and decides nothing.
  const precision = unit === 'lb' ? 1 : 10;
  const raw =
    Number(formatWeight(latest.weightKg, unit)) - Number(formatWeight(first.weightKg, unit));
  const delta = Math.round(raw * precision) / precision;

  const weeks = Math.max(
    1,
    Math.round(diffCalendarDays(first.weekStartISO, latest.weekStartISO) / 7),
  );
  const span = `over ${String(weeks)} ${weeks === 1 ? 'week' : 'weeks'}`;

  if (delta === 0) {
    return `No change ${span}`;
  }

  return `${delta > 0 ? '+' : '−'}${String(Math.abs(delta))} ${unit} ${span}`;
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing(8) },
  delta: { marginBottom: spacing(3) },
  chart: { marginTop: spacing(6) },
});
