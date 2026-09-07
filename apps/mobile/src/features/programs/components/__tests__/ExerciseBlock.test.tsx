import { formatTargetScheme, type WeightUnit } from '@coachos/utils';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ProgramDayExercise } from '../../api/programs.ts';
import { ExerciseBlock } from '../ExerciseBlock.tsx';

// The block reads the coach's display unit from `me.get`; what it does with
// it is this file's subject, and what tRPC does to fetch it is not.
let mockWeightUnit: WeightUnit = 'kg';
jest.mock('../../../../hooks/useWeightUnit.ts', () => ({
  useWeightUnit: () => mockWeightUnit,
}));

beforeEach(() => {
  mockWeightUnit = 'kg';
});

// The decision this file holds: **the scheme line is one string, built in
// `packages/utils`, and it is the same string the client's logger shows as
// its target line** (`program-builder/02`, frame 1b). Asserting the block
// renders exactly what `formatTargetScheme` returns is what stops a later
// edit reassembling it here and quietly diverging from the logger.

const BLOCK: ProgramDayExercise = {
  id: 'block-1',
  exerciseId: 'exercise-1',
  orderIndex: 1,
  targetSets: 4,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetRpe: 8,
  targetRir: null,
  targetPercent1rm: null,
  targetWeightKg: null,
  targetRestSeconds: 90,
  tempo: '3010',
  supersetGroup: null,
  coachNotes: 'Top set first, then two back-offs at the same load.',
  exerciseName: 'Barbell Back Squat',
  exercisePrimaryMuscle: 'quads',
  exerciseEquipment: 'barbell',
};

function renderBlock(overrides: Partial<ProgramDayExercise> = {}) {
  const onPress = jest.fn();
  render(<ExerciseBlock block={{ ...BLOCK, ...overrides }} onPress={onPress} testID="block" />);
  return { onPress };
}

describe('ExerciseBlock', () => {
  it('renders the shared scheme line verbatim, and gives it to a screen reader as the summary', () => {
    renderBlock();

    expect(screen.getByText('4 × 6–8 · RPE 8 · 3010 · 90s')).toBeTruthy();
    expect(screen.getByText(formatTargetScheme(BLOCK, 'kg'))).toBeTruthy();
    expect(screen.getByTestId('block-open').props.accessibilityHint).toBe(
      formatTargetScheme(BLOCK, 'kg'),
    );
    expect(screen.getByTestId('block-open').props.accessibilityLabel).toBe('Barbell Back Squat');
  });

  // The chips repeat, visually, what the header's hint already says — so
  // they are hidden from the screen reader rather than announced twenty
  // times, and the queries below have to opt back in to see them.
  const HIDDEN = { includeHiddenElements: true } as const;

  it('draws one chip per set, reps above intensity', () => {
    renderBlock();

    expect(screen.getByTestId('set-chip-1-reps', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('set-chip-4-reps', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('set-chip-5-reps', HIDDEN)).toBeNull();
    // Reps on top — the number the client acts on.
    expect(screen.getAllByText('6–8', HIDDEN)).toHaveLength(4);
    expect(screen.getAllByText('RPE 8', HIDDEN)).toHaveLength(4);
  });

  it('drops "1RM" on the chip while the scheme line keeps it', () => {
    renderBlock({
      targetRpe: null,
      targetPercent1rm: 65,
      tempo: null,
      targetRepsMin: 10,
      targetRepsMax: 12,
    });

    expect(screen.getAllByText('65%', HIDDEN)).toHaveLength(4);
    expect(screen.getByText('4 × 10–12 · 65% 1RM · 90s')).toBeTruthy();
  });

  // An absolute load is one of the four intensities, so it lands in the
  // same slot RPE would have — and it is rendered in the coach's own unit
  // from one stored kilogram value, never converted twice.
  it('renders an absolute target weight in the coach’s own unit', () => {
    renderBlock({
      targetRpe: null,
      targetWeightKg: 100,
      tempo: null,
      targetRepsMin: 5,
      targetRepsMax: 5,
    });

    expect(screen.getByText('4 × 5 · 100kg · 90s')).toBeTruthy();
    expect(screen.getAllByText('100kg', HIDDEN)).toHaveLength(4);
  });

  it('shows the same stored weight in pounds for a coach who reads in pounds', () => {
    mockWeightUnit = 'lb';
    renderBlock({
      targetRpe: null,
      targetWeightKg: 100,
      tempo: null,
      targetRepsMin: 5,
      targetRepsMax: 5,
    });

    expect(screen.getByText('4 × 5 · 220lb · 90s')).toBeTruthy();
  });

  it('shows a superset letter authored elsewhere, and folds it into the spoken label', () => {
    renderBlock({ supersetGroup: 'A' });

    expect(screen.getByTestId('superset-group', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('block-open').props.accessibilityLabel).toBe(
      'Barbell Back Squat, superset A',
    );
  });

  it('opens on press', () => {
    const { onPress } = renderBlock();

    fireEvent.press(screen.getByTestId('block-open'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
