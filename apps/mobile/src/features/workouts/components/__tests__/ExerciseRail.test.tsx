import { fireEvent, render, screen } from '@testing-library/react-native';
import type {
  UpcomingExercise,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';

import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { buildExercisePages } from '../../lib/exercise-pages.ts';
import { ExercisePager } from '../ExercisePager.tsx';
import { groupIntoRuns } from '../ExerciseRail.tsx';

// The rail is the tap half of §8.4's "swipe or tap to move", and the only
// affordance that reaches a non-adjacent exercise. Two things are tested
// here that `ExercisePager.test.tsx` does not reach: the bracketing of
// superset runs, and the second, non-colour progress channel `accessibility`
// §8 requires — state may never ride on hue alone, so each stop carries a
// check, a meter, or a dashed stub.

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

function named(n: number, name: string) {
  return buildExercise({ id: `e-${String(n)}`, name });
}

describe('groupIntoRuns', () => {
  it('keeps a stretch of standalone exercises in one run', () => {
    const pages = pagesFor([block(1), block(2), block(3)], []);

    const runs = groupIntoRuns(pages);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.group).toBeNull();
    expect(runs[0]?.pages).toHaveLength(3);
  });

  it('brackets adjacent superset members as one run', () => {
    const pages = pagesFor(
      [block(1, { supersetGroup: 'A' }), block(2, { supersetGroup: 'A' })],
      [],
    );

    const runs = groupIntoRuns(pages);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.group).toBe('A');
    expect(runs[0]?.pages.map((p) => p.badge)).toEqual(['A1', 'A2']);
  });

  it('splits a group interrupted by a standalone block into two brackets', () => {
    // A run is a stretch of ADJACENT members. A group split by something
    // else is a contradiction, and two brackets is the honest rendering of
    // it rather than one bracket drawn around the intruder.
    const pages = pagesFor(
      [
        block(1, { supersetGroup: 'A' }),
        block(2, { supersetGroup: 'A' }),
        block(3),
        block(4, { supersetGroup: 'A' }),
      ],
      [],
    );

    const runs = groupIntoRuns(pages);

    expect(runs.map((run) => run.group)).toEqual(['A', null, 'A']);
    // Numbered across the DAY, not restarted per bracket — the client is
    // told this is the third part of A, not a second A1.
    expect(runs[2]?.pages[0]?.badge).toBe('A3');
  });

  it('keeps two different groups in their own brackets', () => {
    const pages = pagesFor(
      [
        block(1, { supersetGroup: 'A' }),
        block(2, { supersetGroup: 'A' }),
        block(3, { supersetGroup: 'B' }),
        block(4, { supersetGroup: 'B' }),
      ],
      [],
    );

    expect(groupIntoRuns(pages).map((run) => run.group)).toEqual(['A', 'B']);
  });
});

describe('ExerciseRail progress channel', () => {
  const NAMES = [named(1, 'Back squat'), named(2, 'Romanian deadlift'), named(3, 'Leg press')];

  it('shows nothing at all when the set counts are not known', () => {
    // `null` is not `0`. Until `set-entry` ships there are no counts, and a
    // dashed "nothing logged" stub on every stop would be a claim rather
    // than an absence.
    render(
      <ExercisePager
        pages={pagesFor([block(1), block(2), block(3)], NAMES)}
        currentIndex={0}
        onIndexChange={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('stop-untouched')).toBeNull();
    expect(screen.queryByTestId('stop-partial')).toBeNull();
    expect(screen.queryByTestId('stop-complete')).toBeNull();
  });

  it('marks done, part-done, and untouched with three different shapes', () => {
    // The second channel `accessibility` §8 requires: a client who cannot
    // separate the hues still reads three distinct states.
    render(
      <ExercisePager
        pages={pagesFor(
          [block(1), block(2), block(3)],
          NAMES,
          new Map([
            ['e-1', 3],
            ['e-2', 1],
          ]),
        )}
        currentIndex={0}
        onIndexChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('stop-complete')).toBeTruthy();
    expect(screen.getByTestId('stop-partial')).toBeTruthy();
    expect(screen.getByTestId('stop-untouched')).toBeTruthy();
  });

  it('says the same thing in words, so it is not shape-only either', () => {
    render(
      <ExercisePager
        pages={pagesFor([block(1), block(2)], NAMES, new Map([['e-1', 3]]))}
        currentIndex={0}
        onIndexChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Back squat, exercise 1 of 2, 3 of 3 sets logged')).toBeTruthy();
    expect(
      screen.getByLabelText('Romanian deadlift, exercise 2 of 2, 0 of 3 sets logged'),
    ).toBeTruthy();
  });
});

describe('ExerciseRail superset navigation', () => {
  it('moves back and forth between two superset members, one tap each way', () => {
    // The pattern a superset IS: alternate between the pair rather than
    // finish one and move on. `03`'s fourth criterion.
    const onIndexChange = jest.fn();
    const pages = pagesFor(
      [block(1, { supersetGroup: 'A' }), block(2, { supersetGroup: 'A' })],
      [named(1, 'Leg extension'), named(2, 'Lying leg curl')],
    );

    const view = render(
      <ExercisePager pages={pages} currentIndex={0} onIndexChange={onIndexChange} />,
    );

    fireEvent.press(screen.getByLabelText('Lying leg curl, exercise 2 of 2, superset A, 2 of 2'));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);

    view.rerender(<ExercisePager pages={pages} currentIndex={1} onIndexChange={onIndexChange} />);

    fireEvent.press(screen.getByLabelText('Leg extension, exercise 1 of 2, superset A, 1 of 2'));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    expect(onIndexChange).toHaveBeenCalledTimes(2);
  });
});
