import type { UpcomingSessionExercise } from 'api/src/features/workouts/upcoming.ts';

import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { hasProgramChanged, resolvePrescription } from '../prescription.ts';

// `session-runtime/09` — the one place the logger chooses between the
// coach's LIVE program day and the copy frozen when this session started.
// Every consumer goes through it, so there is exactly one answer to "what
// is this client being asked to do" at any moment.

function block(overrides: Partial<UpcomingSessionExercise> = {}): UpcomingSessionExercise {
  return {
    programExerciseId: 'block-1',
    exerciseId: 'exercise-1',
    orderIndex: 0,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: 8,
    targetRir: null,
    targetWeightKg: 60,
    targetPercent1rm: null,
    targetRestSeconds: 120,
    tempo: null,
    supersetGroup: null,
    alternatives: [],
    coachNotes: null,
    ...overrides,
  };
}

function payload(args: {
  status: LocalSessionPayload['session']['status'];
  exercises: UpcomingSessionExercise[];
  programSnapshot?: UpcomingSessionExercise[] | null;
}): LocalSessionPayload {
  return {
    session: {
      id: 'session-1',
      clientLocalId: 'local-1',
      assignmentId: null,
      programDayId: 'day-1',
      name: 'Upper A',
      scheduledDate: '2026-08-18',
      status: args.status,
      startedAt: null,
      completedAt: null,
      updatedAt: new Date('2026-08-18T18:00:00.000Z'),
      dayName: 'Upper A',
      dayNotes: null,
      exercises: args.exercises,
      programSnapshot: args.programSnapshot ?? null,
    },
    exercises: [],
  };
}

describe('resolvePrescription', () => {
  it('reads the live program day for a session that has not started', () => {
    const live = [block({ targetSets: 5 })];

    expect(
      resolvePrescription(payload({ status: 'scheduled', exercises: live, programSnapshot: [] })),
    ).toEqual(live);
  });

  it('reads the FROZEN copy once the session is in progress', () => {
    const resolved = resolvePrescription(
      payload({
        status: 'in_progress',
        exercises: [block({ targetSets: 5, targetWeightKg: 80 })],
        programSnapshot: [block({ targetSets: 3, targetWeightKg: 60 })],
      }),
    );

    expect(resolved[0]?.targetSets).toBe(3);
    expect(resolved[0]?.targetWeightKg).toBe(60);
  });

  it('honours a frozen EMPTY day rather than falling back to live', () => {
    // "Frozen with nothing in it" is not "never frozen". Falling back here
    // would unfreeze a started session the moment its coach added a block.
    expect(
      resolvePrescription(
        payload({ status: 'in_progress', exercises: [block()], programSnapshot: [] }),
      ),
    ).toEqual([]);
  });

  it('falls back to live for an in-progress session with no snapshot at all', () => {
    // A session started by a build older than this feature, or one whose
    // stored envelope the server could not read. Live is what the client
    // was being shown before the snapshot existed.
    const live = [block({ targetSets: 5 })];

    expect(
      resolvePrescription(
        payload({ status: 'in_progress', exercises: live, programSnapshot: null }),
      ),
    ).toEqual(live);
  });

  it('reads live again once the session is completed', () => {
    // The server clears the column in the completion transaction; this is
    // the belt to that braces — status alone is enough.
    const live = [block({ targetSets: 5 })];

    expect(
      resolvePrescription(
        payload({ status: 'completed', exercises: live, programSnapshot: [block()] }),
      ),
    ).toEqual(live);
  });

  it('is an empty list, never a throw, for a session with no payload', () => {
    expect(resolvePrescription(null)).toEqual([]);
  });
});

describe('hasProgramChanged', () => {
  it('is false when the frozen and live prescriptions agree', () => {
    expect(
      hasProgramChanged(
        payload({ status: 'in_progress', exercises: [block()], programSnapshot: [block()] }),
      ),
    ).toBe(false);
  });

  it('is false with no snapshot, whatever the live day says', () => {
    expect(
      hasProgramChanged(
        payload({ status: 'in_progress', exercises: [block()], programSnapshot: null }),
      ),
    ).toBe(false);
    expect(hasProgramChanged(null)).toBe(false);
  });

  it('is false for a session that has not started — there is nothing to have missed', () => {
    expect(
      hasProgramChanged(
        payload({
          status: 'scheduled',
          exercises: [block({ targetSets: 5 })],
          programSnapshot: [block()],
        }),
      ),
    ).toBe(false);
  });

  it('notices a changed target', () => {
    for (const changed of [
      block({ targetSets: 4 }),
      block({ targetRepsMin: 6 }),
      block({ targetRepsMax: 12 }),
      block({ targetRpe: 9 }),
      block({ targetRir: 2 }),
      block({ targetWeightKg: 62.5 }),
      block({ targetPercent1rm: 80 }),
      block({ targetRestSeconds: 90 }),
      block({ tempo: '3010' }),
      block({ supersetGroup: 'A' }),
      block({ coachNotes: 'Film the top set' }),
      block({ exerciseId: 'exercise-2' }),
      block({ orderIndex: 1 }),
      block({ alternatives: ['exercise-2'] }),
    ]) {
      expect(
        hasProgramChanged(
          payload({ status: 'in_progress', exercises: [changed], programSnapshot: [block()] }),
        ),
      ).toBe(true);
    }
  });

  it('notices an added or removed exercise', () => {
    expect(
      hasProgramChanged(
        payload({
          status: 'in_progress',
          exercises: [block(), block({ programExerciseId: 'block-2' })],
          programSnapshot: [block()],
        }),
      ),
    ).toBe(true);
    expect(
      hasProgramChanged(
        payload({ status: 'in_progress', exercises: [], programSnapshot: [block()] }),
      ),
    ).toBe(true);
  });

  it('notices a reorder even when every block is otherwise identical', () => {
    const first = block({ programExerciseId: 'block-1', orderIndex: 0 });
    const second = block({ programExerciseId: 'block-2', orderIndex: 1 });

    expect(
      hasProgramChanged(
        payload({
          status: 'in_progress',
          exercises: [
            { ...second, orderIndex: 0 },
            { ...first, orderIndex: 1 },
          ],
          programSnapshot: [first, second],
        }),
      ),
    ).toBe(true);
  });
});
