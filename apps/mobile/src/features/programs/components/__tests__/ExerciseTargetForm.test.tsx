import { programs as programsSchemas } from '@coachos/schemas';
import type { WeightUnit } from '@coachos/utils';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { INTENSITY_CLEAR_HINT, TEMPO_INCOMPLETE_MESSAGE } from '../../exercise-targets.ts';
import { ExerciseTargetForm } from '../ExerciseTargetForm.tsx';

// The sheet reads the coach's display unit from `me.get`. What it does with
// it — which step, which numeral, which kilograms it commits — is the
// subject of the last describe below; fetching it is not.
let mockWeightUnit: WeightUnit = 'kg';
jest.mock('../../../../hooks/useWeightUnit.ts', () => ({
  useWeightUnit: () => mockWeightUnit,
}));

beforeEach(() => {
  mockWeightUnit = 'kg';
});

// The two rules this sheet exists to hold (`program-builder/02`, frame 1c):
//
// 1. Cross-field rep validation is LIVE — the coach sees it while typing,
//    not after a round trip.
// 2. The commit button degrades to an inert state that SAYS what is wrong.
//    A silently greyed-out button is the failure mode this replaces.
//
// Queried by accessibility label wherever possible (`testing` §6) — the
// test then doubles as the accessibility check.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

function renderForm(overrides: Partial<Parameters<typeof ExerciseTargetForm>[0]> = {}) {
  const onSubmit = jest.fn();
  const onDismiss = jest.fn();
  render(
    withSafeArea(
      <ExerciseTargetForm
        isOpen
        mode="create"
        exerciseName="Barbell Back Squat"
        exerciseMeta="quads · barbell"
        onSubmit={onSubmit}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onSubmit, onDismiss };
}

describe('ExerciseTargetForm — defaults', () => {
  it('opens pre-filled, so adding an exercise is a confirm rather than a form', () => {
    renderForm();

    expect(screen.getByLabelText('Lowest rep').props.value).toBe('6');
    expect(screen.getByLabelText('Highest rep').props.value).toBe('8');
    expect(screen.getByText('Add exercise')).toBeTruthy();
  });

  it('prints every DB§5.2 bound as a sub-label before the coach can reach it', () => {
    renderForm();

    expect(screen.getByText('1–20')).toBeTruthy();
    expect(screen.getByText('1–10, half steps')).toBeTruthy();
  });

  it('commits the defaults untouched', () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByText('Add exercise'));

    expect(onSubmit).toHaveBeenCalledWith({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8,
      targetRestSeconds: 90,
    });
  });
});

