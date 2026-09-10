import { render, screen, fireEvent } from '@testing-library/react-native';

import type {
  TodaySessionPhase,
  TodaySessionState,
  TodaySessionSummary,
} from '../../hooks/useTodaySession.ts';
import { TodayCard } from '../TodayCard.tsx';

// Every frame `A`–`G` (`today-card/DESIGN-SPEC.md`). Queried by accessible
// name wherever possible, so the test doubles as the accessibility check
// the `testing` skill §6 asks for.
//
// The last describe is `today-card/03`'s third acceptance criterion, which
// is the one that cannot be read off a screenshot: session, rest day and no
// program must never overlap or render for the wrong condition.

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
    // Required since `today-card/04` — all three of §3.9's entry points
    // hang off it, and `TodayScreen` always supplies it.
    onStartAdHoc: jest.fn(),
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

  // `today-card/04`. Live on every render now, not conditionally: the
  // handler is required, so there is no state in which the completed card
  // offers only one action.
  it('offers the ad-hoc action alongside the summary', () => {
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

describe('a session whose payload the history writer clobbered', () => {
  // `lib/prefetch/history.ts` and `lib/prefetch/sessions.ts` write two
  // different shapes into the same `payload_json` column and divide it by
  // date on independently-computed clocks, so across local midnight today's
  // row can arrive in history's shape. `summariseSession` degrades to this
  // all-zero summary rather than throwing, and the client keeps the session
  // name and the Start button. The card's job is to state nothing false
  // while that is true.
  const DEGRADED: TodaySessionSummary = {
    localId: 'local-1',
    serverId: 'session-1',
    name: 'Upper A',
    exerciseCount: 0,
    targetSets: 0,
    estimatedMinutes: null,
    previewExerciseNames: [],
    remainingExerciseCount: 0,
  };

  it('never claims the client has zero exercises', () => {
    renderCard(sessionState({ phase: 'scheduled' }, DEGRADED));

    expect(screen.queryByText(/0 exercises/)).toBeNull();
    expect(screen.queryByText(/exercise/)).toBeNull();
  });

  it('drops the context line entirely rather than rendering an empty one', () => {
    renderCard(sessionState({ phase: 'scheduled' }, DEGRADED));

    // The name and the one action that matters both survive — the whole
    // point of degrading instead of throwing.
    expect(screen.getByText('Upper A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeTruthy();
    // …and the accessible label is the chip and the name, with no third
    // fragment where the context line would have been.
    expect(screen.getByLabelText('Scheduled today. Upper A')).toBeTruthy();
  });

  it('never says "Set 8 of 0" on a session already under way', () => {
    renderCard(
      sessionState(
        {
          phase: 'in-progress',
          startedAt: new Date('2026-08-16T12:12:00.000Z'),
          setsLogged: 8,
        },
        DEGRADED,
      ),
    );

    expect(screen.queryByText(/of 0/)).toBeNull();
    expect(screen.getByText('Started 18 min ago')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('drops the Sets metric on a completed session rather than showing a zero total', () => {
    renderCard(
      sessionState(
        {
          phase: 'completed',
          completedAt: new Date('2026-08-16T18:12:00.000Z'),
          setsLogged: 22,
          volumeKg: 12450,
          durationSeconds: 3480,
        },
        DEGRADED,
      ),
    );

    expect(screen.queryByText('Sets')).toBeNull();
    expect(screen.queryByText(/of 0/)).toBeNull();
    // The facts that survive the clobbered payload still render.
    expect(screen.getByText('Finished at 6:12 pm')).toBeTruthy();
    expect(screen.getByText('58 min')).toBeTruthy();
  });
});

describe('frame D — a rest day', () => {
  it('states the fact and never congratulates', () => {
    renderCard({ kind: 'rest-day', isRestDay: true });

    expect(screen.getByText('Rest day')).toBeTruthy();
    expect(screen.getByText('Nothing scheduled today.')).toBeTruthy();
  });

  it('is not an error and not a congratulation', () => {
    renderCard({ kind: 'rest-day', isRestDay: true }, { onStartAdHoc: jest.fn() });

    // The three ways this state gets written wrong: a training principle
    // asserted (`COPY.md` CO§1.2), praise (CO§2), or error framing.
    expect(screen.queryByText(/recovery/i)).toBeNull();
    expect(screen.queryByText(/enjoy/i)).toBeNull();
    expect(screen.queryByText(/rest is/i)).toBeNull();
    expect(screen.queryByTestId('today-card-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('swaps only the chip label when the day is unprogrammed rather than a rest day', () => {
    renderCard({ kind: 'rest-day', isRestDay: false });

    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
    expect(screen.getByText('Nothing scheduled today.')).toBeTruthy();
    expect(screen.queryByText('Rest day')).toBeNull();
  });

  it('reads as one accessible item on a rest day', () => {
    renderCard({ kind: 'rest-day', isRestDay: true });

    expect(screen.getByLabelText('Rest day. Nothing scheduled today.')).toBeTruthy();
  });

  it('does not say the same fact twice on an unprogrammed day', () => {
    renderCard({ kind: 'rest-day', isRestDay: false });

    expect(screen.getByLabelText('Nothing scheduled today.')).toBeTruthy();
  });

  it('offers a secondary action, so the state is never a dead end', () => {
    const onStartAdHoc = jest.fn();
    renderCard({ kind: 'rest-day', isRestDay: true }, { onStartAdHoc });

    fireEvent.press(screen.getByRole('button', { name: 'Log something anyway' }));

    expect(onStartAdHoc).toHaveBeenCalled();
  });
});

describe('frame E — no program assigned', () => {
  it('uses EmptyState with exactly one action', () => {
    const onStartAdHoc = jest.fn();
    renderCard({ kind: 'no-program', hasCoach: true }, { onStartAdHoc });

    expect(screen.getByRole('header', { name: 'No program yet.' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Log a workout anyway' })).toBeTruthy();
  });

  it('starts the ad-hoc flow', () => {
    const onStartAdHoc = jest.fn();
    renderCard({ kind: 'no-program', hasCoach: true }, { onStartAdHoc });

    fireEvent.press(screen.getByRole('button', { name: 'Log a workout anyway' }));

    expect(onStartAdHoc).toHaveBeenCalled();
  });

  it('states the fact passively, never editorialising about the coach', () => {
    renderCard({ kind: 'no-program', hasCoach: true }, { onStartAdHoc: jest.fn() });

    expect(
      screen.getByText('No program has been assigned yet. You can still log a workout.'),
    ).toBeTruthy();
    expect(screen.queryByText(/your coach has/i)).toBeNull();
  });

  it('swaps the body for a client with no coach, rather than adding a state', () => {
    renderCard({ kind: 'no-program', hasCoach: false }, { onStartAdHoc: jest.fn() });

    expect(
      screen.getByText('You don’t have a coach right now. You can still log a workout.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log a workout anyway' })).toBeTruthy();
  });

  // The action-less pair the two states used to fall back to is gone with
  // `today-card/04` — `TodayScreen` always supplies the handler, so the
  // offer is never one the screen cannot keep.
  it('makes the same offer to a coachless client as to a coached one', () => {
    renderCard({ kind: 'no-program', hasCoach: false }, { onStartAdHoc: jest.fn() });

    expect(screen.getByTestId('today-card-no-program')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log a workout anyway' })).toBeTruthy();
    // Never editorialises about the coach either way (`COPY.md` CO§3).
    expect(screen.queryByText(/your coach has/i)).toBeNull();
  });
});

describe('the three-way branch', () => {
  // `today-card/03`'s third acceptance criterion. `useTodaySession` decides
  // which state applies; these assertions pin that the card never leaks one
  // state's content into another once it has.
  const restDay: TodaySessionState = { kind: 'rest-day', isRestDay: true };
  const noProgram: TodaySessionState = { kind: 'no-program', hasCoach: true };

  it('shows a session and nothing else', () => {
    renderCard(sessionState({ phase: 'scheduled' }), { onStartAdHoc: jest.fn() });

    expect(screen.getByText('Upper A')).toBeTruthy();
    expect(screen.queryByText('Nothing scheduled today.')).toBeNull();
    expect(screen.queryByText('Rest day')).toBeNull();
    expect(screen.queryByTestId('today-card-no-program')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log something anyway' })).toBeNull();
  });

  it('shows a rest day and nothing else', () => {
    renderCard(restDay, { onStartAdHoc: jest.fn() });

    expect(screen.getByText('Nothing scheduled today.')).toBeTruthy();
    expect(screen.queryByText('Upper A')).toBeNull();
    expect(screen.queryByText('Scheduled today')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    expect(screen.queryByTestId('today-card-no-program')).toBeNull();
  });

  it('shows the no-program empty state and nothing else', () => {
    renderCard(noProgram, { onStartAdHoc: jest.fn() });

    expect(screen.getByTestId('today-card-no-program')).toBeTruthy();
    // Frame `E` is the one state that is not a card at all.
    expect(screen.queryByTestId('today-card')).toBeNull();
    expect(screen.queryByText('Nothing scheduled today.')).toBeNull();
    expect(screen.queryByText('Rest day')).toBeNull();
    expect(screen.queryByText('Upper A')).toBeNull();
  });
});
