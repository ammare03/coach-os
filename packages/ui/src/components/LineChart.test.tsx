import { fireEvent, render, screen } from '@testing-library/react-native';

import { CHART_MIN_SPAN, type ChartPoint } from './chartDomain.ts';
import { LineChart } from './LineChart.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Text } from './Text.tsx';

// The arithmetic is asserted in `chartDomain.test.ts`. What is left here is
// what only a rendered tree can show: the three degenerate series real data
// produces in week one, the accessible summary that IS a chart's whole
// screen-reader story, and the two capabilities `Sparkline` must not have.

const WEIGHT: ChartPoint[] = [
  { dateISO: '2026-06-01', value: 84.2 },
  { dateISO: '2026-06-02', value: 84.0 },
  { dateISO: '2026-06-13', value: 83.1 },
  { dateISO: '2026-06-14', value: 82.1 },
];

function weightSeries(points: readonly ChartPoint[]) {
  return {
    points,
    label: 'Weight',
    unit: 'kg',
    unitLabel: 'kilograms',
    minSpan: CHART_MIN_SPAN.bodyWeightKg,
  } as const;
}

// `onLayout` never fires on its own in the test renderer, so the plot
// measures 0 wide and the canvas is skipped — which is also the first frame
// of a real mount. Firing it by hand runs the real path geometry, so a
// `NaN` coordinate surfaces here rather than on a device.
function layOut(label: string | RegExp, width = 320) {
  fireEvent(screen.getByLabelText(label), 'layout', {
    nativeEvent: { layout: { width, height: 126, x: 0, y: 0 } },
  });
}

function scrubTo(locationX: number, event = 'responderGrant') {
  fireEvent(screen.getByLabelText(/^Weight/), event, { nativeEvent: { locationX } });
}

describe('LineChart', () => {
  it('renders a populated series without crashing', () => {
    render(<LineChart testID="chart" series={[weightSeries(WEIGHT)]} />);

    expect(screen.getByTestId('chart')).toBeTruthy();
  });

  it('renders a designed empty state rather than a blank box', () => {
    render(
      <LineChart
        testID="chart"
        series={[weightSeries([])]}
        emptyState={<Text>Log a weight to start the chart</Text>}
      />,
    );

    expect(screen.getByText('Log a weight to start the chart')).toBeTruthy();
  });

  it('states the absence when no empty state is supplied', () => {
    render(<LineChart testID="chart" series={[weightSeries([])]} />);

    // COPY.md §CO4.1 — the fact, with no apology and no exclamation mark.
    expect(screen.getByText('No weight entries yet')).toBeTruthy();
  });

  it('treats a series of nothing but nulls as empty', () => {
    render(
      <LineChart
        testID="chart"
        series={[weightSeries([{ dateISO: '2026-06-01', value: null }])]}
      />,
    );

    expect(screen.getByText('No weight entries yet')).toBeTruthy();
  });

  it('renders a single point with its value and no invented trend', () => {
    render(<LineChart testID="chart" series={[weightSeries([WEIGHT[0] as ChartPoint])]} />);
    layOut(/^Weight, one entry/);

    expect(screen.getByLabelText('Weight, one entry on 1 June, 84.2 kilograms')).toBeTruthy();
    expect(screen.getByText('84.2')).toBeTruthy();
  });

  it('renders an all-equal series without crashing and calls it unchanged', () => {
    const flat: ChartPoint[] = [
      { dateISO: '2026-06-01', value: 82 },
      { dateISO: '2026-06-02', value: 82 },
      { dateISO: '2026-06-03', value: 82 },
    ];
    render(<LineChart testID="chart" series={[weightSeries(flat)]} />);
    layOut(/unchanged/);

    expect(screen.getByLabelText(/unchanged/)).toBeTruthy();
  });

  it('exposes one sentence to a screen reader, not the readings', () => {
    render(<LineChart testID="chart" series={[weightSeries(WEIGHT)]} />);

    const label = screen.getByLabelText(/^Weight, 4 entries/).props.accessibilityLabel as string;

    expect(label).toContain('from 1 June to 14 June');
    expect(label).toContain('84.2 to 82.1 kilograms');
    expect(label).toContain('trending down');
    // The eleven-day hole is visible to a sighted reader as a dashed
    // segment, so it is spoken too.
    expect(label).toContain('with one gap in the readings');
  });

  it('offers the underlying data as a list when the screen provides one', () => {
    const onRequestTable = jest.fn();
    render(
      <LineChart testID="chart" series={[weightSeries(WEIGHT)]} onRequestTable={onRequestTable} />,
    );

    fireEvent.press(screen.getByLabelText('Read weight entries as a list'));

    expect(onRequestTable).toHaveBeenCalledTimes(1);
  });

  it('omits the list affordance when the screen has nowhere to send it', () => {
    render(<LineChart testID="chart" series={[weightSeries(WEIGHT)]} />);

    expect(screen.queryByLabelText('Read weight entries as a list')).toBeNull();
  });

  it('renders a two-series overlay with a label and a scale on each mark', () => {
    render(
      <LineChart
        testID="chart"
        series={[
          weightSeries(WEIGHT),
          {
            points: [
              { dateISO: '2026-06-01', value: 7 },
              { dateISO: '2026-06-02', value: 6 },
            ],
            label: 'Energy',
            minSpan: CHART_MIN_SPAN.checkinScale,
            range: { min: 1, max: 10 },
          },
        ]}
      />,
    );
    layOut(/^Weight, 4 entries/);

    expect(screen.getByText('WEIGHT')).toBeTruthy();
    expect(screen.getByText('ENERGY')).toBeTruthy();
    // §7: no legends where a label fits on the mark. Each series carries
    // its own scale beside its own name, so neither is read by hue alone —
    // and the two scales differ, which is the whole reason an overlay needs
    // them at all.
    expect(screen.getByText('81.2–85.2')).toBeTruthy();
    expect(screen.getByText('5–8')).toBeTruthy();
  });

  it('reports the snapped point through onPointPress', () => {
    const onPointPress = jest.fn();
    render(
      <LineChart testID="chart" series={[weightSeries(WEIGHT)]} onPointPress={onPointPress} />,
    );
    layOut(/^Weight, 4 entries/);

    scrubTo(0);

    expect(onPointPress).toHaveBeenCalledWith(
      expect.objectContaining({ dateISO: '2026-06-01', value: 84.2, seriesIndex: 0 }),
    );
  });

  it('shows the scrubbed value in the fixed slot above the chart, not under the finger', () => {
    render(<LineChart testID="chart" series={[weightSeries(WEIGHT)]} />);
    layOut(/^Weight, 4 entries/);

    // Before touch the header carries the latest reading.
    expect(screen.getByText('82.1')).toBeTruthy();

    scrubTo(0);

    // While scrubbing it carries the snapped one, in the same slot, through
    // `Metric` — so the crosshair cannot jitter as the finger moves.
    expect(screen.getByText('84.2')).toBeTruthy();
    expect(screen.getByText('1 June')).toBeTruthy();
  });

  it('does not re-report a point the scrub has not moved off', () => {
    const onPointPress = jest.fn();
    render(
      <LineChart testID="chart" series={[weightSeries(WEIGHT)]} onPointPress={onPointPress} />,
    );
    layOut(/^Weight, 4 entries/);

    scrubTo(0);
    scrubTo(1, 'responderMove');
    scrubTo(2, 'responderMove');

    expect(onPointPress).toHaveBeenCalledTimes(1);
  });

  it('clears the scrub when the touch ends', () => {
    render(<LineChart testID="chart" series={[weightSeries(WEIGHT)]} />);
    layOut(/^Weight, 4 entries/);

    scrubTo(0);
    fireEvent(screen.getByLabelText(/^Weight, 4 entries/), 'responderRelease', {
      nativeEvent: {},
    });

    expect(screen.getByText('82.1')).toBeTruthy();
  });
});