describe('ExerciseTargetForm — live cross-field rep validation', () => {
  it('shows the inline message as soon as the top drops below the bottom', () => {
    renderForm();

    fireEvent.changeText(screen.getByLabelText('Highest rep'), '4');

    expect(screen.getByText(programsSchemas.REP_RANGE_ORDER_MESSAGE)).toBeTruthy();
  });

  it('replaces the commit label with what is wrong, and refuses to submit', () => {
    const { onSubmit } = renderForm();

    fireEvent.changeText(screen.getByLabelText('Highest rep'), '4');

    const action = screen.getByText('Fix the rep range to continue');
    expect(screen.queryByText('Add exercise')).toBeNull();

    fireEvent.press(action);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('recovers the moment the range is valid again', () => {
    const { onSubmit } = renderForm();

    fireEvent.changeText(screen.getByLabelText('Highest rep'), '4');
    fireEvent.changeText(screen.getByLabelText('Highest rep'), '10');

    expect(screen.queryByText(programsSchemas.REP_RANGE_ORDER_MESSAGE)).toBeNull();
    fireEvent.press(screen.getByText('Add exercise'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetRepsMax: 10 }));
  });

  it('speaks the reason to a screen reader rather than only drawing it', () => {
    renderForm();

    fireEvent.changeText(screen.getByLabelText('Highest rep'), '4');

    expect(screen.getByLabelText('Highest rep').props.accessibilityHint).toBe(
      programsSchemas.REP_RANGE_ORDER_MESSAGE,
    );
  });
});

describe('ExerciseTargetForm — tempo', () => {
  it('is four separate positions, each captioned in plain English', () => {
    renderForm();

    expect(screen.getByLabelText('Tempo, down')).toBeTruthy();
    expect(screen.getByLabelText('Tempo, up')).toBeTruthy();
    expect(screen.getAllByLabelText('Tempo, pause')).toHaveLength(2);
  });

  it('refuses a character the DB§5.2 regex would not accept, per keystroke', () => {
    renderForm();

    const first = screen.getByLabelText('Tempo, down');
    fireEvent.changeText(first, 'b');
    expect(first.props.value).toBe('');

    fireEvent.changeText(first, 'x');
    expect(screen.getByLabelText('Tempo, down').props.value).toBe('X');
  });

  it('blocks the commit on a partly-filled tempo and says which part is wrong', () => {
    const { onSubmit } = renderForm();

    fireEvent.changeText(screen.getByLabelText('Tempo, down'), '3');

    expect(screen.getByText(TEMPO_INCOMPLETE_MESSAGE)).toBeTruthy();
    fireEvent.press(screen.getByText('Fix the tempo to continue'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('commits a complete tempo as one four-character string', () => {
    const { onSubmit } = renderForm();
    const [bottomPause, topPause] = screen.getAllByLabelText('Tempo, pause');
    if (!bottomPause || !topPause) throw new Error('expected two pause positions');

    fireEvent.changeText(screen.getByLabelText('Tempo, down'), '3');
    fireEvent.changeText(bottomPause, '0');
    fireEvent.changeText(screen.getByLabelText('Tempo, up'), '1');
    fireEvent.changeText(topPause, '0');

    fireEvent.press(screen.getByText('Add exercise'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tempo: '3010' }));
  });
});

describe('ExerciseTargetForm — intensity', () => {
  it('offers exactly the four modes, and sends only the chosen one', () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByText('RIR'));
    fireEvent.press(screen.getByText('Add exercise'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetRir: 2 }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('targetRpe');
  });

  // `None` is gone from the control — an absolute load is a real
  // prescription and took the fourth segment. No intensity at all is still
  // reachable, by pressing the segment that is already on.
  it('clears the intensity when the highlighted segment is pressed again', () => {
    const { onSubmit } = renderForm();

    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByText(INTENSITY_CLEAR_HINT)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('RPE, tab 1 of 4'));

    expect(screen.getByText('The client trains this to the rep range alone.')).toBeTruthy();
    expect(screen.queryByText(INTENSITY_CLEAR_HINT)).toBeNull();
    fireEvent.press(screen.getByText('Add exercise'));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('targetRpe');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('targetWeightKg');
  });

  it('leaves no segment claiming to be selected once the intensity is cleared', () => {
    renderForm();

    fireEvent.press(screen.getByLabelText('RPE, tab 1 of 4'));

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);
    expect(selected).toHaveLength(0);
  });

  it('takes the intensity back after it was cleared', () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByLabelText('RPE, tab 1 of 4'));
    fireEvent.press(screen.getByLabelText('RPE, tab 1 of 4'));

    fireEvent.press(screen.getByText('Add exercise'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetRpe: 8 }));
  });

  it('steps RPE in halves, within its DB§5.2 bound', () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByLabelText('Increase RPE'));
    fireEvent.press(screen.getByLabelText('Increase RPE'));

    fireEvent.press(screen.getByText('Add exercise'));
    // 8 → 8.5 → 9, and the 10 ceiling is the stepper's own `max`.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetRpe: 9 }));
  });
});

