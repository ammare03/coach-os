import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type {
  UpcomingExercise,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { resolveAlternatives } from '../../lib/alternatives.ts';
import { buildExercisePages } from '../../lib/exercise-pages.ts';
import type { ExerciseSubstitution } from '../../store/substituted-exercises-store.ts';
import { ExercisePager } from '../ExercisePager.tsx';
import { SwapExerciseSheet } from '../SwapExerciseSheet.tsx';

// `phase-09-workout-logger/session-modifications/02`. Four of the task's
// acceptance criteria are visible from here: the picker offers the coach's
// list and carries no search at all, an empty list is a designed state
// rather than a blank sheet, a swap shows on the page it was made on and on
// no other, and the affordance does not exist for a session that is over.

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

const SQUAT = 'e-squat';
const HACK = 'e-hack';
const PRESS = 'e-press';
const LUNGE = 'e-lunge';

function dayPayload(alternatives: string[] = [HACK, PRESS]): LocalSessionPayload {
  const blocks: UpcomingSessionExercise[] = [
    buildBlock({
      programExerciseId: 'b-1',
      exerciseId: SQUAT,
      orderIndex: 1,
      targetSets: 3,
      alternatives,
    }),
    buildBlock({ programExerciseId: 'b-2', exerciseId: LUNGE, orderIndex: 2, targetSets: 3 }),
  ];
  const exercises: UpcomingExercise[] = [
    buildExercise({ id: SQUAT, name: 'Barbell back squat', primaryMuscle: 'quads' }),
    buildExercise({ id: HACK, name: 'Hack squat', primaryMuscle: 'quads' }),
    buildExercise({ id: PRESS, name: 'Leg press', primaryMuscle: 'quads' }),
    buildExercise({ id: LUNGE, name: 'Walking lunge', primaryMuscle: 'glutes' }),
  ];
  return { session: buildSession({ exercises: blocks }), exercises };
}

const SWAP: ExerciseSubstitution = {
  exerciseKey: 'b-1',
  originalExerciseId: SQUAT,
  originalName: 'Barbell back squat',
  substituteExerciseId: PRESS,
  substituteName: 'Leg press',
  atMs: Date.parse('2026-08-15T19:00:00.000Z'),
};

function pagesFor(substitutions?: ReadonlyMap<string, ExerciseSubstitution>) {
  return buildExercisePages(dayPayload(), undefined, substitutions);
}

const noop = () => undefined;

describe('the picker', () => {
  const payload = dayPayload();
  const [squatPage] = pagesFor();
  if (squatPage === undefined) throw new Error('no page to resolve alternatives for');
  const alternatives = resolveAlternatives(squatPage, payload);

  it("lists the coach's approved swaps and nothing else", () => {
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Barbell back squat"
        alternatives={alternatives}
        onDismiss={noop}
        onSelect={noop}
      />,
    );

    expect(screen.getByTestId(`swap-option-${HACK}`)).toBeTruthy();
    expect(screen.getByTestId(`swap-option-${PRESS}`)).toBeTruthy();
    // Never the programmed exercise, and never an exercise in the session
    // the coach did not approve for this block.
    expect(screen.queryByTestId(`swap-option-${SQUAT}`)).toBeNull();
    expect(screen.queryByTestId(`swap-option-${LUNGE}`)).toBeNull();
  });

  it('carries no search field — the task’s named risk, checked at the surface', () => {
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Barbell back squat"
        alternatives={alternatives}
        onDismiss={noop}
        onSelect={noop}
      />,
    );

    expect(
      screen.UNSAFE_queryAllByType(
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the RN primitive, by identity
        (require('react-native') as { TextInput: React.ComponentType }).TextInput,
      ),
    ).toHaveLength(0);
  });

  it('commits on one tap, with no footer to reach for', () => {
    const onSelect = jest.fn();
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Barbell back squat"
        alternatives={alternatives}
        onDismiss={noop}
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByTestId(`swap-option-${PRESS}`));

    expect(onSelect).toHaveBeenCalledWith({ id: PRESS, name: 'Leg press', primaryMuscle: 'quads' });
  });

  it('announces which one is in force, rather than leaving it to the tint', () => {
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Barbell back squat"
        alternatives={alternatives}
        currentSubstituteId={PRESS}
        onDismiss={noop}
        onSelect={noop}
      />,
    );

    expect(screen.getByTestId(`swap-option-${PRESS}`).props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId(`swap-option-${HACK}`).props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('Leg press, quads, Doing this one')).toBeTruthy();
  });

  it('offers the way back only once something has been swapped', () => {
    const onRevert = jest.fn();
    const { rerender } = render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Barbell back squat"
        alternatives={alternatives}
        onDismiss={noop}
        onSelect={noop}
        onRevert={onRevert}
      />,
    );
    expect(screen.queryByTestId('swap-revert-action')).toBeNull();

    rerender(
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <SwapExerciseSheet
          isOpen
          exerciseName="Barbell back squat"
          alternatives={alternatives}
          currentSubstituteId={PRESS}
          revertToName="Barbell back squat"
          onDismiss={noop}
          onSelect={noop}
          onRevert={onRevert}
        />
      </SafeAreaProvider>,
    );

    fireEvent.press(screen.getByTestId('swap-revert-action'));
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Back to Barbell back squat')).toBeTruthy();
  });
});

