import { NOT_FOUND_COPY } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

const STARTED_AT = new Date('2026-08-15T09:00:00.000Z');

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
    payload: null,
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

  it('reserves the body for the exercise content task 03 fills in', () => {
    renderScreen();

    expect(screen.getByTestId('logger-body')).toBeTruthy();
  });

  it('shows no error, empty or not-found state', () => {
    renderScreen();

    expect(screen.queryByTestId('logger-error')).toBeNull();
    expect(screen.queryByTestId('logger-no-prescription')).toBeNull();
  });
});

describe('a session with nothing prescribed', () => {
  it('says so rather than leaving the body blank', () => {
    // The ad-hoc session `today-card/04` starts. It is a permanent state —
    // there is no plan for task 03 to page — so the shell owns it.
    mockState = { kind: 'session', session: buildSession({ name: null, exerciseCount: 0 }) };
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