// The amendment's whole point, at the surface a coach actually touches:
// they type a load in their own unit and the product stores kilograms.
describe('ExerciseTargetForm — an absolute target weight', () => {
  it('prints the unit and the plate increment before either is needed', () => {
    renderForm();

    fireEvent.press(screen.getByText('Weight'));

    expect(screen.getByText('2.5 kg steps')).toBeTruthy();
    expect(screen.getByLabelText('Increase weight')).toBeTruthy();
  });

  it('commits kilograms for a coach who reads kilograms', () => {
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByText('Weight'));
    fireEvent.press(screen.getByText('Add exercise'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 60 }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('targetRpe');
  });

  it('steps in the coach’s own unit and still commits kilograms', () => {
    mockWeightUnit = 'lb';
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByText('Weight'));
    // 60 kg reads as 132 lb; one press of a 5 lb plate step makes it 137.
    expect(screen.getByText('5 lb steps')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Increase weight'));
    fireEvent.press(screen.getByText('Add exercise'));

    // 137 lb is 62.1421… kg, rounded once to numeric(6, 2)'s own scale.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 62.14 }));
  });

  it('never sends the unit itself — the wire is kilograms', () => {
    mockWeightUnit = 'lb';
    const { onSubmit } = renderForm();

    fireEvent.press(screen.getByText('Weight'));
    fireEvent.press(screen.getByText('Add exercise'));

    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('weightUnit');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('targetWeightLb');
  });
});

describe('ExerciseTargetForm — edit mode', () => {
  it('names the commit for what it does and offers the removal', () => {
    const onRemove = jest.fn();
    renderForm({ mode: 'edit', onRemove });

    expect(screen.getByText('Save targets')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Remove this exercise from the day'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('offers no removal in create mode — there is nothing yet to remove', () => {
    renderForm();

    expect(screen.queryByLabelText('Remove this exercise from the day')).toBeNull();
  });

  it('renders a server refusal in the sheet rather than swallowing it', () => {
    renderForm({ saveError: 'A day holds up to 30 exercises.' });

    expect(screen.getByTestId('target-save-error')).toBeTruthy();
    expect(screen.getByText('A day holds up to 30 exercises.')).toBeTruthy();
  });
});

// `program-builder/05` appended a section here without restructuring
// anything above it, which is what "composable on purpose" was supposed to
// mean. These assert the seam: the section is edit-only, it shows the
// current answer without opening anything, and it reads as ONE control to a
// screen reader rather than a label and a button to be associated.
describe('ExerciseTargetForm — approved swaps', () => {
  const SECTION = {
    originExerciseId: 'ex-origin',
    originMovementPattern: 'squat',
    approved: [
      { id: 'ex-hack', name: 'Hack Squat' },
      { id: 'ex-press', name: 'Leg Press' },
    ],
    onSave: jest.fn(),
  } as const;

  it('is absent in create mode — there is no row yet to attach swaps to', () => {
    renderForm({ mode: 'create' });

    expect(screen.queryByTestId('target-alternatives')).toBeNull();
  });

  it('is absent in edit mode too when the caller does not wire it', () => {
    renderForm({ mode: 'edit' });

    expect(screen.queryByTestId('target-alternatives')).toBeNull();
  });

  it('shows the current answer without opening anything', () => {
    renderForm({ mode: 'edit', alternatives: SECTION });

    expect(screen.getByText('Hack Squat, Leg Press')).toBeTruthy();
  });

  it('reads as one control carrying the count, the names and the action', () => {
    renderForm({ mode: 'edit', alternatives: SECTION });

    const row = screen.getByTestId('target-alternatives');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe(
      'Approved swaps. 2 approved swaps: Hack Squat, Leg Press',
    );
    expect(row.props.accessibilityHint).toBe('Opens the exercise picker to change them');
  });

  it('says what the row is for when nothing is approved yet', () => {
    renderForm({ mode: 'edit', alternatives: { ...SECTION, approved: [] } });

    expect(screen.getByText('Add approved swaps')).toBeTruthy();
    expect(screen.getByLabelText('Approved swaps. No approved swaps yet')).toBeTruthy();
  });
});
