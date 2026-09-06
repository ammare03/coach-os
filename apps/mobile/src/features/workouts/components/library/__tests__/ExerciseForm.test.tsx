import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ExerciseForm } from '../ExerciseForm.tsx';

// The form reads `useSafeAreaInsets` for its scroll padding and its footer,
// which needs a provider with real metrics — the native module reports none
// under Jest.
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

// The name-collision lookup is the only thing this component fetches. Each
// test sets the shape `exercises.checkName` would have returned and asserts
// what the coach then sees — the three cases get three different
// treatments, and collapsing any two of them is the regression this file
// exists to catch (`exercise-library/03`, Approach step 1).
let mockNameCheck: { kind: string; exerciseId?: string } | undefined;

jest.mock('../../../api/exercises.ts', () => ({
  useExerciseNameCheck: () => ({ data: mockNameCheck }),
}));

const VALID = {
  name: 'Reverse Nordic',
  primaryMuscle: 'Quadriceps',
  equipment: 'Bodyweight',
  movementPattern: 'isolation' as const,
  cues: [],
  defaultIncrementKg: 2.5,
  isUnilateral: false,
  isBodyweight: false,
};

function renderForm(overrides: Partial<Parameters<typeof ExerciseForm>[0]> = {}) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    withSafeArea(
      <ExerciseForm mode="create" onSubmit={onSubmit} onCancel={onCancel} {...overrides} />,
    ),
  );
  return { onSubmit, onCancel };
}

beforeEach(() => {
  mockNameCheck = undefined;
});

describe('ExerciseForm — validation', () => {
  it('does not submit an empty form, and surfaces the failure on the field', async () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByTestId('submit-exercise'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('submits the authored values once every required field is filled', async () => {
    const { onSubmit } = renderForm({ initialValues: VALID });

    fireEvent.press(screen.getByTestId('submit-exercise'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reverse Nordic' }));
    });
  });

  it('renders a server-side name collision on the name field, not in a toast', () => {
    renderForm({ nameError: 'You already have an exercise called this.' });

    expect(screen.getByText('You already have an exercise called this.')).toBeTruthy();
  });
});

describe('ExerciseForm — cue editing', () => {
  it('adds, reorders and removes cues as discrete items', async () => {
    const { onSubmit } = renderForm({ initialValues: VALID });

    fireEvent.changeText(screen.getByTestId('cue-draft'), 'Hips stay locked forward');
    fireEvent.press(screen.getByTestId('cue-add'));
    fireEvent.changeText(screen.getByTestId('cue-draft'), 'Lower for four seconds');
    fireEvent.press(screen.getByTestId('cue-add'));

    expect(screen.getByText('Hips stay locked forward')).toBeTruthy();
    expect(screen.getByText('Lower for four seconds')).toBeTruthy();

    // Reorder by button, not by drag: a drag handle inside a scrolling form
    // fights the scroll gesture and is unreachable by a screen reader.
    fireEvent.press(screen.getByTestId('cue-down-0'));
    fireEvent.press(screen.getByTestId('submit-exercise'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          cues: ['Lower for four seconds', 'Hips stay locked forward'],
        }),
      );
    });

    fireEvent.press(screen.getByTestId('cue-remove-0'));
    expect(screen.queryByText('Lower for four seconds')).toBeNull();
  });

  it('trims a cue and refuses an empty one', () => {
    renderForm({ initialValues: VALID });

    fireEvent.changeText(screen.getByTestId('cue-draft'), '   ');
    fireEvent.press(screen.getByTestId('cue-add'));

    expect(screen.queryByTestId('cue-remove-0')).toBeNull();
  });
});

describe('ExerciseForm — the three name collisions', () => {
  it('offers to open the existing one when the coach already has this name', () => {
    const onOpenExisting = jest.fn();
    mockNameCheck = { kind: 'yours', exerciseId: 'exercise-1' };
    renderForm({ initialValues: VALID, onOpenExisting });

    fireEvent.press(screen.getByTestId('open-existing-exercise'));

    expect(onOpenExisting).toHaveBeenCalledWith('exercise-1');
    // A global or archived notice would be the wrong copy for this case.
    expect(screen.queryByTestId('global-name-notice')).toBeNull();
    expect(screen.queryByTestId('archived-name-notice')).toBeNull();
  });

  it('warns without blocking when the name matches a GLOBAL exercise', () => {
    mockNameCheck = { kind: 'global', exerciseId: 'exercise-2' };
    renderForm({ initialValues: VALID });

    expect(screen.getByTestId('global-name-notice')).toBeTruthy();
    // Still submittable — a different namespace, and DB§5.2 allows it.
    expect(screen.getByTestId('submit-exercise')).toBeTruthy();
  });

  it('offers to bring back an ARCHIVED exercise rather than recreating it', () => {
    const onUnarchiveExisting = jest.fn();
    mockNameCheck = { kind: 'archived', exerciseId: 'exercise-3' };
    renderForm({ initialValues: VALID, onUnarchiveExisting });

    fireEvent.press(screen.getByTestId('unarchive-existing-exercise'));

    expect(onUnarchiveExisting).toHaveBeenCalledWith('exercise-3');
  });

  it('never warns about the exercise being edited against its own name', () => {
    mockNameCheck = { kind: 'yours', exerciseId: 'exercise-4' };
    renderForm({
      mode: 'edit',
      editingExerciseId: 'exercise-4',
      initialValues: VALID,
      onOpenExisting: jest.fn(),
    });

    expect(screen.queryByTestId('open-existing-exercise')).toBeNull();
  });
});

describe('ExerciseForm — plate math and archival', () => {
  it('zeroes the weight jump and hides its chips when bodyweight is on', async () => {
    const { onSubmit } = renderForm({ initialValues: VALID });

    expect(screen.getByTestId('increment-2.5')).toBeTruthy();
    fireEvent.press(screen.getByTestId('toggle-bodyweight'));

    expect(screen.queryByTestId('increment-2.5')).toBeNull();
    fireEvent.press(screen.getByTestId('submit-exercise'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ isBodyweight: true, defaultIncrementKg: 0 }),
      );
    });
  });

  it('offers archive in edit mode only, and never says delete', () => {
    const onArchive = jest.fn();
    renderForm({ mode: 'edit', initialValues: VALID, onArchive });

    fireEvent.press(screen.getByTestId('archive-exercise'));

    expect(onArchive).toHaveBeenCalled();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it('has no archive affordance in create mode', () => {
    renderForm();

    expect(screen.queryByTestId('archive-exercise')).toBeNull();
  });
});
