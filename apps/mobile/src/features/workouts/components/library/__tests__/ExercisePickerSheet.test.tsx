import { Text } from '@coachos/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ExercisePickerSheet,
  shorterWordHint,
  type ExercisePickerSheetBaseProps,
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

// Base props only. `ExercisePickerSheetProps` is a discriminated union
// (single- versus multi-select), and `Partial<>` over a union makes both
// arms' required discriminant optional — which no caller can then satisfy.
// The multi-select cases build their own element rather than override into
// this one.
function renderPicker(overrides: Partial<ExercisePickerSheetBaseProps> = {}) {
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

// `program-builder/05`'s opt-in mode. What is asserted here is that it IS a
// mode and not a fork: the same search hook, the same filters, the same
// rows and badges, with the row's affordance and the footer as the only
// difference.
describe('ExercisePickerSheet — multi-select', () => {
  function renderMultiSelect(
    selectedIds: readonly string[] = [],
    overrides: Partial<ExercisePickerSheetBaseProps> = {},
  ) {
    const onToggle = jest.fn();
    const onCommit = jest.fn();
    const onDismiss = jest.fn();
    render(
      withSafeArea(
        <ExercisePickerSheet
          isOpen
          title="Approved swaps"
          onDismiss={onDismiss}
          selection={{
            selectedIds,
            onToggle,
            actionLabel: `Approve ${selectedIds.length} swaps`,
            onCommit,
          }}
          {...overrides}
        />,
      ),
    );
    return { onToggle, onCommit, onDismiss };
  }

  it('toggles instead of committing, and leaves the sheet open', () => {
    const { onToggle, onDismiss } = renderMultiSelect();

    fireEvent.press(screen.getByTestId('picker-exercise-ex-1'));

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex-1' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('announces each row as a checkbox carrying its own checked state', () => {
    renderMultiSelect(['ex-1']);

    const selected = screen.getByTestId('picker-exercise-ex-1');
    const unselected = screen.getByTestId('picker-exercise-ex-2');

    expect(selected.props.accessibilityRole).toBe('checkbox');
    expect(selected.props.accessibilityState).toMatchObject({ checked: true });
    expect(unselected.props.accessibilityState).toMatchObject({ checked: false });
  });

  // `includeHiddenElements`, because the box is deliberately hidden from
  // the reading order — the row's own `accessibilityState.checked` above is
  // what announces the state, and saying it twice is the bug that would be.
  // What is asserted here is the OTHER channel: a tick a sighted user can
  // see, so the state is never carried by fill colour alone
  // (`accessibility` §4).
  it('draws a tick on the selected row and none on the unselected one — shape, not hue alone', () => {
    renderMultiSelect(['ex-1']);

    const hidden = { includeHiddenElements: true } as const;
    expect(screen.getByTestId('picker-check-ex-1', hidden).props.children).toBeTruthy();
    expect(screen.getByTestId('picker-check-ex-2', hidden).props.children).toBeFalsy();
  });

  it('renders a commit footer whose label counts', () => {
    renderMultiSelect(['ex-1', 'ex-2']);

    expect(screen.getByText('Approve 2 swaps')).toBeTruthy();
  });

  it('gives the dimmed origin row a badge and no checkbox at all', () => {
    renderMultiSelect([], { alreadyAdded: ['ex-1'], alreadyAddedLabel: 'This one' });

    expect(screen.getByLabelText('Barbell Bent-Over Row, This one')).toBeTruthy();
    // An inert checkbox is a checkbox that looks broken.
    const hidden = { includeHiddenElements: true } as const;
    expect(screen.queryByTestId('picker-check-ex-1', hidden)).toBeNull();
    expect(screen.getByTestId('picker-check-ex-2', hidden)).toBeTruthy();
  });

  it('keeps ONE search implementation — the same hook, filters and ranking as single-select', () => {
    renderMultiSelect([], { initialMovementPattern: 'squat' });

    // The mode changes no search input: the picker is still asking
    // `exercises.search` the same question with the same filter.
    expect(mockSearchCalls[0]).toEqual({ query: '', movementPattern: 'squat' });
    expect(screen.getByLabelText('Search exercises')).toBeTruthy();
    expect(screen.getByTestId('picker-filter-all')).toBeTruthy();
    // The "Yours" badge and the ranked single list, unchanged. Hidden from
    // the reading order by `Badge`'s own contract — the row folds it into
    // its label instead — so it is read back the same way.
    expect(screen.getByText('Yours', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('Machine Row, your exercise, has a demo video')).toBeTruthy();
  });

  it('renders the consumer’s header above the search field', () => {
    renderMultiSelect([], { header: <Text testID="swaps-header">Approved · 2</Text> });

    expect(screen.getByTestId('swaps-header')).toBeTruthy();
  });
});
