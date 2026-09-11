import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type {
  UpcomingExercise,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';
import type { ReactElement } from 'react';
import { Alert, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { buildExercisePages } from '../../lib/exercise-pages.ts';
import type { SkippedExercise } from '../../store/skipped-exercises-store.ts';
import { ExercisePager } from '../ExercisePager.tsx';
import { SkipExerciseSheet } from '../SkipExerciseSheet.tsx';

// `phase-09-workout-logger/session-modifications/03`. Four of the task's five
// acceptance criteria are visible from here: a skip needs no logged set, it
// asks for nothing beyond the reason itself, a skipped exercise is tellable
// apart from BOTH a finished one and one never reached, and the affordance
// does not exist at all for a session that is over.

/** `SheetFooter` pins its action above the home indicator, so it needs real insets. */
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  const view = rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
  return {
    ...view,
    // Re-wrapped: RNTL's own `rerender` replaces the whole tree, and an
    // unwrapped one drops the provider `SheetFooter` reads.
    rerender: (next: ReactElement) =>
      view.rerender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{next}</SafeAreaProvider>),
  };
}

function pagesFor(counts?: ReadonlyMap<string, number>) {
  const blocks: UpcomingSessionExercise[] = [1, 2, 3].map((n) =>
    buildBlock({
      programExerciseId: `b-${String(n)}`,
      exerciseId: `e-${String(n)}`,
      orderIndex: n,
      targetSets: 3,
    }),
  );
  const exercises: UpcomingExercise[] = [
    buildExercise({ id: 'e-1', name: 'Barbell back squat' }),
    buildExercise({ id: 'e-2', name: 'Leg press' }),
    buildExercise({ id: 'e-3', name: 'Walking lunge' }),
  ];
  const payload: LocalSessionPayload = { session: buildSession({ exercises: blocks }), exercises };
  return buildExercisePages(payload, counts);
}

