import {
  CHART_MIN_SPAN,
  DEFAULT_GAP_DAYS,
  calendarDayNumber,
  chartAxisLabelIndices,
  chartSeriesShape,
  chartSummary,
  chartTrend,
  chartYDomain,
  formatAxisDate,
  formatSpokenDate,
  type ChartPoint,
} from './chartDomain.ts';

// `ui-primitives-data/04`: the two product failures this file exists to
// prevent are a y-domain anchored at zero and a line drawn through a gap.
// `testing` §2 puts pure logic in the 100% tier, and these are the pure
// functions the whole task reduces to.

describe('calendarDayNumber', () => {
  it('is a difference of days, not an instant', () => {
    const monday = calendarDayNumber('2026-06-01');
    const friday = calendarDayNumber('2026-06-05');

    expect(monday).not.toBeNull();
    expect(friday !== null && monday !== null && friday - monday).toBe(4);
  });

  it('counts across a month boundary', () => {
    const june30 = calendarDayNumber('2026-06-30');
    const july1 = calendarDayNumber('2026-07-01');

    expect(july1 !== null && june30 !== null && july1 - june30).toBe(1);
  });

  it('counts a leap day', () => {
    const feb28 = calendarDayNumber('2024-02-28');
    const mar1 = calendarDayNumber('2024-03-01');

    expect(mar1 !== null && feb28 !== null && mar1 - feb28).toBe(2);
  });

  it('does not count a leap day in a non-leap century', () => {
    expect(calendarDayNumber('1900-02-29')).toBeNull();
  });

  it('rejects anything that is not a local calendar date', () => {
    // The whole point: a chart that accepts an instant will bucket it in
    // the device's timezone and shift a Sunday-night weigh-in to Monday.
    expect(calendarDayNumber('2026-06-03T00:30:00Z')).toBeNull();
    expect(calendarDayNumber('2026-13-01')).toBeNull();
    expect(calendarDayNumber('2026-06-31')).toBeNull();
    expect(calendarDayNumber('')).toBeNull();
  });
});

describe('chartYDomain', () => {
  it('never anchors at zero for a series that does not reach zero', () => {
    const domain = chartYDomain([84.2, 83.4, 82.9, 82.1], {
      minSpan: CHART_MIN_SPAN.bodyWeightKg,
    });

    // 84.2 → 82.1 over eight weeks is real progress; on a 0–90 axis it is a
    // flat line and the client stops weighing in.
    expect(domain).not.toBeNull();
    expect(domain?.min).toBeGreaterThan(0);
    expect(domain?.min).toBeLessThan(82.1);
    expect(domain?.max).toBeGreaterThan(84.2);
  });

  it('includes zero only when the data reaches it', () => {
    const domain = chartYDomain([0, 2, 4], { minSpan: CHART_MIN_SPAN.checkinScale });

    expect(domain?.min).toBeLessThanOrEqual(0);
  });

  it('pads the data range by 10% on each side', () => {
    const domain = chartYDomain([10, 20], { minSpan: 0 });

    expect(domain).toEqual({ min: 9, max: 21, span: 12 });
  });

  it('expands a narrow range to minSpan, centred on the data', () => {
    // 200g over a week must not look like a cliff.
    const domain = chartYDomain([82.0, 82.2], { minSpan: CHART_MIN_SPAN.bodyWeightKg });

    expect(domain?.span).toBeCloseTo(4);
    expect(domain?.min).toBeCloseTo(80.1);
    expect(domain?.max).toBeCloseTo(84.1);
  });

  it('leaves a range wider than minSpan alone', () => {
    const domain = chartYDomain([80, 90], { minSpan: CHART_MIN_SPAN.bodyWeightKg });

    expect(domain?.span).toBeCloseTo(12);
  });

  it('treats a range exactly minSpan wide as already wide enough', () => {
    const domain = chartYDomain([80, 84], { minSpan: CHART_MIN_SPAN.bodyWeightKg });

    // 4 wide + 10% padding each side is already past the floor, so the
    // padding survives rather than being replaced by the floor.
    expect(domain?.span).toBeCloseTo(4.8);
  });

  it('centres a flat series in a minSpan window', () => {
    const domain = chartYDomain([82, 82, 82, 82], { minSpan: CHART_MIN_SPAN.bodyWeightKg });

    expect(domain).toEqual({ min: 80, max: 84, span: 4 });
  });

  it('centres a single point in a minSpan window', () => {
    const domain = chartYDomain([7], { minSpan: CHART_MIN_SPAN.checkinScale });

    expect(domain).toEqual({ min: 5.5, max: 8.5, span: 3 });
  });

  it('slides the window rather than shrinking it at a hard lower bound', () => {
    const domain = chartYDomain([2, 3], { minSpan: CHART_MIN_SPAN.percent, min: 0, max: 100 });

    expect(domain?.min).toBe(0);
    expect(domain?.span).toBeCloseTo(CHART_MIN_SPAN.percent);
  });

  it('slides the window rather than shrinking it at a hard upper bound', () => {
    const domain = chartYDomain([92, 96], { minSpan: CHART_MIN_SPAN.percent, min: 0, max: 100 });

    // 92–96 with a 20-point floor is 80–100, never 86–106: a chart that
    // shows 106% adherence is its own kind of lie.
    expect(domain?.max).toBe(100);
    expect(domain?.min).toBeCloseTo(80);
  });

  it('accepts a window narrower than minSpan when both hard bounds bind', () => {
    const domain = chartYDomain([40, 60], { minSpan: 500, min: 0, max: 100 });

    expect(domain).toEqual({ min: 0, max: 100, span: 100 });
  });

  it('returns null when there is nothing finite to plot', () => {
    expect(chartYDomain([], { minSpan: 4 })).toBeNull();
    expect(chartYDomain([Number.NaN, Number.POSITIVE_INFINITY], { minSpan: 4 })).toBeNull();
  });

  it('ignores non-finite values among real ones', () => {
    const domain = chartYDomain([10, Number.NaN, 20], { minSpan: 0 });

    expect(domain).toEqual({ min: 9, max: 21, span: 12 });
  });
});

