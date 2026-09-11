import { NOT_FOUND_COPY } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  buildBlock,
  buildExercise,
  buildSession as buildUpcomingSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LoggerSession, LoggerSessionState } from '../../hooks/useLoggerSession.ts';
import { SessionLoggerScreen } from '../SessionLoggerScreen.tsx';

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The shell's body, state by state. The screen is real; only its local read
// is stood in for, the same split `TodayScreen.test.tsx` makes and for the
// same reason — the SQLite read is asynchronous and has nothing to do with
// what is being proved here.

let mockState: LoggerSessionState = { kind: 'loading' };
const mockRetry = jest.fn();

jest.mock('../../hooks/useLoggerSession.ts', () => ({
  ...jest.requireActual('../../hooks/useLoggerSession.ts'),
  useLoggerSession: () => ({ state: mockState, retry: mockRetry }),
}));

// Task 08's claim heartbeat. The hook's own behaviour — when it ticks, when
// it stays quiet — is `hooks/__tests__/useSessionHeartbeat.test.tsx`; what
// the screen owns is only what it hands the hook, and getting that wrong is
// silent: a session heartbeated with `isActive: true` when it is not being
// logged is the drawer-phone case, and one handed a `null` server id it
// could have supplied never holds the claim at all.
const mockHeartbeat = jest.fn();
jest.mock('../../hooks/useSessionHeartbeat.ts', () => ({
  useSessionHeartbeat: (options: unknown) => {
    mockHeartbeat(options);
  },
}));

const STARTED_AT = new Date('2026-08-15T09:00:00.000Z');

const EXERCISE_NAMES = [
  'Barbell bench press',
  'Incline dumbbell press',
  'Chest-supported row',
  'Lat pulldown',
  'Cable lateral raise',
  'Rope triceps pushdown',
];

/**
 * A real prescription, not a `null` payload with a count beside it. Task 03
 * renders the pager FROM the payload, so a stub whose `exerciseCount`
 * disagreed with it would assert a screen the app cannot produce.
 */
const PRESCRIPTION: LocalSessionPayload = {
  session: buildUpcomingSession({
    exercises: EXERCISE_NAMES.map((_, i) =>
      buildBlock({
        programExerciseId: `b-${String(i + 1)}`,
        exerciseId: `e-${String(i + 1)}`,
        orderIndex: i + 1,
      }),
    ),
  }),
  exercises: EXERCISE_NAMES.map((name, i) => buildExercise({ id: `e-${String(i + 1)}`, name })),
};

/** What `useStartAdHocSession` writes: a real payload carrying no blocks. */
const AD_HOC: LocalSessionPayload = {
  session: buildUpcomingSession({ name: null, dayName: null, exercises: [] }),
  exercises: [],
};

function buildSession(overrides: Partial<LoggerSession> = {}): LoggerSession {
  return {
    localId: 'local-1',
    serverId: 'session-1',
    name: 'Upper A',
    status: 'in_progress',
    isInProgress: true,
    startedAt: STARTED_AT,
    exerciseCount: 6,
    targetSets: 22,
    setsLogged: 8,
    payload: PRESCRIPTION,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { kind: 'loading' };
});

function renderScreen() {
  const onExit = jest.fn();
  render(<SessionLoggerScreen sessionLocalId="local-1" onExit={onExit} now={STARTED_AT} />);
  return { onExit };
}

describe('a session that loaded', () => {
  beforeEach(() => {
    mockState = { kind: 'session', session: buildSession() };
  });

  it('renders the header the rest of the feature hangs off', () => {
    renderScreen();

    expect(screen.getByText('Upper A')).toBeTruthy();
    expect(screen.getByText('8 of 22 sets')).toBeTruthy();
  });

  it('fills the body with task 03 s exercise pager', () => {
    renderScreen();

    expect(screen.getByTestId('logger-body')).toBeTruthy();
    expect(screen.getByTestId('exercise-pager')).toBeTruthy();
    expect(screen.getByText('Exercise 1 of 6')).toBeTruthy();
    expect(screen.getByText('Barbell bench press')).toBeTruthy();
  });

  it('shows no error, empty or not-found state', () => {
    renderScreen();

    expect(screen.queryByTestId('logger-error')).toBeNull();
    expect(screen.queryByTestId('logger-no-prescription')).toBeNull();
  });

  it('holds the claim for as long as the logger is open', () => {
    renderScreen();

    expect(mockHeartbeat).toHaveBeenCalledWith({ serverId: 'session-1', isActive: true });
  });
});