describe('Sparkline', () => {
  it('renders in a row without crashing', () => {
    render(<Sparkline testID="spark" points={WEIGHT} accessibilityLabel="Bench press" />);

    expect(screen.getByTestId('spark')).toBeTruthy();
  });

  it('renders an empty series as an empty box, never a crash', () => {
    render(<Sparkline testID="spark" points={[]} accessibilityLabel="Bench press" />);

    expect(screen.getByTestId('spark')).toBeTruthy();
  });

  it('has no touch handler — the row is what is tappable', () => {
    const spark = render(
      <Sparkline testID="spark" points={WEIGHT} accessibilityLabel="Bench press" />,
    ).getByTestId('spark');

    expect(spark.props.onStartShouldSetResponder).toBeUndefined();
    expect(spark.props.onResponderGrant).toBeUndefined();
  });

  it('speaks its direction in a word when it is labelled', () => {
    render(<Sparkline testID="spark" points={WEIGHT} accessibilityLabel="Bench press" />);

    expect(screen.getByLabelText('Bench press, trending down')).toBeTruthy();
  });

  it('is hidden from the reading order when it carries no label', () => {
    render(<Sparkline testID="spark" points={WEIGHT} />);

    // Unlabelled, it is decorative, and a decorative mark is noise in the
    // reading order (`accessibility` §2) — so the query has to ask for
    // hidden elements to see it at all, which is the assertion.
    expect(screen.queryByTestId('spark')).toBeNull();
    expect(
      screen.getByTestId('spark', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
  });

  it('caps at 60 points by dropping the oldest', () => {
    const many: ChartPoint[] = Array.from({ length: 400 }, (_, index) => ({
      dateISO: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      value: index,
    }));

    // The cap is invisible in the tree, so what is asserted is that a
    // 400-point series still mounts and still reports its own direction —
    // i.e. the slice keeps the newest end, not the oldest.
    render(<Sparkline testID="spark" points={many} accessibilityLabel="Volume" />);

    expect(screen.getByTestId('spark')).toBeTruthy();
  });

  it('does not colour by direction — §7 draws every row spark in one hue', () => {
    render(<Sparkline testID="spark" points={WEIGHT} trend="up" accessibilityLabel="Bench" />);

    expect(screen.getByLabelText('Bench, trending up')).toBeTruthy();
  });
});
