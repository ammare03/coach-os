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
import type { ExerciseSubstitution } from '../../store/substituted-exercises-store.ts';
import { resolveAlternatives } from '../alternatives.ts';
import { buildExercisePages, type ExercisePage } from '../exercise-pages.ts';

// `phase-09-workout-logger/session-modifications/02`. Four of the task's
// acceptance criteria are decided in these two pure modules: the picker's
// source is the block's `alternatives` and nothing else, an empty array
// produces an empty list rather than a widened one, a swap changes only the
// slot it names, and the coach's own targets are still reachable afterwards
// because the page keeps its `program_exercises.id`.

const SQUAT = 'e-squat';
const HACK = 'e-hack';
const PRESS = 'e-press';
const LUNGE = 'e-lunge';

function payloadWith(blocks: UpcomingSessionExercise[], exercises: UpcomingExercise[]) {
  const payload: LocalSessionPayload = { session: buildSession({ exercises: blocks }), exercises };
  return payload;
}

/** A day of one squat block with two approved swaps, plus a lunge with none. */
function dayPayload(alternatives: string[] = [HACK, PRESS]): LocalSessionPayload {
  return payloadWith(
    [
      buildBlock({
        programExerciseId: 'b-1',
        exerciseId: SQUAT,
        orderIndex: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetRpe: 8,
        targetRestSeconds: 120,
        tempo: '3010',
        alternatives,
      }),
      buildBlock({
        programExerciseId: 'b-2',
        exerciseId: LUNGE,
        orderIndex: 2,
        targetSets: 3,
        alternatives: [],
      }),
    ],
    [
      buildExercise({ id: SQUAT, name: 'Barbell back squat', primaryMuscle: 'quads' }),
      buildExercise({ id: HACK, name: 'Hack squat', primaryMuscle: 'quads' }),
      buildExercise({ id: PRESS, name: 'Leg press', primaryMuscle: 'quads' }),
      buildExercise({ id: LUNGE, name: 'Walking lunge', primaryMuscle: 'quads' }),
    ],
  );
}

function swap(overrides: Partial<ExerciseSubstitution> = {}): ExerciseSubstitution {
  return {
    exerciseKey: 'b-1',
    originalExerciseId: SQUAT,
    originalName: 'Barbell back squat',
    substituteExerciseId: PRESS,
    substituteName: 'Leg press',
    atMs: Date.parse('2026-08-15T19:00:00.000Z'),
    ...overrides,
  };
}

function pageFor(key: string, pages: readonly ExercisePage[]): ExercisePage {
  const page = pages.find((candidate) => candidate.key === key);
  if (page === undefined) throw new Error(`no page for ${key}`);
  return page;
}

describe('resolveAlternatives', () => {
  it("offers exactly the coach's approved swaps, in the coach's order", () => {
    const payload = dayPayload();
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload).map((entry) => entry.id)).toEqual([HACK, PRESS]);
  });

  it('carries the name and primary muscle a row has to show', () => {
    const payload = dayPayload();
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload)[0]).toEqual({
      id: HACK,
      name: 'Hack squat',
      primaryMuscle: 'quads',
    });
  });

  it('never includes the programmed exercise itself', () => {
    // The way back is the sheet's own revert, not a row — which is what
    // keeps this list literally equal to `alternatives`.
    const payload = dayPayload();
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload).map((entry) => entry.id)).not.toContain(SQUAT);
  });

  it('returns nothing for a block the coach configured no alternatives on', () => {
    // The task's named risk: this is the case a library search would be
    // reached for. Empty, so the caller renders the designed empty state.
    const payload = dayPayload();
    const page = pageFor('b-2', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload)).toEqual([]);
  });

  it('offers nothing at all for a session with no prescription', () => {
    const payload = dayPayload();
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, null)).toEqual([]);
  });

  it('drops an approved id the exercise cache did not carry, rather than naming it nothing', () => {
    const payload = dayPayload([HACK, 'e-never-cached']);
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload).map((entry) => entry.id)).toEqual([HACK]);
  });

  it('reads the FROZEN prescription for a session in progress', () => {
    // A picker resolved from the live copy under a page built from the
    // frozen one would offer the swaps of a block the client is not on.
    const frozen = [
      buildBlock({ programExerciseId: 'b-1', exerciseId: SQUAT, alternatives: [HACK] }),
    ];
    const live = [
      buildBlock({ programExerciseId: 'b-1', exerciseId: SQUAT, alternatives: [PRESS] }),
    ];
    const payload: LocalSessionPayload = {
      session: buildSession({ status: 'in_progress', exercises: live, programSnapshot: frozen }),
      exercises: [
        buildExercise({ id: SQUAT, name: 'Barbell back squat' }),
        buildExercise({ id: HACK, name: 'Hack squat' }),
        buildExercise({ id: PRESS, name: 'Leg press' }),
      ],
    };
    const page = pageFor('b-1', buildExercisePages(payload));

    expect(resolveAlternatives(page, payload).map((entry) => entry.id)).toEqual([HACK]);
  });

  it('resolves the ORIGINAL block for a page that has already been swapped', () => {
    // A swapped page's `exerciseId` is the substitute's, which no block
    // names — matching on it would empty the picker after one swap.
    const payload = dayPayload();
    const pages = buildExercisePages(payload, undefined, new Map([['b-1', swap()]]));
    const page = pageFor('b-1', pages);

    expect(page.exerciseId).toBe(PRESS);
    expect(resolveAlternatives(page, payload).map((entry) => entry.id)).toEqual([HACK, PRESS]);
  });
});

