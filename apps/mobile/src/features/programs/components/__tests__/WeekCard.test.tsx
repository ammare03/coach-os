import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ProgramWeek } from '../../api/programs.ts';
import { WeekCard } from '../WeekCard.tsx';

// The card IS the week (`program-builder/01`, decision (a)), and a rest day
// is neutral rather than red (decision, `DESIGN.md` §10.5). Both are
// assertable without a snapshot: the first from what the header exposes to
// a screen reader, the second from the row's own words.

const WEEK: ProgramWeek = {
  id: 'week-1',
  weekNumber: 1,
  notes: null,
  days: [
    {
      id: 'day-1',
      dayNumber: 1,
      name: 'Upper — press focus',
      notes: null,
      isRestDay: false,
      exerciseCount: 5,
    },
    { id: 'day-3', dayNumber: 3, name: 'Rest', notes: null, isRestDay: true, exerciseCount: 0 },
  ],
};

function renderCard(overrides: Partial<Parameters<typeof WeekCard>[0]> = {}) {
  const onToggle = jest.fn();
  const onOpenDay = jest.fn();
  const onAddDay = jest.fn();
  render(
    <WeekCard
      week={WEEK}
      isExpanded
      onToggle={onToggle}
      onOpenDay={onOpenDay}
      onAddDay={onAddDay}
      {...overrides}
    />,
  );
  return { onToggle, onOpenDay, onAddDay };
}

describe('WeekCard', () => {
  it('states the week and its volume, and reports its expanded state to a screen reader', () => {
    renderCard();

    const header = screen.getByTestId('week-header-1');
    expect(header.props.accessibilityLabel).toBe('Week 1');
    expect(header.props.accessibilityHint).toBe('1 training day · 5 exercises');
    expect(header.props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('collapses to the header alone — the toggle is the caller’s, so the page never reflows twice', () => {
    const { onToggle } = renderCard();
    fireEvent.press(screen.getByTestId('week-header-1'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    render(
      <WeekCard
        week={WEEK}
        isExpanded={false}
        onToggle={jest.fn()}
        onOpenDay={jest.fn()}
        onAddDay={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('day-row-day-1')).toBeNull();
    expect(screen.queryByTestId('add-day-1')).toBeNull();
  });

  // The failure this guards against is a later phase reaching for the
  // adherence ramp to mark a rest day. The meaning must live in words, not
  // in a hue (`accessibility` §4).
  it('describes a rest day in words, with no adherence or urgent wording', () => {
    renderCard();

    const restRow = screen.getByTestId('day-row-day-3');
    expect(restRow.props.accessibilityLabel).toBe('Wednesday, Rest');
    expect(restRow.props.accessibilityHint).toBe('no session');
    expect(screen.getByText('no session')).toBeTruthy();
  });

  it('opens a day and offers to add one', () => {
    const { onOpenDay, onAddDay } = renderCard();

    fireEvent.press(screen.getByTestId('day-row-day-1'));
    expect(onOpenDay).toHaveBeenCalledWith('day-1');

    const addDay = screen.getByTestId('add-day-1');
    expect(addDay.props.accessibilityLabel).toBe('Add a day to week 1');
    fireEvent.press(addDay);
    expect(onAddDay).toHaveBeenCalledTimes(1);
  });

  // Task 06 lands duplicate/delete behind the kebab; until then the slot is
  // absent rather than inert.
  it('renders the week menu only when it has somewhere to go', () => {
    renderCard();
    expect(screen.queryByTestId('week-menu-1')).toBeNull();

    const onWeekMenu = jest.fn();
    render(
      <WeekCard
        week={WEEK}
        isExpanded
        onToggle={jest.fn()}
        onOpenDay={jest.fn()}
        onAddDay={jest.fn()}
        onWeekMenu={onWeekMenu}
      />,
    );
    fireEvent.press(screen.getByTestId('week-menu-1'));
    expect(onWeekMenu).toHaveBeenCalledTimes(1);
  });
});
