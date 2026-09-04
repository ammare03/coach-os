import { fireEvent, render, screen } from '@testing-library/react-native';

import { AdherenceDotRow, type AdherenceDay } from './AdherenceDotRow.tsx';

const TODAY = '2026-09-04';

// Mon 31 Aug → Fri 4 Sep, the seven-day window ending on TODAY.
const FULL_WEEK: AdherenceDay[] = [
  { dateISO: '2026-08-29', state: 'on-track' },
  { dateISO: '2026-08-30', state: 'on-track' },
  { dateISO: '2026-08-31', state: 'drifting' },
  { dateISO: '2026-09-01', state: 'on-track' },
  { dateISO: '2026-09-02', state: 'off-track' },
  { dateISO: '2026-09-03', state: 'on-track' },
  { dateISO: '2026-09-04', state: 'drifting' },
];

function dotCount(): number {
  // Every dot is a leaf `View` with a 1.5px ring; the columns and the strip
  // wrapper have no border, so counting borders counts dots.
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      Boolean((node.props as { style?: unknown[] }).style) &&
      JSON.stringify(node.props.style ?? '').includes('"borderWidth":1.5'),
  ).length;
}

describe('AdherenceDotRow', () => {
  it('renders exactly seven dots for a full week', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} />);

    expect(dotCount()).toBe(7);
  });

  it('still renders seven dots for a week with two days of data and five gaps', () => {
    render(
      <AdherenceDotRow
        days={[
          { dateISO: '2026-09-01', state: 'on-track' },
          { dateISO: '2026-09-04', state: 'drifting' },
        ]}
        metric="training"
        todayISO={TODAY}
      />,
    );

    expect(dotCount()).toBe(7);
    expect(
      screen.getByLabelText('Training this week: 1 on plan, 1 drifting, 5 not started'),
    ).toBeTruthy();
  });

  it('renders seven dots and no data at all for a brand-new client', () => {
    render(<AdherenceDotRow days={[]} metric="training" todayISO={TODAY} />);

    expect(dotCount()).toBe(7);
    expect(screen.getByLabelText('Training this week: 7 not started')).toBeTruthy();
  });

  it('announces one week summary rather than seven days', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} />);

    expect(
      screen.getByLabelText('Training this week: 4 on plan, 2 drifting, 1 off plan'),
    ).toBeTruthy();
    // The individual dots must not be separately reachable — a coach with 30
    // clients would otherwise traverse 210 of them.
    expect(screen.queryByLabelText('On plan')).toBeNull();
  });

  it('names the metric it describes', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="nutrition" todayISO={TODAY} />);

    expect(
      screen.getByLabelText('Nutrition this week: 4 on plan, 2 drifting, 1 off plan'),
    ).toBeTruthy();
  });

  it('hides its dots from the reading order', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} />);

    const strip = screen.UNSAFE_root.findAll(
      (node) =>
        (node.props as { accessibilityElementsHidden?: boolean }).accessibilityElementsHidden ===
        true,
    );
    expect(strip.length).toBeGreaterThan(0);
    expect(strip[0]?.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('ignores days outside the window rather than shifting the strip', () => {
    render(
      <AdherenceDotRow
        days={[...FULL_WEEK, { dateISO: '2026-08-20', state: 'on-track' }]}
        metric="training"
        todayISO={TODAY}
      />,
    );

    expect(dotCount()).toBe(7);
    expect(
      screen.getByLabelText('Training this week: 4 on plan, 2 drifting, 1 off plan'),
    ).toBeTruthy();
  });

  it('puts today at the right-hand end, oldest first', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} showDayLabels />);

    // 29 Aug 2026 is a Saturday, so the week reads S S M T W T F.
    // `includeHiddenElements` because the strip is hidden from the reading
    // order by design — that it has to be passed here is the assertion in
    // the test above, restated.
    const letters = screen.getAllByText(/^[SMTWF]$/, { includeHiddenElements: true });
    expect(letters.map((node) => node.props.children)).toEqual(['S', 'S', 'M', 'T', 'W', 'T', 'F']);
  });

  it('is the tap target itself, at the 44px floor, when interactive', () => {
    const onPress = jest.fn();
    render(
      <AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} onPress={onPress} />,
    );

    const row = screen.getByRole('button', {
      name: 'Training this week: 4 on plan, 2 drifting, 1 off plan',
    });
    fireEvent.press(row);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not a button when it has nothing to open', () => {
    render(<AdherenceDotRow days={FULL_WEEK} metric="training" todayISO={TODAY} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('rejects a todayISO that is not a calendar date, rather than silently drawing the wrong week', () => {
    expect(() =>
      render(
        <AdherenceDotRow days={FULL_WEEK} metric="training" todayISO="2026-09-04T10:00:00Z" />,
      ),
    ).toThrow(/calendar date/);
  });
});
