import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PickerExercise } from '../../../workouts/components/library/ExercisePickerSheet.tsx';
import { ALTERNATIVE_BOUNDS } from '../../alternatives.ts';
import { ApprovedSwapsSheet } from '../ApprovedSwapsSheet.tsx';

// What this file holds: frame 1f's four decisions, as behaviour.
//
// The **integrity** of what this sheet sends is not tested here and cannot
// be — every id is checked server-side against `training.exercises`,
// because the column has no foreign key and a patched client is exactly the
// case that matters (`apps/api/src/features/programs/program-exercises.test.ts`).
// What is tested here is that a coach using the sheet as designed can never
// reach one of those refusals in the first place.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

interface MockSearchInput {
  query: string;
  movementPattern?: string | undefined;
}

let mockSearchCalls: MockSearchInput[] = [];
let mockRows: PickerExercise[] = [];

jest.mock('../../../workouts/api/exercises.ts', () => ({
  useExercisePickerSearch: (input: MockSearchInput) => {
    mockSearchCalls.push(input);
    return { data: mockRows, error: null, refetch: jest.fn() };
  },
}));

function exercise(id: string, name: string): PickerExercise {
  return {
    id,
    name,
    aliases: [],
    primaryMuscle: 'Quadriceps',
    secondaryMuscles: [],
    equipment: 'Machine',
    movementPattern: 'squat',
    cues: [],
    isUnilateral: false,
    isBodyweight: false,
    defaultIncrementKg: 2.5,
    demoAssetId: null,
    archivedAt: null,
    isCustom: false,
    matchKind: 'fulltext',
  };
}

const ORIGIN = exercise('ex-origin', 'Barbell Back Squat');
const HACK = exercise('ex-hack', 'Hack Squat');
const PRESS = exercise('ex-press', 'Leg Press');

function renderSheet(
  approved: { id: string; name: string }[] = [],
  overrides: { saveError?: string } = {},
) {
  const onSave = jest.fn();
  const onDismiss = jest.fn();
  render(
    withSafeArea(
      <ApprovedSwapsSheet
        isOpen
        originExerciseId={ORIGIN.id}
        originExerciseName={ORIGIN.name}
        originMovementPattern="squat"
        approved={approved}
        onSave={onSave}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onSave, onDismiss };
}

const HIDDEN = { includeHiddenElements: true } as const;

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchCalls = [];
  mockRows = [HACK, PRESS, ORIGIN];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ApprovedSwapsSheet', () => {
  it('opens the pattern filter on the block’s own movement, with All still one tap away', () => {
    renderSheet();

    expect(mockSearchCalls[0]).toEqual({ query: '', movementPattern: 'squat' });
    expect(screen.getByTestId('picker-filter-all')).toBeTruthy();
  });

  it('shows what is already approved as chips, above the picker', () => {
    renderSheet([{ id: HACK.id, name: 'Hack Squat' }]);

    expect(screen.getByTestId(`swaps-chip-${HACK.id}`, HIDDEN)).toBeTruthy();
    expect(screen.getByText('Approved · 1')).toBeTruthy();
  });

  it('gives every chip a removal control a screen reader can find and name', () => {
    const { onSave } = renderSheet([{ id: HACK.id, name: 'Hack Squat' }]);

    fireEvent.press(screen.getByLabelText('Remove Hack Squat'));
    fireEvent.press(screen.getByText('Save with no swaps'));

    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('counts on the commit, and sends the coach’s own order', () => {
    const { onSave } = renderSheet();

    fireEvent.press(screen.getByTestId(`picker-exercise-${PRESS.id}`));
    fireEvent.press(screen.getByTestId(`picker-exercise-${HACK.id}`));

    expect(screen.getByText('Approve 2 swaps')).toBeTruthy();
    fireEvent.press(screen.getByText('Approve 2 swaps'));
    expect(onSave).toHaveBeenCalledWith([PRESS.id, HACK.id]);
  });

  it('shows the origin exercise dimmed and badged, and refuses to select it', () => {
    const { onSave } = renderSheet();

    fireEvent.press(screen.getByTestId(`picker-exercise-${ORIGIN.id}`));

    expect(screen.getByLabelText('Barbell Back Squat, This one')).toBeTruthy();
    // Nothing selected, so the commit still reads as the empty save.
    expect(screen.getByText('Save with no swaps')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the commit inert until something actually changes', () => {
    renderSheet([{ id: HACK.id, name: 'Hack Squat' }]);

    expect(
      screen.getByRole('button', { name: 'Approve 1 swap' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    fireEvent.press(screen.getByTestId(`picker-exercise-${PRESS.id}`));

    expect(
      screen.getByRole('button', { name: 'Approve 2 swaps' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it('names an exercise added in this sitting on its own chip, before anything is saved', () => {
    renderSheet();

    fireEvent.press(screen.getByTestId(`picker-exercise-${HACK.id}`));

    expect(screen.getByLabelText('Remove Hack Squat')).toBeTruthy();
  });

  it('says what the empty state is rather than showing an empty chip row', () => {
    renderSheet();

    expect(screen.getByTestId('swaps-none')).toBeTruthy();
    expect(screen.queryByTestId('swaps-chips')).toBeNull();
  });

  it('states the ceiling only once it is actually reached, and refuses one more', () => {
    const full = Array.from({ length: ALTERNATIVE_BOUNDS.maxApproved }, (_, index) => ({
      id: `ex-${index}`,
      name: `Approved ${index}`,
    }));
    const { onSave } = renderSheet(full);

    expect(screen.getByTestId('swaps-limit')).toBeTruthy();

    fireEvent.press(screen.getByTestId(`picker-exercise-${HACK.id}`));
    // Still exactly the ceiling — the tap did nothing, and the label says so.
    fireEvent.press(screen.getByText(`Approve ${ALTERNATIVE_BOUNDS.maxApproved} swaps`));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders a server refusal inside the sheet the coach is standing in', () => {
    renderSheet([], { saveError: 'An exercise cannot be a swap for itself.' });

    const error = screen.getByTestId('swaps-save-error');
    expect(error).toHaveTextContent('An exercise cannot be a swap for itself.');
    expect(error.props.accessibilityRole).toBe('alert');
  });
});
