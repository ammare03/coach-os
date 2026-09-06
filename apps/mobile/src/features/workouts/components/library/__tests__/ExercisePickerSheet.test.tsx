import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ExercisePickerSheet,
  shorterWordHint,
  type PickerExercise,
} from '../ExercisePickerSheet.tsx';

// The sheet reads `useSafeAreaInsets` for the list's ceiling and its bottom
// padding, which needs a provider with real metrics — the native module
// reports none under Jest.
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

// The search is the only thing this component fetches. The mock records
// what the hook was asked for, so the debounce and the filter can be
// asserted on the INPUT rather than on a spied network layer.
//
// The fixtures are typed as `PickerExercise` — the procedure's own inferred
// row — rather than a hand-written shape, so a column added to
// `exercises.search` fails this file rather than passing against a mirror
// that has quietly drifted (`code-conventions` §3).
interface MockSearchInput {
  query: string;
  movementPattern?: string | undefined;
}

let mockSearchCalls: MockSearchInput[] = [];
let mockRows: PickerExercise[] | undefined = [];
let mockError: unknown = null;
const mockRefetch = jest.fn();

jest.mock('../../../api/exercises.ts', () => ({
  useExercisePickerSearch: (input: MockSearchInput) => {
    mockSearchCalls.push(input);
    return { data: mockRows, error: mockError, refetch: mockRefetch };
  },
}));

const BASE: PickerExercise = {
  id: 'ex-1',
  name: 'Barbell Bent-Over Row',
  aliases: [],
  primaryMuscle: 'Back',
  secondaryMuscles: [],
  equipment: 'Barbell',
  movementPattern: 'pull',
  cues: [],
  isUnilateral: false,
  isBodyweight: false,
  defaultIncrementKg: 2.5,
  demoAssetId: null,
  archivedAt: null,
  isCustom: false,
  matchKind: 'fulltext',
};

const BENT_OVER_ROW = BASE;
const MACHINE_ROW: PickerExercise = {
  ...BASE,
  id: 'ex-2',
  name: 'Machine Row',
  isCustom: true,
  demoAssetId: 'a-1',
};

function renderPicker(overrides: Partial<Parameters<typeof ExercisePickerSheet>[0]> = {}) {
  const onSelect = jest.fn();
  const onDismiss = jest.fn();
  const onCreate = jest.fn();
  render(
    withSafeArea(
      <ExercisePickerSheet
        isOpen
        title="Add to Day 3"
        onSelect={onSelect}
        onCreate={onCreate}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onSelect, onDismiss, onCreate };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchCalls = [];
  mockRows = [BENT_OVER_ROW, MACHINE_ROW];
  mockError = null;
  mockRefetch.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ExercisePickerSheet — selection', () => {
  it('calls onSelect with the chosen exercise and closes the sheet in one tap', () => {
    const { onSelect, onDismiss } = renderPicker();

    fireEvent.press(screen.getByTestId('picker-exercise-ex-1'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex-1' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders no commit footer — the tap is the commit', () => {
    renderPicker();

    expect(screen.queryByText(/^Add \d+ exercise/)).toBeNull();
  });

  it('does not offer a row that is already on the target, and says so to a screen reader', () => {
    const { onSelect } = renderPicker({ alreadyAdded: ['ex-1'] });

    fireEvent.press(screen.getByTestId('picker-exercise-ex-1'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Barbell Bent-Over Row, On this day')).toBeTruthy();
  });

  it("folds the Yours badge and the demo pip into the row's own label", () => {
    renderPicker();

    expect(screen.getByLabelText('Machine Row, your exercise, has a demo video')).toBeTruthy();
  });
});

describe('ExercisePickerSheet — search and filtering', () => {
  it('debounces the query rather than asking on every keystroke', () => {
    renderPicker();
    mockSearchCalls = [];

    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'r');
    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'ro');
    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'row');

    // Re-rendered three times, but still asking for the empty opening query.
    expect(mockSearchCalls.every((call) => call.query === '')).toBe(true);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(mockSearchCalls[mockSearchCalls.length - 1]?.query).toBe('row');
  });

  it('narrows the search by movement pattern, and clears it on a second tap', () => {
    renderPicker();

    fireEvent.press(screen.getByTestId('picker-filter-hinge'));
    expect(mockSearchCalls[mockSearchCalls.length - 1]?.movementPattern).toBe('hinge');

    fireEvent.press(screen.getByTestId('picker-filter-hinge'));
    expect(mockSearchCalls[mockSearchCalls.length - 1]?.movementPattern).toBeUndefined();
  });
});

describe('ExercisePickerSheet — the create door', () => {
  it('keeps the create row after a SUCCESSFUL search, carrying the typed query', () => {
    const { onCreate, onDismiss } = renderPicker();

    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'row');

    fireEvent.press(screen.getByTestId('picker-create'));

    expect(onCreate).toHaveBeenCalledWith('row');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers no create affordance when the consumer cannot author one', () => {
    renderPicker({ onCreate: undefined });

    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'row');

    expect(screen.queryByTestId('picker-create')).toBeNull();
  });

  it('headlines a fuzzy-only answer, and still offers to create', () => {
    mockRows = [{ ...BASE, id: 'ex-3', name: 'Romanian Deadlift', matchKind: 'fuzzy' }];
    renderPicker();

    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'romainian deadlift');

    expect(screen.getByText('Closest matches')).toBeTruthy();
    expect(screen.getByTestId('picker-create')).toBeTruthy();
  });

  it('does not headline an answer that actually matched', () => {
    renderPicker();

    expect(screen.queryByText('Closest matches')).toBeNull();
  });
});

describe('ExercisePickerSheet — the four states', () => {
  it('shows a skeleton, never a spinner, before the first answer', () => {
    mockRows = undefined;
    renderPicker();

    expect(screen.getByLabelText('Loading exercises')).toBeTruthy();
  });

  it('carries the query into the empty state rather than making the coach retype it', async () => {
    mockRows = [];
    const { onCreate } = renderPicker();

    fireEvent.changeText(screen.getByTestId('exercise-picker-search'), 'jefferson curl');

    fireEvent.press(screen.getByText('Create “jefferson curl”'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('jefferson curl');
    });
  });

  it('keeps the cached list and says so quietly when the refresh fails', () => {
    mockError = new Error('offline');
    renderPicker();

    expect(screen.getByTestId('exercise-picker-stale')).toBeTruthy();
    expect(screen.getByTestId('picker-exercise-ex-1')).toBeTruthy();
    expect(screen.queryByTestId('exercise-picker-error')).toBeNull();
  });

  it('offers a retry only when there is nothing cached to fall back to', () => {
    mockRows = undefined;
    mockError = new Error('offline');
    renderPicker();

    fireEvent.press(screen.getByText('Try again'));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the search field usable in every one of those states', () => {
    mockRows = undefined;
    mockError = new Error('offline');
    renderPicker();

    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
    expect(screen.getByTestId('picker-filter-all')).toBeTruthy();
  });
});

describe('shorterWordHint', () => {
  it('suggests the last word of a multi-word query', () => {
    expect(shorterWordHint('jefferson curl')).toBe(
      'Try a shorter word — “curl” rather than “jefferson curl” — or add it as your own.',
    );
  });

  it('invents no shorter word when there is only one', () => {
    expect(shorterWordHint('curl')).toBe('Try a shorter word, or add it as your own exercise.');
  });
});
