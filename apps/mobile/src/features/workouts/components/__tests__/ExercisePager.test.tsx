import { fireEvent, render, screen } from '@testing-library/react-native';
import type {
  UpcomingExercise,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';
import { Text } from 'react-native';

import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { buildExercisePages } from '../../lib/exercise-pages.ts';
import { ExercisePager } from '../ExercisePager.tsx';

// What a component test owns here is the tree the gesture detector wraps —
// the rail's labels and roles, the tap route, and which page is current.
// The drag itself is UI-thread and native-driven and is verified on
// hardware, exactly as `DraggableExerciseList`'s is; its arithmetic is
// covered as pure functions in `lib/__tests__/pager-gesture.test.ts`.

function pagesFor(
  blocks: UpcomingSessionExercise[],
  exercises: UpcomingExercise[],
  counts?: ReadonlyMap<string, number>,
) {
  const payload: LocalSessionPayload = { session: buildSession({ exercises: blocks }), exercises };
  return buildExercisePages(payload, counts);
}

function block(n: number, overrides: Partial<UpcomingSessionExercise> = {}) {
  return buildBlock({
    programExerciseId: `b-${String(n)}`,
    exerciseId: `e-${String(n)}`,
    orderIndex: n,
    targetSets: 3,
    ...overrides,
  });
}

const NAMES = [
  'Barbell bench press',
  'Incline dumbbell press',
  'Chest-supported row',
  'Lat pulldown',
];

const FOUR = pagesFor(
  [block(1), block(2), block(3), block(4)],
  NAMES.map((name, i) => buildExercise({ id: `e-${String(i + 1)}`, name })),
);

const SUPERSET = pagesFor(
  [block(1, { supersetGroup: 'A' }), block(2, { supersetGroup: 'A' })],
  [
    buildExercise({ id: 'e-1', name: 'Leg extension' }),
    buildExercise({ id: 'e-2', name: 'Lying leg curl' }),
  ],
);

describe('ExercisePager', () => {
  it('names the current exercise and its place in the session', () => {
    render(<ExercisePager pages={FOUR} currentIndex={1} onIndexChange={jest.fn()} />);

    expect(screen.getByText('Incline dumbbell press')).toBeTruthy();
    expect(screen.getByText('Exercise 2 of 4')).toBeTruthy();
  });

  it('gives every exercise a rail stop labelled with its name and position', () => {
    render(<ExercisePager pages={FOUR} currentIndex={0} onIndexChange={jest.fn()} />);

    // Queried by accessibility label, so the test doubles as the screen
    // reader check (`testing` §6).
    expect(screen.getByLabelText('Barbell bench press, exercise 1 of 4')).toBeTruthy();
    expect(screen.getByLabelText('Lat pulldown, exercise 4 of 4')).toBeTruthy();
  });

  it('moves to any exercise on one tap, forwards or backwards', () => {
    const onIndexChange = jest.fn();
    render(<ExercisePager pages={FOUR} currentIndex={3} onIndexChange={onIndexChange} />);

    fireEvent.press(screen.getByLabelText('Barbell bench press, exercise 1 of 4'));

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('does not require the previous exercise to be finished first', () => {
    // Nothing gates the move: a client whose machine is occupied skips it.
    const onIndexChange = jest.fn();
    render(<ExercisePager pages={FOUR} currentIndex={0} onIndexChange={onIndexChange} />);

    fireEvent.press(screen.getByLabelText('Lat pulldown, exercise 4 of 4'));

    expect(onIndexChange).toHaveBeenCalledWith(3);
  });

  it('does not fire a change for the stop already showing', () => {
    const onIndexChange = jest.fn();
    render(<ExercisePager pages={FOUR} currentIndex={1} onIndexChange={onIndexChange} />);

    fireEvent.press(screen.getByLabelText('Incline dumbbell press, exercise 2 of 4'));

    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('marks exactly one stop selected, and it is the current one', () => {
    render(<ExercisePager pages={FOUR} currentIndex={1} onIndexChange={jest.fn()} />);

    const selected = screen.getAllByRole('tab', { selected: true });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe('Incline dumbbell press, exercise 2 of 4');
  });

  it('reads a superset member as a member, and both are one tap apart', () => {
    const onIndexChange = jest.fn();
    render(<ExercisePager pages={SUPERSET} currentIndex={1} onIndexChange={onIndexChange} />);

    fireEvent.press(screen.getByLabelText('Leg extension, exercise 1 of 2, superset A, 1 of 2'));

    expect(onIndexChange).toHaveBeenCalledWith(0);
    expect(screen.getByText('Exercise 2 of 2 · superset A')).toBeTruthy();
  });

  it('announces how much of an exercise is logged when the counts are known', () => {
    const pages = pagesFor(
      [block(1)],
      [buildExercise({ id: 'e-1', name: 'Back squat' })],
      new Map([['e-1', 2]]),
    );
    render(<ExercisePager pages={pages} currentIndex={0} onIndexChange={jest.fn()} />);

    expect(screen.getByLabelText('Back squat, exercise 1 of 1, 2 of 3 sets logged')).toBeTruthy();
  });

  it('renders nothing at all when the session has no prescription to page', () => {
    // The shell already owns that state (`LoggerNoPrescription`); a pager
    // with no pages must not draw an empty frame on top of it.
    render(<ExercisePager pages={[]} currentIndex={0} onIndexChange={jest.fn()} />);

    expect(screen.queryByTestId('exercise-pager')).toBeNull();
  });

  it('clamps a current index that is out of range instead of showing a blank page', () => {
    render(<ExercisePager pages={FOUR} currentIndex={9} onIndexChange={jest.fn()} />);

    expect(screen.getByText('Exercise 4 of 4')).toBeTruthy();
  });

  it('renders page content for the current exercise and its neighbours only', () => {
    // The neighbours are mounted so a swipe reveals real content rather
    // than popping it in on release; everything further out is not, because
    // a set-entry surface per page is the expensive thing on this screen
    // (`frontend-performance` §3).
    render(
      <ExercisePager
        pages={FOUR}
        currentIndex={0}
        onIndexChange={jest.fn()}
        renderPage={(page) => <Text>{`content for ${page.exerciseId}`}</Text>}
      />,
    );

    expect(screen.getByText('content for e-1')).toBeTruthy();
    // Mounted, but out of the reading order: only the page in front of the
    // client is content, and the 12pt peek beside it is an affordance.
    expect(screen.queryByText('content for e-2')).toBeNull();
    expect(screen.getByText('content for e-2', { includeHiddenElements: true })).toBeTruthy();
    // Two pages out is not mounted at all.
    expect(screen.queryByText('content for e-3', { includeHiddenElements: true })).toBeNull();
  });
});
