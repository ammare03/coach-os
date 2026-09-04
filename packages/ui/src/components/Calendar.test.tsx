import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors } from '../theme/tokens.ts';

import { Calendar, CALENDAR_CELL_GEOMETRY, type CalendarMarker } from './Calendar.tsx';

const SEPTEMBER = '2026-09-01';

function dayLabel(day: number, month = 'September', year = 2026) {
  return new RegExp(`^${month} ${day}, ${year}`);
}

describe('Calendar', () => {
  it('hands the callback an ISO date string, never a Date', () => {
    const onSelect = jest.fn();
    render(
      <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={onSelect} locale="en-US" />,
    );

    fireEvent.press(screen.getByLabelText(dayLabel(17)));

    expect(onSelect).toHaveBeenCalledTimes(1);
    const [received] = onSelect.mock.calls[0] as [unknown];
    expect(received).toBe('2026-09-17');
    expect(typeof received).toBe('string');
    expect(received).not.toBeInstanceOf(Date);
  });

  it('marks exactly one day selected in single mode', () => {
    render(
      <Calendar
        initialMonth={SEPTEMBER}
        selected="2026-09-09"
        onSelect={jest.fn()}
        locale="en-US"
      />,
    );

    const selected = screen
      .getAllByRole('button')
      .filter((node) => node.props.accessibilityState?.selected === true);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toMatch(dayLabel(9));
    expect(selected[0]?.props.accessibilityLabel).toContain('selected');
  });

  it('is fully controlled — a press does not move the selection on its own', () => {
    render(
      <Calendar
        initialMonth={SEPTEMBER}
        selected="2026-09-09"
        onSelect={jest.fn()}
        locale="en-US"
      />,
    );

    fireEvent.press(screen.getByLabelText(dayLabel(12)));

    const selected = screen
      .getAllByRole('button')
      .filter((node) => node.props.accessibilityState?.selected === true);
    expect(selected[0]?.props.accessibilityLabel).toMatch(dayLabel(9));
  });

  describe('range mode', () => {
    it('opens a half-picked range on the first press', () => {
      const onSelect = jest.fn();
      render(
        <Calendar
          mode="range"
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={onSelect}
          locale="en-US"
        />,
      );

      fireEvent.press(screen.getByLabelText(dayLabel(7)));

      expect(onSelect).toHaveBeenCalledWith({ start: '2026-09-07', end: null });
    });

    it('completes the range on the second press', () => {
      const onSelect = jest.fn();
      render(
        <Calendar
          mode="range"
          initialMonth={SEPTEMBER}
          selected={{ start: '2026-09-07', end: null }}
          onSelect={onSelect}
          locale="en-US"
        />,
      );

      fireEvent.press(screen.getByLabelText(dayLabel(14)));

      expect(onSelect).toHaveBeenCalledWith({ start: '2026-09-07', end: '2026-09-14' });
    });

    it('orders the range low-to-high when the second press is earlier', () => {
      const onSelect = jest.fn();
      render(
        <Calendar
          mode="range"
          initialMonth={SEPTEMBER}
          selected={{ start: '2026-09-14', end: null }}
          onSelect={onSelect}
          locale="en-US"
        />,
      );

      fireEvent.press(screen.getByLabelText(dayLabel(7)));

      expect(onSelect).toHaveBeenCalledWith({ start: '2026-09-07', end: '2026-09-14' });
    });

    it('starts a new range once one is complete', () => {
      const onSelect = jest.fn();
      render(
        <Calendar
          mode="range"
          initialMonth={SEPTEMBER}
          selected={{ start: '2026-09-07', end: '2026-09-14' }}
          onSelect={onSelect}
          locale="en-US"
        />,
      );

      fireEvent.press(screen.getByLabelText(dayLabel(21)));

      expect(onSelect).toHaveBeenCalledWith({ start: '2026-09-21', end: null });
    });

    it('marks both endpoints selected and every day between them as in-range', () => {
      render(
        <Calendar
          mode="range"
          initialMonth={SEPTEMBER}
          selected={{ start: '2026-09-07', end: '2026-09-10' }}
          onSelect={jest.fn()}
          locale="en-US"
        />,
      );

      const selected = screen
        .getAllByRole('button')
        .filter((node) => node.props.accessibilityState?.selected === true)
        .map((node) => node.props.accessibilityLabel as string);
      expect(selected).toHaveLength(2);
      expect(selected[0]).toMatch(dayLabel(7));
      expect(selected[1]).toMatch(dayLabel(10));

      const inRange = screen
        .getAllByRole('button')
        .filter((node) => String(node.props.accessibilityLabel).includes('in selected range'));
      expect(inRange).toHaveLength(2);
      expect(inRange[0]?.props.accessibilityLabel).toMatch(dayLabel(8));
      expect(inRange[1]?.props.accessibilityLabel).toMatch(dayLabel(9));
    });
  });

  describe('markers', () => {
    const markers = new Map<string, CalendarMarker>([
      ['2026-09-03', { color: colors.brand.DEFAULT, label: 'workout logged' }],
      ['2026-09-11', { color: colors.brand.mid, label: 'check-in due' }],
      ['2026-09-28', { color: colors.fg.faint, label: 'rest day' }],
    ]);

    it('renders one dot per marked day and nothing on the rest', () => {
      render(
        <Calendar
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={jest.fn()}
          markers={markers}
          locale="en-US"
        />,
      );

      const marked = screen
        .getAllByRole('button')
        .filter((node) => String(node.props.accessibilityLabel).includes('logged'));
      expect(marked).toHaveLength(1);

      // The marker's meaning reaches a screen reader as words, not only as
      // a hue — DESIGN.md §8's second-channel rule.
      expect(screen.getByLabelText(dayLabel(3)).props.accessibilityLabel).toContain(
        'workout logged',
      );
      expect(screen.getByLabelText(dayLabel(11)).props.accessibilityLabel).toContain(
        'check-in due',
      );
      expect(screen.getByLabelText(dayLabel(4)).props.accessibilityLabel).not.toContain('logged');
    });

    it('ignores a marker for a day outside the visible month', () => {
      render(
        <Calendar
          initialMonth="2026-10-01"
          selected={null}
          onSelect={jest.fn()}
          markers={markers}
          locale="en-US"
        />,
      );

      const marked = screen
        .getAllByRole('button')
        .filter((node) => String(node.props.accessibilityLabel).includes('rest day'));
      expect(marked).toHaveLength(0);
    });
  });

  describe('bounds', () => {
    it('disables days outside min/max and never fires for them', () => {
      const onSelect = jest.fn();
      render(
        <Calendar
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={onSelect}
          minDate="2026-09-10"
          maxDate="2026-09-20"
          locale="en-US"
        />,
      );

      const before = screen.getByLabelText(dayLabel(9));
      const inside = screen.getByLabelText(dayLabel(15));
      const after = screen.getByLabelText(dayLabel(21));

      expect(before.props.accessibilityState?.disabled).toBe(true);
      expect(inside.props.accessibilityState?.disabled).toBe(false);
      expect(after.props.accessibilityState?.disabled).toBe(true);

      fireEvent.press(before);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('keeps a month reachable when its bound falls mid-month', () => {
      render(
        <Calendar
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={jest.fn()}
          minDate="2026-08-20"
          testID="cal"
          locale="en-US"
        />,
      );

      // August is partly in bounds, so back must stay enabled.
      expect(screen.getByTestId('cal-previous').props.accessibilityState?.disabled).toBe(false);
    });
  });

  describe('month navigation', () => {
    it('moves a month at a time and reports the new month as an ISO string', () => {
      const onVisibleMonthChange = jest.fn();
      render(
        <Calendar
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={jest.fn()}
          onVisibleMonthChange={onVisibleMonthChange}
          testID="cal"
          locale="en-US"
        />,
      );

      fireEvent.press(screen.getByTestId('cal-next'));
      expect(onVisibleMonthChange).toHaveBeenCalledWith('2026-10-01');
      expect(screen.getByText('October')).toBeTruthy();

      fireEvent.press(screen.getByTestId('cal-previous'));
      fireEvent.press(screen.getByTestId('cal-previous'));
      expect(onVisibleMonthChange).toHaveBeenLastCalledWith('2026-08-01');
      expect(screen.getByText('August')).toBeTruthy();
    });

    it('renders the year through Metric, with tabular numerals', () => {
      render(
        <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={jest.fn()} locale="en-US" />,
      );

      const year = screen.getByText('2026');
      expect(year.props.style).toEqual(expect.objectContaining({ fontVariant: ['tabular-nums'] }));
    });
  });

  describe('locale', () => {
    // The weekday header is hidden from assistive tech — every day already
    // speaks its own full date — so these queries opt back into it.
    it('starts the week on Monday for en-GB and Sunday for en-US', () => {
      const { rerender } = render(
        <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={jest.fn()} locale="en-GB" />,
      );
      // 1 September 2026 is a Tuesday: Monday-first leaves one lead pad.
      expect(screen.getByText('MON', { includeHiddenElements: true })).toBeTruthy();

      rerender(
        <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={jest.fn()} locale="en-US" />,
      );
      expect(screen.getByText('SUN', { includeHiddenElements: true })).toBeTruthy();
    });

    it('lets a caller override the locale default', () => {
      render(
        <Calendar
          initialMonth={SEPTEMBER}
          selected={null}
          onSelect={jest.fn()}
          locale="en-US"
          weekStartsOn={6}
        />,
      );
      expect(screen.getByText('SAT', { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it('speaks the viewer-supplied today, and never derives one itself', () => {
    render(
      <Calendar
        initialMonth={SEPTEMBER}
        selected={null}
        onSelect={jest.fn()}
        today="2026-09-04"
        locale="en-US"
      />,
    );

    expect(screen.getByLabelText(dayLabel(4)).props.accessibilityLabel).toContain('today');
    expect(screen.getByLabelText(dayLabel(5)).props.accessibilityLabel).not.toContain('today');
  });

  describe('tap target', () => {
    it('meets the 48px floor in both densities', () => {
      // Vertically the cell itself clears 48. Horizontally seven columns
      // cannot each be 48px wide on a phone, so the target is the column
      // plus the `hitSlop` that fills the gap: at 375pt with a 20pt gutter
      // this must still land at or above 48.
      const SCREEN = 375;
      const GUTTER = 20;

      for (const density of ['client', 'coach'] as const) {
        const { minHeight, gap } = CALENDAR_CELL_GEOMETRY[density];
        expect(minHeight).toBeGreaterThanOrEqual(48);

        const columnWidth = (SCREEN - GUTTER * 2 - gap * 6) / 7;
        const effectiveWidth = columnWidth + gap;
        expect(effectiveWidth).toBeGreaterThanOrEqual(48);
      }
    });

    it('applies the hitSlop to every day cell', () => {
      render(
        <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={jest.fn()} locale="en-US" />,
      );

      const cells = screen
        .getAllByRole('button')
        .filter((node) => /^September \d+, 2026/.test(String(node.props.accessibilityLabel)));
      expect(cells).toHaveLength(30);
      for (const cellNode of cells) {
        expect(cellNode.props.hitSlop).toEqual({ top: 0, bottom: 0, left: 3.5, right: 3.5 });
      }
    });
  });

  it('renders no day from a neighbouring month', () => {
    render(
      <Calendar initialMonth={SEPTEMBER} selected={null} onSelect={jest.fn()} locale="en-US" />,
    );

    const labels = screen
      .getAllByRole('button')
      .map((node) => String(node.props.accessibilityLabel))
      .filter((label) => /\d, 2026/.test(label));

    expect(labels).toHaveLength(30);
    expect(labels.every((label) => label.startsWith('September'))).toBe(true);
  });
});
