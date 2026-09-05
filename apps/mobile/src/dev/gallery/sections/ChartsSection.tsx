import {
  CHART_MIN_SPAN,
  EmptyState,
  LineChart,
  Sparkline,
  Text,
  type ChartPoint,
  type LineChartSelection,
} from '@coachos/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { GallerySection } from '../GallerySection.tsx';
import { Specimen } from '../Specimen.tsx';

// A local calendar date per reading — never an instant. A Sunday-night
// weigh-in bucketed in the device's timezone lands on Monday for a coach in
// another country (`code-conventions` §6).
const WEIGHT_KG: readonly ChartPoint[] = [
  { dateISO: '2026-08-01', value: 82.4 },
  { dateISO: '2026-08-04', value: 82.1 },
  { dateISO: '2026-08-07', value: 81.6 },
  { dateISO: '2026-08-10', value: 81.8 },
  { dateISO: '2026-08-13', value: 81.1 },
  { dateISO: '2026-08-16', value: 80.7 },
  { dateISO: '2026-08-19', value: 80.9 },
  { dateISO: '2026-08-22', value: 80.2 },
];

// An explicit null is a missing reading, and a hole wider than `gapDays`
// is never joined by a solid line.
const WEIGHT_WITH_GAPS: readonly ChartPoint[] = [
  { dateISO: '2026-08-01', value: 82.4 },
  { dateISO: '2026-08-02', value: 82.2 },
  { dateISO: '2026-08-03', value: null },
  { dateISO: '2026-08-12', value: 81.0 },
  { dateISO: '2026-08-13', value: 80.8 },
  { dateISO: '2026-08-22', value: 80.2 },
];

const ENERGY: readonly ChartPoint[] = [
  { dateISO: '2026-08-01', value: 6 },
  { dateISO: '2026-08-04', value: 7 },
  { dateISO: '2026-08-07', value: 5 },
  { dateISO: '2026-08-10', value: 8 },
  { dateISO: '2026-08-13', value: 7 },
  { dateISO: '2026-08-16', value: 9 },
  { dateISO: '2026-08-19', value: 8 },
  { dateISO: '2026-08-22', value: 8 },
];

const ADHERENCE_PERCENT: readonly ChartPoint[] = [
  { dateISO: '2026-07-06', value: 62 },
  { dateISO: '2026-07-13', value: 78 },
  { dateISO: '2026-07-20', value: 71 },
  { dateISO: '2026-07-27', value: 88 },
  { dateISO: '2026-08-03', value: 94 },
];

const FLAT: readonly ChartPoint[] = [
  { dateISO: '2026-08-01', value: 100 },
  { dateISO: '2026-08-08', value: 100 },
  { dateISO: '2026-08-15', value: 100 },
];

function noop() {
  // Inert specimen.
}

export function ChartsSection() {
  const [selection, setSelection] = useState<LineChartSelection | null>(null);

  return (
    <GallerySection
      title="A line over time"
      note="The y-domain never anchors at zero, and a line is never drawn through a gap."
    >
      <Specimen label="LineChart · one series, touch to inspect" layout="column">
        <LineChart
          series={[
            {
              points: WEIGHT_KG,
              label: 'Weight',
              unit: 'kg',
              unitLabel: 'kilograms',
              minSpan: CHART_MIN_SPAN.bodyWeightKg,
            },
          ]}
          onPointPress={setSelection}
          onRequestTable={noop}
        />
        <Text size="body-sm" tone="muted">
          {selection
            ? `${selection.dateISO} · ${selection.value}`
            : 'no point selected — tap the chart'}
        </Text>
      </Specimen>

      <Specimen label="LineChart · a dashed reference line, and a hard range" layout="column">
        <LineChart
          series={[
            {
              points: WEIGHT_KG,
              label: 'Weight',
              unit: 'kg',
              unitLabel: 'kilograms',
              minSpan: CHART_MIN_SPAN.bodyWeightKg,
              referenceValue: 80,
            },
          ]}
        />
        <LineChart
          series={[
            {
              points: ADHERENCE_PERCENT,
              label: 'Adherence',
              unit: '%',
              unitLabel: 'percent',
              minSpan: CHART_MIN_SPAN.percent,
              range: { min: 0, max: 100 },
              referenceValue: 85,
            },
          ]}
        />
      </Specimen>

      <Specimen label="LineChart · two series (never three), and gaps" layout="column">
        <LineChart
          series={[
            {
              points: WEIGHT_KG,
              label: 'Weight',
              unit: 'kg',
              unitLabel: 'kilograms',
              minSpan: CHART_MIN_SPAN.bodyWeightKg,
            },
            {
              points: ENERGY,
              label: 'Energy',
              minSpan: CHART_MIN_SPAN.checkinScale,
              range: { min: 1, max: 10 },
            },
          ]}
          height={200}
        />
        <LineChart
          series={[
            {
              points: WEIGHT_WITH_GAPS,
              label: 'Weight',
              unit: 'kg',
              unitLabel: 'kilograms',
              minSpan: CHART_MIN_SPAN.bodyWeightKg,
              gapDays: 3,
            },
          ]}
        />
      </Specimen>

      <Specimen label="LineChart · nothing plottable, so the empty state renders" layout="column">
        <LineChart
          series={[
            {
              points: [{ dateISO: '2026-08-01', value: null }],
              label: 'Weight',
              minSpan: CHART_MIN_SPAN.bodyWeightKg,
            },
          ]}
          emptyState={
            <EmptyState
              title="No weigh-ins yet"
              body="Readings appear here once your client logs one."
              primaryAction={{ label: 'Send a reminder', onPress: noop }}
            />
          }
        />
      </Specimen>

      <Specimen label="Sparkline · rising, falling, flat, and with a gap">
        <View className="flex-row flex-wrap items-center gap-16">
          <Sparkline points={ENERGY} accessibilityLabel="Energy, rising" />
          <Sparkline points={WEIGHT_KG} accessibilityLabel="Body weight, falling" />
          <Sparkline points={FLAT} accessibilityLabel="Adherence, flat" />
          <Sparkline
            points={WEIGHT_WITH_GAPS}
            gapDays={3}
            accessibilityLabel="Body weight with missing days"
          />
        </View>
      </Specimen>

      <Specimen label="Sparkline · an explicit trend, and a taller mark">
        <View className="flex-row flex-wrap items-center gap-16">
          <Sparkline points={ENERGY} trend="up" accessibilityLabel="Energy, trending up" />
          <Sparkline points={ENERGY} trend="down" accessibilityLabel="Energy, trending down" />
          <Sparkline points={ENERGY} trend="flat" accessibilityLabel="Energy, flat" />
          <Sparkline
            points={ENERGY}
            height={40}
            width={120}
            accessibilityLabel="Energy, larger mark"
          />
        </View>
      </Specimen>
    </GallerySection>
  );
}
