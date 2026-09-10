import { render, screen, fireEvent } from '@testing-library/react-native';

import type {
  TodaySessionPhase,
  TodaySessionState,
  TodaySessionSummary,
} from '../../hooks/useTodaySession.ts';
import { TodayCard } from '../TodayCard.tsx';

// Frames `A`, `B`, `C`, `F` and `G` (`today-card/DESIGN-SPEC.md`). Queried
// by accessible name wherever possible, so the test doubles as the
// accessibility check the `testing` skill §6 asks for.
//
// `today-card/03` owns frames `D` and `E`; the two assertions at the bottom
// pin that this component renders nothing for them, so task 03 cannot land
// a second copy by accident.

const SUMMARY: TodaySessionSummary = {
  localId: 'local-1',
  serverId: 'session-1',
  name: 'Upper A',
  exerciseCount: 6,
  targetSets: 22,
  estimatedMinutes: 55,
  previewExerciseNames: ['Bench press', 'Barbell row', 'Overhead press'],
  remainingExerciseCount: 3,
};

const NOW = new Date('2026-08-16T12:30:00.000Z');

function renderCard(
  state: TodaySessionState,
  overrides: Partial<Parameters<typeof TodayCard>[0]> = {},
) {
  const props = {
    state,
    weightUnit: 'kg' as const,
    timeZone: 'UTC',
    now: NOW,
    onOpenSession: jest.fn(),
    onViewSummary: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
  render(<TodayCard {...props} />);
  return props;
}

function sessionState(
  phase: TodaySessionPhase,
  summary: TodaySessionSummary = SUMMARY,
): TodaySessionState {
  return { kind: 'session', session: summary, phase };
}

describe('frame A — a session scheduled today', () => {
  it('states the facts and offers one action', () => {
    renderCard(sessionState({ phase: 'scheduled' }));

    expect(screen.getByText('Scheduled today')).toBeTruthy();
    expect(screen.getByText('Upper A')).toBeTruthy();
    // "~" on the minutes, never a hard estimate (§3.1).
    expect(screen.getByText('6 exercises · ~55 min · 22 sets')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeTruthy();
  });

  it('names three exercises and counts the rest', () => {
    renderCard(sessionState({ phase: 'scheduled' }));

    expect(screen.getByText('Bench press')).toBeTruthy();
    expect(screen.getByText('Overhead press')).toBeTruthy();
    expect(screen.getByText('+3 more')).toBeTruthy();
  });

  it('omits the duration segment rather than rendering a dash it cannot fill', () => {
    renderCard(sessionState({ phase: 'scheduled' }, { ...SUMMARY, estimatedMinutes: null }));

    expect(screen.getByText('6 exercises · 22 sets')).toBeTruthy();
  });

  it('reads as one accessible item, not six fragments', () => {
    renderCard(sessionState({ phase: 'scheduled' }));

    expect(
      screen.getByLabelText('Scheduled today. Upper A. 6 exercises · ~55 min · 22 sets'),
    ).toBeTruthy();
  });

  it('opens the logger with the session’s LOCAL id', () => {
    const props = renderCard(sessionState({ phase: 'scheduled' }));

    fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));

    expect(props.onOpenSession).toHaveBeenCalledWith('local-1');
  });

  it('warms the logger on press-in, before navigation', () => {
    const onPrefetchSession = jest.fn();
    renderCard(sessionState({ phase: 'scheduled' }), { onPrefetchSession });

    fireEvent(screen.getByRole('button', { name: 'Start workout' }), 'touchStart');

    expect(onPrefetchSession).toHaveBeenCalledWith('local-1');
  });

  it('pluralises a single-exercise session', () => {
    renderCard(
      sessionState(
        { phase: 'scheduled' },
        { ...SUMMARY, exerciseCount: 1, targetSets: 1, estimatedMinutes: null },
      ),
    );

    expect(screen.getByText('1 exercise · 1 set')).toBeTruthy();
  });
});

describe('frame B — a session in progress', () => {
  const phase: TodaySessionPhase = {
    phase: 'in-progress',
    startedAt: new Date('2026-08-16T12:12:00.000Z'),
    setsLogged: 8,
  };

  it('shows the position and how long ago it started', () => {
    renderCard(sessionState(phase));

    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Set 8 of 22 · started 18 min ago')).toBeTruthy();
  });

  it('offers Continue rather than Start', () => {
    const props = renderCard(sessionState(phase));

    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onOpenSession).toHaveBeenCalledWith('local-1');
  });

  it('never says a session started zero minutes ago', () => {
    renderCard(sessionState({ ...phase, startedAt: new Date('2026-08-16T12:29:50.000Z') }));

    expect(screen.getByText('Set 8 of 22 · started 1 min ago')).toBeTruthy();
  });

  it('switches to hours once the session has been open more than one', () => {
    renderCard(sessionState({ ...phase, startedAt: new Date('2026-08-16T10:00:00.000Z') }));

    expect(screen.getByText('Set 8 of 22 · started 2 h ago')).toBeTruthy();
  });
});

