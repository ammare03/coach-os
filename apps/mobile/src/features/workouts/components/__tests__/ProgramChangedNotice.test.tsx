import { render, screen } from '@testing-library/react-native';
import type { UpcomingSessionExercise } from 'api/src/features/workouts/upcoming.ts';

import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { ProgramChangedNotice } from '../ProgramChangedNotice.tsx';

// `session-runtime/09` step 4. The note must appear exactly when the frozen
// and live prescriptions disagree, say the ER§1.5 sentence verbatim, and
// never present itself as something to dismiss or act on.

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
  programSnapshot: UpcomingSessionExercise[] | null;
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
      programSnapshot: args.programSnapshot,
    },
    exercises: [],
  };
}

/** In progress, and the coach has since changed the set count. */
const CHANGED = payload({
  status: 'in_progress',
  exercises: [block({ targetSets: 5 })],
  programSnapshot: [block({ targetSets: 3 })],
});

describe('ProgramChangedNotice', () => {
  it('says the ER§1.5 sentence, verbatim, when the coach has edited mid-session', () => {
    render(<ProgramChangedNotice payload={CHANGED} />);

    // One paragraph, so the two sentences compose into one text node — the
    // quieter second half is a nested span, not a second block that could
    // break away from the first at 200% text.
    expect(
      screen.getByText(
        'Your coach updated this workout. The changes start from your next session.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('The changes start from your next session.')).toBeTruthy();
  });

  it('reads as one announcement, not two fragments', () => {
    render(<ProgramChangedNotice payload={CHANGED} />);

    // Both sentences in one label: the fact alone reads as something to act
    // on, and the sentence that defuses it is the second one.
    expect(
      screen.getByLabelText(
        'Your coach updated this workout. The changes start from your next session.',
      ),
    ).toBeTruthy();
  });

  it('offers nothing to press — it never interrupts set entry', () => {
    render(<ProgramChangedNotice payload={CHANGED} />);

    // No dismiss, no retry, no action. A client's next tap is a set.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when the coach has not changed anything', () => {
    render(
      <ProgramChangedNotice
        payload={payload({
          status: 'in_progress',
          exercises: [block()],
          programSnapshot: [block()],
        })}
      />,
    );

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });

  it('renders nothing offline — no edit can have arrived, so there is nothing to report', () => {
    // A device with no signal never refreshes the live copy, so the two
    // sides agree and the condition is false. Same shape as a session with
    // no snapshot at all.
    render(
      <ProgramChangedNotice
        payload={payload({
          status: 'in_progress',
          exercises: [block({ targetSets: 5 })],
          programSnapshot: null,
        })}
      />,
    );

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });

  it('renders nothing before the session starts, or after it ends', () => {
    for (const status of ['scheduled', 'completed'] as const) {
      render(
        <ProgramChangedNotice
          payload={payload({
            status,
            exercises: [block({ targetSets: 5 })],
            programSnapshot: [block({ targetSets: 3 })],
          })}
        />,
      );
      expect(screen.queryByTestId('program-changed-notice')).toBeNull();
    }
  });

  it('renders nothing while the local read is still in flight', () => {
    render(<ProgramChangedNotice payload={null} />);

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });
});