describe('chartSeriesShape', () => {
  const weighIns: ChartPoint[] = [
    { dateISO: '2026-06-01', value: 84.2 },
    { dateISO: '2026-06-02', value: 84.0 },
    // Eleven silent days. A solid segment here would be a picture of
    // eleven days of steady progress that never happened.
    { dateISO: '2026-06-13', value: 83.1 },
    { dateISO: '2026-06-14', value: 83.0 },
  ];

  it('splits a series at a gap and bridges the two runs', () => {
    const shape = chartSeriesShape(weighIns, DEFAULT_GAP_DAYS);

    expect(shape.runs).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(shape.bridges).toEqual([[1, 2]]);
  });

  it('keeps points exactly gapDays apart in the same run', () => {
    const shape = chartSeriesShape(
      [
        { dateISO: '2026-06-01', value: 1 },
        { dateISO: '2026-06-04', value: 2 },
      ],
      3,
    );

    expect(shape.runs).toEqual([[0, 1]]);
    expect(shape.bridges).toEqual([]);
  });

  it('breaks one day past gapDays', () => {
    const shape = chartSeriesShape(
      [
        { dateISO: '2026-06-01', value: 1 },
        { dateISO: '2026-06-05', value: 2 },
      ],
      3,
    );

    expect(shape.runs).toEqual([[0], [1]]);
    expect(shape.bridges).toEqual([[0, 1]]);
  });

  it('breaks at an explicit null and does not bridge across it', () => {
    // A bridge says "these two readings are related". A null says nothing,
    // so it earns no mark at all.
    const shape = chartSeriesShape(
      [
        { dateISO: '2026-06-01', value: 1 },
        { dateISO: '2026-06-02', value: null },
        { dateISO: '2026-06-03', value: 3 },
      ],
      3,
    );

    expect(shape.plotted).toEqual([0, 2]);
    expect(shape.runs).toEqual([[0], [2]]);
    expect(shape.bridges).toEqual([]);
  });

  it('drops a point whose date does not parse rather than placing it', () => {
    const shape = chartSeriesShape(
      [
        { dateISO: '2026-06-01', value: 1 },
        { dateISO: '2026-06-02T09:00:00Z', value: 2 },
        { dateISO: '2026-06-03', value: 3 },
      ],
      3,
    );

    expect(shape.plotted).toEqual([0, 2]);
    expect(shape.bridges).toEqual([]);
  });

  it('reports the calendar span of the plotted points', () => {
    const shape = chartSeriesShape(weighIns, DEFAULT_GAP_DAYS);

    expect(shape.dayMax - shape.dayMin).toBe(13);
  });

  it('returns an empty shape for an empty series', () => {
    const shape = chartSeriesShape([], DEFAULT_GAP_DAYS);

    expect(shape.plotted).toEqual([]);
    expect(shape.runs).toEqual([]);
    expect(shape.bridges).toEqual([]);
  });

  it('returns one run of one for a single point', () => {
    const shape = chartSeriesShape([{ dateISO: '2026-06-01', value: 84 }], DEFAULT_GAP_DAYS);

    expect(shape.runs).toEqual([[0]]);
    expect(shape.bridges).toEqual([]);
  });

  it('breaks rather than re-ordering an out-of-order point', () => {
    // Sorting data behind the caller's back to make a chart look
    // continuous is the same lie as bridging a gap.
    const shape = chartSeriesShape(
      [
        { dateISO: '2026-06-05', value: 1 },
        { dateISO: '2026-06-01', value: 2 },
      ],
      3,
    );

    expect(shape.runs).toEqual([[0], [1]]);
    expect(shape.bridges).toEqual([]);
  });
});