describe('frame C — a session completed today', () => {
  const phase: TodaySessionPhase = {
    phase: 'completed',
    completedAt: new Date('2026-08-16T18:12:00.000Z'),
    setsLogged: 22,
    volumeKg: 12450,
    durationSeconds: 3480,
  };

  it('reports facts and never praise', () => {
    renderCard(sessionState(phase));

    expect(screen.getByText('Completed today')).toBeTruthy();
    expect(screen.getByText('Finished at 6:12 pm')).toBeTruthy();
    expect(screen.getByText('22 of 22')).toBeTruthy();
    expect(screen.getByText('58 min')).toBeTruthy();
  });

  it('renders the volume through the unit formatter, with the unit outside the string', () => {
    renderCard(sessionState(phase));

    // `formatWeight(12450, 'kg')` → "12450.0", and "kg" is a separate label
    // read from the user's own preference (`COPY.md` CO§5).
    expect(screen.getByText('12450.0')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
  });

  it('converts at the render edge for a client who reads pounds', () => {
    renderCard(sessionState(phase), { weightUnit: 'lb' });

    expect(screen.getByText('27448')).toBeTruthy();
    expect(screen.getByText('lb')).toBeTruthy();
  });

  it('omits the volume metric rather than claiming a client lifted nothing', () => {
    renderCard(sessionState({ ...phase, volumeKg: null }));

    expect(screen.queryByText('Volume')).toBeNull();
    expect(screen.getByText('22 of 22')).toBeTruthy();
  });

  it('opens the summary route', () => {
    const props = renderCard(sessionState(phase));

    fireEvent.press(screen.getByRole('button', { name: 'View summary' }));

    expect(props.onViewSummary).toHaveBeenCalledWith('local-1');
  });

  it('hides the ad-hoc action until today-card/04 supplies it', () => {
    renderCard(sessionState(phase));

    expect(screen.queryByRole('button', { name: 'Log another workout' })).toBeNull();
  });

  it('offers the ad-hoc action once it is supplied', () => {
    const onStartAdHoc = jest.fn();
    renderCard(sessionState(phase), { onStartAdHoc });

    fireEvent.press(screen.getByRole('button', { name: 'Log another workout' }));

    expect(onStartAdHoc).toHaveBeenCalled();
  });
});

describe('frame F — loading', () => {
  it('renders nothing below the 250ms gate, so a sub-frame read never flickers', () => {
    renderCard({ kind: 'loading', showSkeleton: false });

    expect(screen.queryByTestId('today-card-skeleton')).toBeNull();
    expect(screen.queryByTestId('today-card')).toBeNull();
  });

  it('mounts a hero-shaped skeleton past the gate, labelled exactly once', () => {
    renderCard({ kind: 'loading', showSkeleton: true });

    expect(screen.getByTestId('today-card-skeleton')).toBeTruthy();
    expect(screen.getAllByLabelText("Loading today's session")).toHaveLength(1);
  });
});

describe('frame G — the local read failed', () => {
  it('says what happened and what is safe, never a code', () => {
    renderCard({ kind: 'error', error: new Error('database is locked') });

    expect(screen.getByText('Today’s session didn’t load.')).toBeTruthy();
    expect(screen.getByText('Nothing you logged has been lost.')).toBeTruthy();
    expect(screen.queryByText(/database is locked/)).toBeNull();
  });

  it('retries', () => {
    const props = renderCard({ kind: 'error', error: new Error('nope') });

    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(props.onRetry).toHaveBeenCalled();
  });
});

describe('frames D and E belong to today-card/03', () => {
  it('renders nothing for a rest day', () => {
    const { toJSON } = render(
      <TodayCard
        state={{ kind: 'rest-day', isRestDay: true }}
        weightUnit="kg"
        timeZone="UTC"
        now={NOW}
        onOpenSession={jest.fn()}
        onViewSummary={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing for a client with no program', () => {
    const { toJSON } = render(
      <TodayCard
        state={{ kind: 'no-program', hasCoach: true }}
        weightUnit="kg"
        timeZone="UTC"
        now={NOW}
        onOpenSession={jest.fn()}
        onViewSummary={jest.fn()}
        onRetry={jest.fn()}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