describe('the claim the open logger holds', () => {
  // Every branch here is a way the screen could hold a claim it should not,
  // or fail to hold one it should. None of them is visible on screen, which
  // is why they are asserted rather than left to the hook.

  it('holds nothing for a session the server has never seen', () => {
    // Started offline, outbox not yet flushed. There is no row to claim, so
    // the hook idles until the flush gives the row a server id — it must not
    // be handed the local key in its place. `isActive` stays true because the
    // client genuinely is logging; it is the missing id that gates the tick.
    mockState = { kind: 'session', session: buildSession({ serverId: null }) };
    renderScreen();

    expect(mockHeartbeat).toHaveBeenCalledWith({ serverId: null, isActive: true });
  });

  it('stops holding a session the client is not logging', () => {
    // A paused or completed session keeps its server id, and a device that
    // went on heartbeating one would hold it for six hours — the drawer
    // phone, seen from this side (DB§14.5).
    mockState = {
      kind: 'session',
      session: buildSession({ status: 'completed', isInProgress: false }),
    };
    renderScreen();

    expect(mockHeartbeat).toHaveBeenCalledWith({ serverId: 'session-1', isActive: false });
  });

  it('holds nothing while the read is still in flight', () => {
    renderScreen();

    expect(mockHeartbeat).toHaveBeenCalledWith({ serverId: null, isActive: false });
  });

  it('holds nothing for a session the device does not have', () => {
    mockState = { kind: 'not-found' };
    renderScreen();

    expect(mockHeartbeat).toHaveBeenCalledWith({ serverId: null, isActive: false });
  });
});

describe('a session with nothing prescribed', () => {
  it('says so rather than leaving the body blank', () => {
    // The ad-hoc session `today-card/04` starts. It is a permanent state —
    // there is no plan for task 03 to page — so the shell owns it.
    mockState = {
      kind: 'session',
      session: buildSession({ name: null, exerciseCount: 0, payload: AD_HOC }),
    };
    renderScreen();

    expect(screen.getByTestId('logger-no-prescription')).toBeTruthy();
    expect(screen.getByText('Nothing prescribed for this one.')).toBeTruthy();
  });

  it('never claims the client started it themselves — an unreadable payload lands here too', () => {
    // `lib/prefetch/history.ts` writes a different payload into the same
    // column, and a row it wrote narrows to null. That is an ASSIGNED
    // session whose prescription cannot be read, not one the client began.
    mockState = {
      kind: 'session',
      session: buildSession({ name: 'Upper A', exerciseCount: 0, payload: null }),
    };
    renderScreen();

    expect(screen.getByTestId('logger-no-prescription')).toBeTruthy();
    expect(screen.queryByText(/you started/i)).toBeNull();
  });
});

describe('a local read that failed', () => {
  beforeEach(() => {
    mockState = { kind: 'error', error: new Error('database is locked') };
  });

  it('reassures before it explains, and never shows the raw error', () => {
    renderScreen();

    expect(screen.getByText('Nothing you logged has been lost.')).toBeTruthy();
    expect(screen.queryByText(/database is locked/)).toBeNull();
  });

  it('offers a retry that re-runs the read', () => {
    renderScreen();

    fireEvent.press(screen.getByText('Try again'));

    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('still lets the client leave', () => {
    const { onExit } = renderScreen();

    fireEvent.press(screen.getByLabelText('Go back'));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('a session id the device does not hold', () => {
  beforeEach(() => {
    mockState = { kind: 'not-found' };
  });

  it('is a recoverable screen, not a dead end (`CLAUDE.md` §9.2)', () => {
    const { onExit } = renderScreen();

    expect(screen.getByText(NOT_FOUND_COPY.title)).toBeTruthy();
    fireEvent.press(screen.getByText(NOT_FOUND_COPY.action));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('never claims the session belongs to someone else', () => {
    // `ERRORS.md` ER§2.1 — not-found and forbidden are distinct states and
    // this route can only ever be the first.
    renderScreen();

    expect(screen.queryByText(/don’t have access/i)).toBeNull();
  });
});

describe('while the read is in flight', () => {
  it('shows no spinner, and no state that could be wrong a frame later', () => {
    renderScreen();

    expect(screen.queryByTestId('logger-error')).toBeNull();
    expect(screen.queryByTestId('logger-no-prescription')).toBeNull();
  });

  it('still lets the client leave', () => {
    const { onExit } = renderScreen();

    fireEvent.press(screen.getByLabelText('Pause workout and go back'));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