describe('no alternatives configured', () => {
  it('shows a designed state, never a blank sheet and never a search', () => {
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Walking lunge"
        alternatives={[]}
        onDismiss={noop}
        onSelect={noop}
      />,
    );

    expect(screen.getByTestId('swap-empty-state')).toBeTruthy();
    expect(screen.getByText('No approved swaps here')).toBeTruthy();
    // It points the client back at their coach. This is the line that exists
    // so the gap is never closed by widening the picker's source.
    expect(
      screen.getByText(
        "Your coach hasn't set alternatives for this exercise. Message them if the equipment isn't available.",
      ),
    ).toBeTruthy();
  });

  it('hands off to the one next step the client actually has', () => {
    const onSkipInstead = jest.fn();
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Walking lunge"
        alternatives={[]}
        onDismiss={noop}
        onSelect={noop}
        onSkipInstead={onSkipInstead}
      />,
    );

    fireEvent.press(screen.getByTestId('swap-empty-skip-action'));

    expect(onSkipInstead).toHaveBeenCalledTimes(1);
  });

  it('offers nothing at all when the caller wires no hand-off', () => {
    render(
      <SwapExerciseSheet
        isOpen
        exerciseName="Walking lunge"
        alternatives={[]}
        onDismiss={noop}
        onSelect={noop}
      />,
    );

    expect(screen.queryByTestId('swap-empty-skip-action')).toBeNull();
  });
});

describe('the page', () => {
  it('offers the swap from the first frame, beside the skip rather than instead of it', () => {
    // A client whose rack is taken has not logged a set, and task 03's
    // affordance must stay exactly where it was.
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={noop}
        onSkipPress={noop}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.getByTestId('swap-exercise-action')).toBeTruthy();
    expect(screen.getByTestId('skip-exercise-action')).toBeTruthy();
    expect(screen.getByLabelText('Swap this exercise')).toBeTruthy();
  });

  it('draws no swap affordance at all for a caller that wires none', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={noop}
        onSkipPress={noop}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.queryByTestId('swap-exercise-action')).toBeNull();
    expect(screen.getByTestId('skip-exercise-action')).toBeTruthy();
  });

  it('opens the picker for the page it was tapped on', () => {
    const onSwapPress = jest.fn();
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={onSwapPress}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    fireEvent.press(screen.getByTestId('swap-exercise-action'));

    expect(onSwapPress).toHaveBeenCalledWith(expect.objectContaining({ key: 'b-1' }));
  });

  it('names the substitute, and says once what it replaced', () => {
    render(
      <ExercisePager
        pages={pagesFor(new Map([['b-1', SWAP]]))}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={noop}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.getByText('Leg press')).toBeTruthy();
    // `includeHiddenElements`, because the line is deliberately outside the
    // reading order — it is drawn for the eye and the header below carries
    // the same fact for a screen reader.
    expect(screen.getByTestId('page-swapped-from', { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByText('Instead of Barbell back squat', { includeHiddenElements: true }),
    ).toBeTruthy();
    // One accessible sentence, not two fragments — the "instead of" line is
    // hidden from the reading order because the header carries it whole.
    expect(screen.getByLabelText('Leg press, swapped in for Barbell back squat')).toBeTruthy();
  });

  it('leaves an unswapped page saying nothing about substitutions', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={noop}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.queryByTestId('page-swapped-from', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('Barbell back squat')).toBeTruthy();
  });

  it('keeps the composer — a swapped exercise is one you log, unlike a skipped one', () => {
    render(
      <ExercisePager
        pages={pagesFor(new Map([['b-1', SWAP]]))}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={noop}
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.getAllByText('composer').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('page-skipped-panel')).toBeNull();
  });

  it('offers no swap on a skipped page — there is nothing there to log', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={noop}
        onSwapPress={noop}
        onSkipPress={noop}
        skips={
          new Map([
            [
              'b-1',
              {
                exerciseKey: 'b-1',
                exerciseId: SQUAT,
                exerciseName: 'Barbell back squat',
                reason: 'equipment' as const,
                note: null,
                atMs: 0,
              },
            ],
          ])
        }
        renderPage={() => <Text>composer</Text>}
      />,
    );

    expect(screen.queryByTestId('swap-exercise-action')).toBeNull();
    expect(screen.getByTestId('page-skipped-panel')).toBeTruthy();
  });
});