describe('buildExercisePages, with a substitution', () => {
  it('shows the substitute and names what it replaced', () => {
    const pages = buildExercisePages(dayPayload(), undefined, new Map([['b-1', swap()]]));
    const page = pageFor('b-1', pages);

    expect(page.exerciseId).toBe(PRESS);
    expect(page.name).toBe('Leg press');
    expect(page.substitutedFor).toEqual({ exerciseId: SQUAT, name: 'Barbell back squat' });
  });

  it('changes only the slot it names', () => {
    const pages = buildExercisePages(dayPayload(), undefined, new Map([['b-1', swap()]]));

    const untouched = pageFor('b-2', pages);
    expect(untouched.exerciseId).toBe(LUNGE);
    expect(untouched.name).toBe('Walking lunge');
    expect(untouched.substitutedFor).toBeNull();
  });

  it("keeps the slot's program_exercises.id, so the coach's targets still resolve", () => {
    // The whole of "targets carry over verbatim": `useExerciseTarget` matches
    // on `page.key`, which a swap never touches.
    const payload = dayPayload();
    const before = pageFor('b-1', buildExercisePages(payload));
    const after = pageFor(
      'b-1',
      buildExercisePages(payload, undefined, new Map([['b-1', swap()]])),
    );

    expect(after.key).toBe(before.key);
    expect(after.targetSets).toBe(before.targetSets);
    expect(after.position).toBe(before.position);
    expect(after.badge).toBe(before.badge);
  });

  it('leaves the underlying prescription untouched — the program is not edited', () => {
    const payload = dayPayload();

    buildExercisePages(payload, undefined, new Map([['b-1', swap()]]));

    expect(payload.session.exercises[0]?.exerciseId).toBe(SQUAT);
    expect(payload.session.exercises[0]?.alternatives).toEqual([HACK, PRESS]);
  });

  it('counts logged sets against the substitute, not the exercise that was replaced', () => {
    const counts = new Map([
      [SQUAT, 3],
      [PRESS, 1],
    ]);
    const pages = buildExercisePages(dayPayload(), counts, new Map([['b-1', swap()]]));

    expect(pageFor('b-1', pages).setsLogged).toBe(1);
  });

  it('falls back to the name the client chose when the cache no longer holds it', () => {
    const payload = payloadWith(
      [buildBlock({ programExerciseId: 'b-1', exerciseId: SQUAT, alternatives: [PRESS] })],
      [buildExercise({ id: SQUAT, name: 'Barbell back squat' })],
    );
    const pages = buildExercisePages(payload, undefined, new Map([['b-1', swap()]]));

    expect(pageFor('b-1', pages).name).toBe('Leg press');
  });

  it('leaves every page as programmed when nothing has been swapped', () => {
    const withEmpty = buildExercisePages(dayPayload(), undefined, new Map());
    const without = buildExercisePages(dayPayload());

    expect(withEmpty.map((page) => page.exerciseId)).toEqual(
      without.map((page) => page.exerciseId),
    );
    expect(withEmpty.every((page) => page.substitutedFor === null)).toBe(true);
  });
});
