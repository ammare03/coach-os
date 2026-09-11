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
import { buildExercisePages, clampPageIndex } from '../exercise-pages.ts';

// The page model behind `ExercisePager` — one page per prescribed block,
// with everything the rail and the page header render derived here rather
// than in a component (`program-builder`'s `supersets.ts` for the same
// reason: a grouping rule fused into a render is a rule you can only test
// by rendering).

function payload(
  blocks: UpcomingSessionExercise[],
  exercises: UpcomingExercise[] = [buildExercise()],
): LocalSessionPayload {
  return { session: buildSession({ exercises: blocks }), exercises };
}

describe('buildExercisePages', () => {
  it('orders pages by orderIndex, not by the payload array order', () => {
    const pages = buildExercisePages(
      payload([
        buildBlock({ programExerciseId: 'b-2', exerciseId: 'e-2', orderIndex: 2 }),
        buildBlock({ programExerciseId: 'b-1', exerciseId: 'e-1', orderIndex: 1 }),
      ]),
    );

    expect(pages.map((page) => page.key)).toEqual(['b-1', 'b-2']);
    expect(pages.map((page) => page.position)).toEqual([1, 2]);
  });

  it('names each page from the exercise cache', () => {
    const pages = buildExercisePages(
      payload(
        [buildBlock({ exerciseId: 'e-1' })],
        [buildExercise({ id: 'e-1', name: 'Incline dumbbell press' })],
      ),
    );

    expect(pages[0]?.name).toBe('Incline dumbbell press');
  });

  it('falls back to a neutral name when the exercise cache missed that id', () => {
    // A cache miss must still be pageable — a client mid-gym cannot refetch.
    const pages = buildExercisePages(
      payload([buildBlock({ exerciseId: 'not-cached' })], [buildExercise({ id: 'e-1' })]),
    );

    expect(pages[0]?.name).toBe('Exercise');
  });

  it('returns no pages for a session with no prescription', () => {
    expect(buildExercisePages(null)).toEqual([]);
    expect(buildExercisePages(payload([]))).toEqual([]);
  });

  it('labels superset members A1 / A2 and marks the run edges', () => {
    const pages = buildExercisePages(
      payload([
        buildBlock({ programExerciseId: 'b-1', orderIndex: 1, supersetGroup: null }),
        buildBlock({ programExerciseId: 'b-2', orderIndex: 2, supersetGroup: 'A' }),
        buildBlock({ programExerciseId: 'b-3', orderIndex: 3, supersetGroup: 'A' }),
        buildBlock({ programExerciseId: 'b-4', orderIndex: 4, supersetGroup: null }),
      ]),
    );

    expect(pages.map((page) => page.badge)).toEqual(['1', 'A1', 'A2', '4']);
    expect(pages.map((page) => page.isRunStart)).toEqual([true, true, false, true]);
    expect(pages.map((page) => page.isRunEnd)).toEqual([true, false, true, true]);
    expect(pages[1]?.supersetMemberCount).toBe(2);
  });

  it('counts a superset position across the whole day, so a split group stays visible', () => {
    // Never renumber from 1 twice: a group that has somehow been split is a
    // contradiction the client should be able to see, not one we paper over.
    const pages = buildExercisePages(
      payload([
        buildBlock({ programExerciseId: 'b-1', orderIndex: 1, supersetGroup: 'A' }),
        buildBlock({ programExerciseId: 'b-2', orderIndex: 2, supersetGroup: null }),
        buildBlock({ programExerciseId: 'b-3', orderIndex: 3, supersetGroup: 'A' }),
      ]),
    );

    expect(pages.map((page) => page.badge)).toEqual(['A1', '2', 'A2']);
  });

  it('leaves setsLogged null when no counts are supplied', () => {
    // `null` is "unknown", which the rail renders as no progress channel at
    // all. Rendering 0 there would claim nothing has been logged.
    const pages = buildExercisePages(payload([buildBlock({ exerciseId: 'e-1' })]));

    expect(pages[0]?.setsLogged).toBeNull();
    expect(pages[0]?.targetSets).toBe(4);
  });

  it('takes setsLogged from the supplied counts, defaulting an absent id to 0', () => {
    const pages = buildExercisePages(
      payload([
        buildBlock({ programExerciseId: 'b-1', exerciseId: 'e-1', orderIndex: 1 }),
        buildBlock({ programExerciseId: 'b-2', exerciseId: 'e-2', orderIndex: 2 }),
      ]),
      new Map([['e-1', 3]]),
    );

    expect(pages.map((page) => page.setsLogged)).toEqual([3, 0]);
  });
});

describe('clampPageIndex', () => {
  it('holds an index inside the page range', () => {
    expect(clampPageIndex(-2, 6)).toBe(0);
    expect(clampPageIndex(9, 6)).toBe(5);
    expect(clampPageIndex(2, 6)).toBe(2);
  });

  it('collapses to 0 when there are no pages, rather than to -1', () => {
    expect(clampPageIndex(3, 0)).toBe(0);
  });

  it('rejects a non-integer rather than letting it reach a transform', () => {
    expect(clampPageIndex(Number.NaN, 6)).toBe(0);
    expect(clampPageIndex(1.7, 6)).toBe(1);
  });
});