function skip(overrides: Partial<SkippedExercise> = {}): SkippedExercise {
  return {
    exerciseKey: 'b-2',
    exerciseId: 'e-2',
    exerciseName: 'Leg press',
    reason: 'pain',
    note: null,
    atMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SkipExerciseSheet', () => {
  it('asks for a reason before it will skip anything', () => {
    render(
      <SkipExerciseSheet
        isOpen
        exerciseName="Leg press"
        onDismiss={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Skip exercise' })).toBeDisabled();

    fireEvent.press(screen.getByTestId('skip-reason-pain'));

    expect(screen.getByRole('button', { name: 'Skip exercise' })).not.toBeDisabled();
  });

  it('confirms with the reason and whatever the client typed, and nothing else', () => {
    const onConfirm = jest.fn();
    const alert = jest.spyOn(Alert, 'alert');
    render(
      <SkipExerciseSheet
        isOpen
        exerciseName="Leg press"
        onDismiss={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.press(screen.getByTestId('skip-reason-equipment'));
    fireEvent.changeText(screen.getByTestId('skip-note-input'), 'squat rack taken');
    fireEvent.press(screen.getByRole('button', { name: 'Skip exercise' }));

    expect(onConfirm).toHaveBeenCalledWith('equipment', 'squat rack taken');
    // The sheet IS the confirmation — no second dialog in front of it
    // (`ui-conventions` §5's ban on native `Alert`).
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('announces the selection rather than leaving it to colour', () => {
    render(
      <SkipExerciseSheet
        isOpen
        exerciseName="Leg press"
        onDismiss={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const row = screen.getByTestId('skip-reason-time');
    expect(row.props.accessibilityRole).toBe('radio');
    expect(row.props.accessibilityState).toMatchObject({ checked: false });

    fireEvent.press(row);
    expect(screen.getByTestId('skip-reason-time').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('opens for a second exercise carrying none of the first one’s answer', () => {
    const onDismiss = jest.fn();
    const view = render(
      <SkipExerciseSheet
        isOpen
        exerciseName="Leg press"
        onDismiss={onDismiss}
        onConfirm={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('skip-reason-pain'));
    fireEvent.changeText(screen.getByTestId('skip-note-input'), 'left knee');
    fireEvent.press(screen.getByLabelText('Close'));

    view.rerender(
      <SkipExerciseSheet
        isOpen={false}
        exerciseName="Leg press"
        onDismiss={onDismiss}
        onConfirm={jest.fn()}
      />,
    );
    view.rerender(
      <SkipExerciseSheet
        isOpen
        exerciseName="Walking lunge"
        onDismiss={onDismiss}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Skip exercise' })).toBeDisabled();
    expect(screen.getByTestId('skip-note-input').props.value).toBe('');
  });
});

describe('the skipped state', () => {
  it('offers the skip before a single set has been logged', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={jest.fn()}
        skips={new Map()}
        onSkipPress={jest.fn()}
      />,
    );

    // Three pages mount within the render window and each carries its own
    // affordance; the point is that it exists with `setsLogged` at `null`.
    expect(screen.getAllByLabelText('Skip this exercise').length).toBeGreaterThan(0);
  });

  it('draws nothing at all for a caller that does not offer skipping', () => {
    render(<ExercisePager pages={pagesFor()} currentIndex={0} onIndexChange={jest.fn()} />);

    expect(screen.queryByLabelText('Skip this exercise')).toBeNull();
    expect(screen.queryByTestId('stop-skipped')).toBeNull();
  });

  it('tells skipped apart from finished and from never reached, all at once', () => {
    // e-1 finished (3 of 3), e-2 skipped, e-3 never touched.
    const counts = new Map([
      ['e-1', 3],
      ['e-2', 0],
      ['e-3', 0],
    ]);

    render(
      <ExercisePager
        pages={pagesFor(counts)}
        currentIndex={0}
        onIndexChange={jest.fn()}
        skips={new Map([['b-2', skip()]])}
        onSkipPress={jest.fn()}
      />,
    );

    expect(screen.getByTestId('stop-complete')).toBeTruthy();
    expect(screen.getByTestId('stop-skipped')).toBeTruthy();
    expect(screen.getByTestId('stop-untouched')).toBeTruthy();
  });

  it('names the skip on the rail for a screen reader', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={0}
        onIndexChange={jest.fn()}
        skips={new Map([['b-2', skip()]])}
        onSkipPress={jest.fn()}
      />,
    );

    expect(screen.getByLabelText(/skipped$/)).toBeTruthy();
  });

  it('replaces the set composer with the reason and a way back', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={1}
        onIndexChange={jest.fn()}
        skips={new Map([['b-2', skip({ note: 'left knee' })]])}
        onSkipPress={jest.fn()}
        onUndoSkip={jest.fn()}
        renderPage={() => <Text>set composer</Text>}
      />,
    );

    expect(screen.getByTestId('page-skipped-panel')).toBeTruthy();
    expect(screen.getByText('Pain or discomfort')).toBeTruthy();
    expect(screen.getByText('left knee')).toBeTruthy();
    // The skipped page must not leave a live stepper behind the notice —
    // there is none on the page in front of the client. The two neighbours
    // still render theirs, off screen and out of the reading order, which is
    // why they need `includeHiddenElements`.
    expect(screen.queryByText('set composer')).toBeNull();
    expect(screen.getAllByText('set composer', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('undoes the skip from the page it was taken on', () => {
    const onUndoSkip = jest.fn();
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={1}
        onIndexChange={jest.fn()}
        skips={new Map([['b-2', skip()]])}
        onSkipPress={jest.fn()}
        onUndoSkip={onUndoSkip}
      />,
    );

    fireEvent.press(screen.getByTestId('undo-skip-action'));

    expect(onUndoSkip).toHaveBeenCalledWith(expect.objectContaining({ key: 'b-2' }));
  });

  it('swaps the head affordance for the fact once the exercise is skipped', () => {
    render(
      <ExercisePager
        pages={pagesFor()}
        currentIndex={1}
        onIndexChange={jest.fn()}
        skips={new Map([['b-2', skip()]])}
        onSkipPress={jest.fn()}
      />,
    );

    // `includeHiddenElements`: the tag is deliberately out of the reading
    // order — the panel below it says the same thing in a sentence.
    expect(screen.getByTestId('page-skipped-tag', { includeHiddenElements: true })).toBeTruthy();
    // The page in front of the client offers no skip — it is already
    // skipped. Its two neighbours keep theirs, off screen.
    expect(screen.queryByLabelText('Skip this exercise')).toBeNull();
    expect(
      screen.getAllByLabelText('Skip this exercise', { includeHiddenElements: true }),
    ).toHaveLength(2);
  });
});
