import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ProgramDay, ProgramWeek } from '../../api/programs.ts';
import { CopySheet } from '../CopySheet.tsx';

// The two rules the copy-to sheet exists to hold (`program-builder/06`,
// frame 1g):
//
// **Collision is prevented, not reported** — a taken slot is inert and
// names its occupant, so the coach cannot pick the failure, and the reason
// is spoken rather than merely drawn (`accessibility` §2).
//
// **The sheet promises exactly what the transaction copies** — the summary
// and the footnote both name targets, supersets and approved swaps. A
// partial copy that looks complete is the risk this whole task exists to
// prevent, so the promise is asserted here, not just the mechanics.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

const UPPER: ProgramDay = {
  id: 'day-1',
  dayNumber: 1,
  name: 'Upper',
  notes: null,
  isRestDay: false,
  exerciseCount: 5,
};

/** The day being copied — a superset and three approved swaps live under it. */
const LOWER: ProgramDay = {
  id: 'day-2',
  dayNumber: 2,
  name: 'Lower',
  notes: null,
  isRestDay: false,
  exerciseCount: 6,
};

const WEEK_1: ProgramWeek = {
  id: 'week-1',
  weekNumber: 1,
  notes: null,
  days: [UPPER, LOWER],
};

const WEEK_2: ProgramWeek = {
  id: 'week-2',
  weekNumber: 2,
  notes: null,
  days: [
    {
      id: 'day-4',
      dayNumber: 4,
      name: 'Pull',
      notes: null,
      isRestDay: false,
      exerciseCount: 5,
    },
  ],
};

const WEEKS = [WEEK_1, WEEK_2];

function renderDaySheet(overrides: Partial<Parameters<typeof CopySheet>[0]> = {}) {
  const onCopy = jest.fn();
  const onDismiss = jest.fn();
  render(
    withSafeArea(
      <CopySheet
        isOpen
        subject={{ kind: 'day', day: LOWER, sourceWeekNumber: 1 }}
        weeks={WEEKS}
        targetWeekNumber={3}
        onCopy={onCopy}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onCopy, onDismiss };
}

describe('CopySheet — a day', () => {
  it('promises everything the transaction copies, twice: a summary and a footnote', () => {
    renderDaySheet();

    expect(screen.getByTestId('copy-summary').props.children).toBe(
      '6 exercises come across, with every target, superset and approved swap.',
    );
    expect(screen.getByTestId('copy-footnote').props.children).toContain(
      'targets, supersets or approved swaps',
    );
  });

  it('marks a taken slot disabled, names its occupant, and refuses the tap', () => {
    renderDaySheet();

    // The sheet opens on the source day's own week, so Monday and Tuesday
    // are already taken there.
    const taken = screen.getByTestId('copy-day-slot-1');
    expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
    expect(taken.props.accessibilityHint).toBe('Already used by Upper');

    fireEvent.press(taken);
    expect(screen.getByTestId('copy-day-slot-1').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('says what is missing while inert, and what it will do once a free day is picked', () => {
    const { onCopy } = renderDaySheet();

    expect(screen.getByText('Pick a free day to copy into')).toBeTruthy();

    fireEvent.press(screen.getByTestId('copy-day-slot-3'));
    expect(screen.getByText('Copy into Wednesday of week 1')).toBeTruthy();

    fireEvent.press(screen.getByText('Copy into Wednesday of week 1'));
    expect(onCopy).toHaveBeenCalledWith({
      kind: 'day',
      targetWeekId: 'week-1',
      targetDayNumber: 3,
    });
  });

  it('re-reads the slots when the week changes — a free slot in one week is not free in another', () => {
    const { onCopy } = renderDaySheet();

    fireEvent.press(screen.getByTestId('copy-day-slot-3'));
    fireEvent.press(screen.getByTestId('copy-week-2'));

    // The day selection is cleared with the week, so the commit cannot
    // carry a slot the coach picked against a different week's occupancy.
    expect(screen.getByText('Pick a free day to copy into')).toBeTruthy();
    expect(screen.getByTestId('copy-day-slot-1').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    expect(screen.getByTestId('copy-day-slot-4').props.accessibilityHint).toBe(
      'Already used by Pull',
    );
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('renders the backstop refusal as an alert that names the recovery', () => {
    renderDaySheet({ errorCode: 'PROGRAM_DAY_TAKEN' });

    const error = screen.getByTestId('copy-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(error.props.children).toContain('Pick a free day');
  });
});

describe('CopySheet — a whole week', () => {
  function renderWeekSheet(overrides: Partial<Parameters<typeof CopySheet>[0]> = {}) {
    const onCopy = jest.fn();
    const onDismiss = jest.fn();
    render(
      withSafeArea(
        <CopySheet
          isOpen
          subject={{ kind: 'week', week: WEEK_1 }}
          weeks={WEEKS}
          targetWeekNumber={3}
          onCopy={onCopy}
          onDismiss={onDismiss}
          {...overrides}
        />,
      ),
    );
    return { onCopy, onDismiss };
  }

  it('states where the copy lands, and copies with one press — no slot to collide with', () => {
    const { onCopy } = renderWeekSheet();

    expect(screen.getByTestId('copy-summary').props.children).toBe(
      '2 days and 11 exercises come across, with every target, superset and approved swap.',
    );
    expect(screen.getByTestId('copy-week-destination').props.children).toBe(
      'Week 3, the next free week in this program.',
    );

    fireEvent.press(screen.getByText('Copy into week 3'));
    expect(onCopy).toHaveBeenCalledWith({ kind: 'week' });
  });

  it('goes inert at the 104-week ceiling, and says why rather than greying out', () => {
    const { onCopy } = renderWeekSheet({ targetWeekNumber: null });

    fireEvent.press(screen.getByText('This program is already 104 weeks long'));
    expect(onCopy).not.toHaveBeenCalled();
  });
});
