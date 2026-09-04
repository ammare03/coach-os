import { render, screen } from '@testing-library/react-native';

import { MacroBar, macroBarFill, macroBarSegments } from './MacroBar.tsx';

const sumOf = (grams: { proteinG: number; carbsG: number; fatG: number }) => {
  const s = macroBarSegments(grams);
  return s.proteinFraction + s.carbsFraction + s.fatFraction;
};

describe('macroBarSegments', () => {
  it('sizes segments by calories contributed, not by grams', () => {
    // Equal grams of protein and fat are NOT equal segments — 9 kcal/g
    // against 4. This is the assertion that stops someone "fixing" the bar
    // to match the numbers printed under it.
    const segments = macroBarSegments({ proteinG: 40, carbsG: 0, fatG: 40 });

    expect(segments.proteinFraction).toBeCloseTo(160 / 520, 6);
    expect(segments.fatFraction).toBeCloseTo(360 / 520, 6);
    expect(segments.fatFraction).toBeGreaterThan(segments.proteinFraction * 2);
  });

  it('sums to exactly 1 on an ordinary day', () => {
    expect(sumOf({ proteinG: 96, carbsG: 142, fatG: 48 })).toBe(1);
  });

  it('sums to exactly 1 on inputs that do not divide cleanly', () => {
    expect(sumOf({ proteinG: 1, carbsG: 1, fatG: 1 })).toBe(1);
    expect(sumOf({ proteinG: 37, carbsG: 113, fatG: 29 })).toBe(1);
    expect(sumOf({ proteinG: 0.1, carbsG: 0.3, fatG: 0.7 })).toBe(1);
  });

  it('sums to exactly 0 on an untouched day rather than dividing by zero', () => {
    const segments = macroBarSegments({ proteinG: 0, carbsG: 0, fatG: 0 });

    expect(segments.proteinFraction).toBe(0);
    expect(segments.carbsFraction).toBe(0);
    expect(segments.fatFraction).toBe(0);
    expect(segments.totalKcal).toBe(0);
  });

  it('gives the whole bar to a single-macro day', () => {
    expect(macroBarSegments({ proteinG: 0, carbsG: 0, fatG: 70 })).toMatchObject({
      proteinFraction: 0,
      carbsFraction: 0,
      fatFraction: 1,
    });
    expect(sumOf({ proteinG: 180, carbsG: 0, fatG: 0 })).toBe(1);
    expect(sumOf({ proteinG: 0, carbsG: 240, fatG: 0 })).toBe(1);
  });

  it('ignores a negative or non-finite macro instead of drawing a bar backwards', () => {
    expect(sumOf({ proteinG: -50, carbsG: 100, fatG: 20 })).toBe(1);
    expect(macroBarSegments({ proteinG: Number.NaN, carbsG: 0, fatG: 0 }).totalKcal).toBe(0);
  });
});

describe('macroBarFill', () => {
  it('fills the whole bar with the composition when no target is set', () => {
    expect(macroBarFill(1382, null)).toEqual({ fillFraction: 1, markerFraction: null });
  });

  it('leaves an empty day empty', () => {
    expect(macroBarFill(0, 2340)).toEqual({ fillFraction: 0, markerFraction: 1 });
    expect(macroBarFill(0, null)).toEqual({ fillFraction: 0, markerFraction: null });
  });

  it('fills part of the bar under target, with the marker at the far end', () => {
    expect(macroBarFill(1170, 2340)).toEqual({ fillFraction: 0.5, markerFraction: 1 });
  });

  it('compresses the segments and moves the marker inside the bar over target', () => {
    const fill = macroBarFill(2600, 2340);

    expect(fill.fillFraction).toBe(1);
    expect(fill.markerFraction).toBeCloseTo(0.9, 5);
  });

  it('never lets the fill or the marker escape the bar', () => {
    const fill = macroBarFill(100000, 2340);

    expect(fill.fillFraction).toBe(1);
    expect(fill.markerFraction).toBeGreaterThan(0);
    expect(fill.markerFraction).toBeLessThan(1);
  });

  it('treats a target of 0 as no target rather than dividing by it', () => {
    expect(macroBarFill(1382, 0)).toEqual({ fillFraction: 1, markerFraction: null });
    expect(macroBarFill(1382, Number.NaN)).toEqual({ fillFraction: 1, markerFraction: null });
  });
});

describe('MacroBar', () => {
  it('announces the full breakdown and the calorie total against the target', () => {
    render(<MacroBar proteinG={96} carbsG={142} fatG={48} targetKcal={2340} />);

    expect(
      screen.getByLabelText(
        'protein 96 grams, carbohydrate 142 grams, fat 48 grams. 1384 of 2340 kilocalories',
      ),
    ).toBeTruthy();
  });

  it('omits the target from the sentence when there is none', () => {
    render(<MacroBar proteinG={96} carbsG={142} fatG={48} />);

    expect(
      screen.getByLabelText(
        'protein 96 grams, carbohydrate 142 grams, fat 48 grams. 1384 kilocalories',
      ),
    ).toBeTruthy();
  });

  it('exposes min, max, and now when a target is set', () => {
    render(<MacroBar proteinG={96} carbsG={142} fatG={48} targetKcal={2340} testID="bar" />);

    const bar = screen.getByTestId('bar');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 2340, now: 1384 });
  });

  it('labels each wide-enough segment with its letter and its grams', () => {
    render(<MacroBar proteinG={96} carbsG={142} fatG={48} />);

    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText('C')).toBeTruthy();
    expect(screen.getByText('F')).toBeTruthy();
    expect(screen.getByText('96')).toBeTruthy();
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('48')).toBeTruthy();
  });

  it('drops a label too narrow to render, keeping it in the spoken breakdown', () => {
    render(<MacroBar proteinG={200} carbsG={200} fatG={1} />);

    expect(screen.queryByText('F')).toBeNull();
    expect(screen.getByLabelText(/fat 1 grams/)).toBeTruthy();
  });

  it('renders an untouched day as an empty track with no segments and no labels', () => {
    render(<MacroBar proteinG={0} carbsG={0} fatG={0} targetKcal={2340} />);

    expect(screen.queryByText('P')).toBeNull();
    expect(screen.getByLabelText(/0 of 2340 kilocalories/)).toBeTruthy();
  });

  it('hides the label row on request without losing the spoken breakdown', () => {
    render(<MacroBar proteinG={96} carbsG={142} fatG={48} hideLabels />);

    expect(screen.queryByText('P')).toBeNull();
    expect(screen.getByLabelText(/protein 96 grams/)).toBeTruthy();
  });
});