describe('chartTrend', () => {
  it('reads direction from the first and last plotted values', () => {
    expect(
      chartTrend([
        { dateISO: '2026-06-01', value: 84 },
        { dateISO: '2026-07-01', value: 82 },
      ]),
    ).toBe('down');
  });

  it('calls an unchanged series flat rather than up', () => {
    expect(
      chartTrend([
        { dateISO: '2026-06-01', value: 82 },
        { dateISO: '2026-07-01', value: 82 },
      ]),
    ).toBe('flat');
  });

  it('is null with nothing plotted', () => {
    expect(chartTrend([{ dateISO: '2026-06-01', value: null }])).toBeNull();
  });
});

describe('chartSummary', () => {
  it('is one sentence, not the readings', () => {
    const summary = chartSummary({
      label: 'Weight',
      unitLabel: 'kilograms',
      points: [
        { dateISO: '2026-06-03', value: 84.2 },
        { dateISO: '2026-06-04', value: 83.5 },
        { dateISO: '2026-07-01', value: 82.1 },
      ],
    });

    expect(summary).toContain('Weight, 3 entries from 3 June to 1 July');
    expect(summary).toContain('84.2 to 82.1 kilograms');
    expect(summary).toContain('trending down');
  });

  it('speaks the gaps a sighted reader sees as dashed segments', () => {
    const summary = chartSummary({
      label: 'Weight',
      points: [
        { dateISO: '2026-06-01', value: 84 },
        { dateISO: '2026-06-20', value: 83 },
      ],
    });

    expect(summary).toContain('with one gap in the readings');
  });

  it('announces a single entry without inventing a trend', () => {
    const summary = chartSummary({
      label: 'Weight',
      unitLabel: 'kilograms',
      points: [{ dateISO: '2026-06-03', value: 84.2 }],
    });

    expect(summary).toBe('Weight, one entry on 3 June, 84.2 kilograms');
  });

  it('says a flat series is unchanged, never that it is up', () => {
    const summary = chartSummary({
      label: 'Energy',
      points: [
        { dateISO: '2026-06-01', value: 7 },
        { dateISO: '2026-06-02', value: 7 },
      ],
    });

    expect(summary).toContain('unchanged');
  });

  it('states the absence rather than apologising for it', () => {
    expect(chartSummary({ label: 'Weight', points: [] })).toBe('Weight, no entries yet');
  });
});

describe('chartAxisLabelIndices', () => {
  it('always includes the first and the last point', () => {
    const indices = chartAxisLabelIndices(12, 4);

    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(11);
  });

  it('never returns more labels than the width allows', () => {
    expect(chartAxisLabelIndices(40, 4)).toHaveLength(4);
    expect(chartAxisLabelIndices(40, 6)).toHaveLength(6);
  });

  it('reduces to the number of points when there are fewer than slots', () => {
    expect(chartAxisLabelIndices(2, 6)).toEqual([0, 1]);
    expect(chartAxisLabelIndices(1, 6)).toEqual([0]);
    expect(chartAxisLabelIndices(0, 6)).toEqual([]);
  });
});

describe('date formatting', () => {
  it('writes an axis label short and a spoken label long', () => {
    expect(formatAxisDate('2026-06-03')).toBe('3 Jun');
    expect(formatSpokenDate('2026-06-03')).toBe('3 June');
  });

  it('returns the input unchanged rather than guessing at a bad date', () => {
    expect(formatAxisDate('not-a-date')).toBe('not-a-date');
  });
});
