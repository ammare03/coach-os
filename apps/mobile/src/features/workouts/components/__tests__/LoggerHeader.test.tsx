import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LoggerSession, LoggerSessionState } from '../../hooks/useLoggerSession.ts';
import { LoggerHeader, loggerExitAction, loggerSubtitle, loggerTitle } from '../LoggerHeader.tsx';
import { formatElapsed } from '../SessionElapsed.tsx';

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The header is the whole of task 02's chrome, and every rule it carries is
// a degradation rule: what each of the three slots says when the thing it
// names is missing, and what the one way out is called when there is
// nothing left to pause.

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

function sessionState(overrides: Partial<LoggerSession> = {}): LoggerSessionState {
  return { kind: 'session', session: buildSession(overrides) };
}

describe('loggerTitle', () => {
  it('uses the session’s own name', () => {
    expect(loggerTitle(sessionState())).toBe('Upper A');
  });

  it('falls back to one neutral word when the session has no name', () => {
    // An ad-hoc session has no name, no day name and no program day. The
    // fallback must be true of every session this route can open, so it
    // names none of them (`COPY.md` CO§4 — state the fact).
    expect(loggerTitle(sessionState({ name: null }))).toBe('Workout');
  });

  it.each<[string, LoggerSessionState]>([
    ['error', { kind: 'error', error: new Error('locked') }],
    ['not found', { kind: 'not-found' }],
  ])('falls back to the same word when the session is %s', (_label, state) => {
    expect(loggerTitle(state)).toBe('Workout');
  });

  it('says nothing while the read is still in flight', () => {
    // A title that appeared and then changed under the client's eye is
    // worse than one that arrives once. The slot is a skeleton instead.
    expect(loggerTitle({ kind: 'loading' })).toBeNull();
  });
});

describe('loggerSubtitle', () => {
  it('counts logged sets against the prescription', () => {
    expect(loggerSubtitle(sessionState())).toBe('8 of 22 sets');
  });

  it('counts what was logged when there is no prescription to count against', () => {
    // An ad-hoc session. Never "8 of 0" and never a percentage
    // (`DESIGN.md` §10.3 — facts over percentages).
    expect(loggerSubtitle(sessionState({ targetSets: 0, setsLogged: 3 }))).toBe('3 sets logged');
  });

  it('states the fact rather than a zero when nothing has been logged yet', () => {
    expect(loggerSubtitle(sessionState({ targetSets: 0, setsLogged: 0 }))).toBe(
      'No sets logged yet',
    );
  });

  it.each<[string, LoggerSessionState]>([
    ['loading', { kind: 'loading' }],
    ['error', { kind: 'error', error: new Error('locked') }],
    ['not found', { kind: 'not-found' }],
  ])('drops the line entirely when %s, never rendering an em-dash pair', (_label, state) => {
    expect(loggerSubtitle(state)).toBeNull();
  });
});

describe('loggerExitAction', () => {
  it('offers to pause a session that is under way', () => {
    // `ui-conventions` §5 prefers undo over confirm, and there is nothing
    // here to undo: the row stays `in_progress` and Today offers Continue.
    expect(loggerExitAction(sessionState())).toEqual({
      label: 'Pause',
      accessibilityLabel: 'Pause workout and go back',
    });
  });

  it('keeps offering to pause while the read is in flight', () => {
    // Arriving here at all means a session was just started, so the
    // optimistic label is right in every path but the two that fail — and
    // it never flips under a thumb mid-set.
    expect(loggerExitAction({ kind: 'loading' }).label).toBe('Pause');
  });

  it.each<[string, LoggerSessionState]>([
    ['error', { kind: 'error', error: new Error('locked') }],
    ['not found', { kind: 'not-found' }],
    ['not started', sessionState({ isInProgress: false, startedAt: null, status: 'scheduled' })],
  ])('says Back instead when there is no session to pause (%s)', (_label, state) => {
    expect(loggerExitAction(state)).toEqual({
      label: 'Back',
      accessibilityLabel: 'Go back',
    });
  });
});

describe('formatElapsed', () => {
  it('renders minutes and seconds, zero-padded, for a normal session', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9)).toBe('0:09');
    expect(formatElapsed(1128)).toBe('18:48');
  });

  it('grows an hours segment rather than rolling over past sixty minutes', () => {
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3734)).toBe('1:02:14');
  });

  it('clamps a negative interval to zero rather than rendering a minus', () => {
    // A device clock that moved backwards, not a bug worth a state for.
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('the header', () => {
  it('exposes the way out as a labelled button, not a bare glyph', () => {
    const onExit = jest.fn();
    render(<LoggerHeader state={sessionState()} onExit={onExit} now={STARTED_AT} />);

    fireEvent.press(screen.getByLabelText('Pause workout and go back'));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pause')).toBeTruthy();
  });

  it.each<[string, LoggerSessionState]>([
    ['loading', { kind: 'loading' }],
    ['error', { kind: 'error', error: new Error('locked') }],
    ['not found', { kind: 'not-found' }],
  ])('keeps that way out working when the read is %s', (_label, state) => {
    // `screen-composition` §3 rule 3 — the primary action never depends on
    // a query. A client mid-gym must always be able to leave.
    const onExit = jest.fn();
    render(<LoggerHeader state={state} onExit={onExit} />);

    fireEvent.press(screen.getByLabelText(loggerExitAction(state).accessibilityLabel));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the time since the session started', () => {
    render(
      <LoggerHeader
        state={sessionState()}
        onExit={jest.fn()}
        now={new Date(STARTED_AT.getTime() + 1128_000)}
      />,
    );

    expect(screen.getByLabelText('Elapsed 18 minutes 48 seconds')).toBeTruthy();
  });

  it('renders no clock at all for a session with no start time', () => {
    render(
      <LoggerHeader
        state={sessionState({ isInProgress: false, startedAt: null, status: 'scheduled' })}
        onExit={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('logger-elapsed')).toBeNull();
  });
});
