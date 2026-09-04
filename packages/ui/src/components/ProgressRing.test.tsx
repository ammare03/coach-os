import { render, screen } from '@testing-library/react-native';

import { ProgressRing, progressRingSweep } from './ProgressRing.tsx';

// The sweep arithmetic is asserted directly rather than through a rendered
// arc: the drawing belongs to Skia (`testing` §9 — we do not test third-party
// libraries), and what can actually be wrong here is the fraction handed to
// it. The rendered assertions below cover the contract that IS ours: what a
// screen reader is told, and that a zero value paints nothing.
describe('progressRingSweep', () => {
  it('is empty at 0% and draws no arc at all', () => {
    const sweep = progressRingSweep(0, 180);

    expect(sweep.fraction).toBe(0);
    expect(sweep.excessFraction).toBe(0);
    expect(sweep.percent).toBe(0);
  });

  it('is half a circle at 50%', () => {
    expect(progressRingSweep(90, 180).fraction).toBe(0.5);
  });

  it('is exactly a full circle at 100%, with nothing left over', () => {
    const sweep = progressRingSweep(180, 180);

    expect(sweep.fraction).toBe(1);
    expect(sweep.excessFraction).toBe(0);
    expect(sweep.percent).toBe(100);
  });

  it('caps the sweep at a full circle and moves the remainder to the excess arc at 118%', () => {
    const sweep = progressRingSweep(212.4, 180);

    expect(sweep.fraction).toBe(1);
    expect(sweep.excessFraction).toBeCloseTo(0.18, 5);
    expect(sweep.percent).toBe(118);
  });

  it('never exceeds a full circle, however far past the target the value is', () => {
    const sweep = progressRingSweep(9000, 180);

    expect(sweep.fraction).toBe(1);
    expect(sweep.excessFraction).toBe(1);
  });

  it('renders an indeterminate track for a target of 0 rather than dividing by it', () => {
    const sweep = progressRingSweep(142, 0);

    expect(sweep.isIndeterminate).toBe(true);
    expect(sweep.fraction).toBe(0);
    expect(Number.isNaN(sweep.fraction)).toBe(false);
    expect(sweep.percent).toBeNull();
  });

  it('renders an indeterminate track for a null target, never a full ring', () => {
    // A client whose coach has not set a macro target is not a client at
    // 100% (DESIGN.md §10.5 — absence of data is not a result).
    const sweep = progressRingSweep(142, null);

    expect(sweep.isIndeterminate).toBe(true);
    expect(sweep.fraction).toBe(0);
  });

  it('never produces Infinity or NaN from a non-finite input', () => {
    for (const sweep of [
      progressRingSweep(142, Number.NaN),
      progressRingSweep(142, Number.POSITIVE_INFINITY),
      progressRingSweep(Number.NaN, 180),
      progressRingSweep(Number.POSITIVE_INFINITY, 180),
    ]) {
      expect(Number.isFinite(sweep.fraction)).toBe(true);
      expect(Number.isFinite(sweep.excessFraction)).toBe(true);
    }
  });

  it('treats a negative value as an empty track, not as a backwards arc', () => {
    expect(progressRingSweep(-40, 180).fraction).toBe(0);
  });
});

describe('ProgressRing', () => {
  it('announces value, target, unit, and percentage as a sentence', () => {
    render(<ProgressRing value={142} target={180} unit="g" unitLabel="grams" label="Protein" />);

    expect(screen.getByLabelText('Protein, 142 of 180 grams, 79 percent')).toBeTruthy();
  });

  it('speaks the unit as a word, not as the printed symbol', () => {
    render(
      <ProgressRing
        value={741}
        target={2340}
        unit="kcal"
        unitLabel="kilocalories"
        label="Calories"
      />,
    );

    expect(screen.getByLabelText(/kilocalories/)).toBeTruthy();
  });

  it('carries min, max, and now for the progressbar role', () => {
    render(<ProgressRing value={142} target={180} unit="g" testID="ring" />);

    const ring = screen.getByTestId('ring');
    expect(ring.props.accessibilityRole).toBe('progressbar');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 180, now: 142 });
  });

  it('says "no target set" rather than a percentage when there is no target', () => {
    render(<ProgressRing value={142} target={null} unit="g" unitLabel="grams" testID="ring" />);

    expect(screen.getByLabelText('142 grams, no target set')).toBeTruthy();
    // No `now` against a `max` that does not exist — a screen reader would
    // otherwise announce a proportion of nothing.
    expect(screen.getByTestId('ring').props.accessibilityValue).toBeUndefined();
  });

  it('keeps counting past the target rather than clamping the number', () => {
    render(<ProgressRing value={212} target={180} unit="g" unitLabel="grams" />);

    // The sweep caps; the value does not. Going over is not a failure state.
    expect(screen.getByText('212')).toBeTruthy();
    expect(screen.getByLabelText('212 of 180 grams, 118 percent')).toBeTruthy();
  });

  it('renders the value and the unit sub-line at md', () => {
    render(<ProgressRing value={741} target={2340} unit="kcal" label="left" size="md" />);

    expect(screen.getByText('741')).toBeTruthy();
    expect(screen.getByText('kcal left')).toBeTruthy();
  });

  it('drops the sub-line at sm, where there is no room for it', () => {
    render(<ProgressRing value={4} target={5} unit="sessions" size="sm" />);

    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText('sessions')).toBeNull();
    // The screen reader still gets it — the sub-line is a layout decision,
    // never an information one.
    expect(screen.getByLabelText('4 of 5 sessions, 80 percent')).toBeTruthy();
  });

  it('forces the track-only state when isIndeterminate is set despite a real target', () => {
    render(<ProgressRing value={142} target={180} unit="g" isIndeterminate testID="ring" />);

    expect(screen.getByTestId('ring').props.accessibilityValue).toBeUndefined();
  });
});
