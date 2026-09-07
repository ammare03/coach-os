import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ProgramDay } from '../../api/programs.ts';
import { AddDaySheet } from '../AddDaySheet.tsx';

// The rule this file exists to hold: **collision is prevented, not
// reported** (`program-builder/01`, frame 1g). A taken slot is inert and
// names its occupant, so `PROGRAM_DAY_TAKEN` is only ever reachable by a
// stale client — and the reason a slot cannot be chosen is spoken, not
// merely drawn (`accessibility` §2).

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

const TAKEN: ProgramDay[] = [
  { id: 'day-1', dayNumber: 1, name: 'Upper', notes: null, isRestDay: false, exerciseCount: 5 },
  { id: 'day-2', dayNumber: 2, name: 'Lower', notes: null, isRestDay: false, exerciseCount: 6 },
];

function renderSheet(overrides: Partial<Parameters<typeof AddDaySheet>[0]> = {}) {
  const onAdd = jest.fn();
  const onDismiss = jest.fn();
  render(
    withSafeArea(
      <AddDaySheet
        isOpen
        weekNumber={5}
        takenDays={TAKEN}
        onAdd={onAdd}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onAdd, onDismiss };
}

describe('AddDaySheet — slot selection', () => {
  it('marks a taken slot disabled, names its occupant, and refuses the tap', () => {
    renderSheet();

    const taken = screen.getByTestId('day-slot-2');
    expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
    expect(taken.props.accessibilityHint).toBe('Already used by Lower');
    expect(screen.getByText('Lower')).toBeTruthy();

    fireEvent.press(taken);
    expect(screen.getByTestId('day-slot-2').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('leaves a free slot selectable and says so', () => {
    renderSheet();

    const free = screen.getByTestId('day-slot-3');
    expect(free.props.accessibilityState).toMatchObject({ disabled: false });
    expect(free.props.accessibilityHint).toBe('Free');

    fireEvent.press(free);
    expect(screen.getByTestId('day-slot-3').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });
});

describe('AddDaySheet — submission', () => {
  it('will not add until a slot and a name are both chosen', () => {
    const { onAdd } = renderSheet();

    fireEvent.press(screen.getByText('Add day'));
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('day-slot-3'));
    fireEvent.press(screen.getByText('Add day'));
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('day-name'), '  Push A  ');
    fireEvent.press(screen.getByText('Add day'));
    expect(onAdd).toHaveBeenCalledWith({ dayNumber: 3, name: 'Push A', isRestDay: false });
  });

  // A rest day needs no name — it has one, and asking for it is asking a
  // coach to type "Rest" seven times a program.
  it('adds a rest day from a slot alone', () => {
    const { onAdd } = renderSheet();

    fireEvent.press(screen.getByText('Rest day'));
    expect(screen.queryByTestId('day-name')).toBeNull();

    fireEvent.press(screen.getByTestId('day-slot-4'));
    fireEvent.press(screen.getByText('Add rest day'));
    expect(onAdd).toHaveBeenCalledWith({ dayNumber: 4, name: 'Rest', isRestDay: true });
  });
});
