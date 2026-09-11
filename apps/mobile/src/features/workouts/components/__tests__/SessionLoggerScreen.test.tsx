import { NOT_FOUND_COPY, ToastProvider } from '@coachos/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import {
  buildBlock,
  buildExercise,
  buildSession as buildUpcomingSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type {
  ExerciseTargetState,
  UseExerciseTargetOptions,
} from '../../hooks/useExerciseTarget.ts';
import type { LoggerSession, LoggerSessionState } from '../../hooks/useLoggerSession.ts';
import { PROGRAM_CHANGED_WHEN, speakProgramChanged } from '../../lib/program-change-copy.ts';
import { NO_HISTORY_LABEL } from '../../lib/target-line-copy.ts';
import { useRestTimerStore } from '../../store/rest-timer-store.ts';
import { REST_TIMER_COPY } from '../RestTimerBar.tsx';
import { FINISH_COPY } from '../SessionFinish.tsx';
import { SessionLoggerScreen } from '../SessionLoggerScreen.tsx';

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The real `TargetLine` renders below — only its READ is stood in for, the
// same split this file already makes for the session read. What the shell
// owns is which page slot the line lands in and which three values reach the
// resolver; how the line then renders them is `TargetLine.test.tsx`.
const mockExerciseTarget = jest.fn();
jest.mock('../../hooks/useExerciseTarget.ts', () => ({
  useExerciseTarget: (options: UseExerciseTargetOptions): ExerciseTargetState => {
    mockExerciseTarget(options);
    return { target: null, history: { kind: 'ready', last: null, previous: null } };
  },
}));

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

// Task 07's completion. The hook's own rules — the local write, the outbox
// chain, the second tap that queues nothing — are its own tests; what the
// screen owns is the order of complete → haptic → navigate, and that a
// rejection reaches the surface instead of being swallowed.
const mockComplete = jest.fn();
jest.mock('../../hooks/useCompleteSession.ts', () => ({
  useCompleteSession: () => ({ complete: mockComplete }),
}));

// `ui-conventions` §5 sanctions exactly three haptics. Mocked at the native
// module rather than at `@coachos/ui` so the assertions below can prove both
// halves of that rule: that `Success` fires here, and that nothing else does.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const COMPLETED: { localId: string; outboxId: string | null; completedAt: Date } = {
  localId: 'local-1',
  outboxId: 'outbox-1',
  completedAt: new Date('2026-08-15T10:02:00.000Z'),
};

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

// Task 05's keep-awake, split the same way. When the lock is taken and
// released is `hooks/__tests__/useSessionKeepAwake.test.tsx`; what the screen
// owns is the gate it hands the hook, and both ways of getting it wrong are
// invisible on screen — a session pinned awake that nobody is logging is a
// battery regression against `CLAUDE.md` §19, and one left unpinned is the
// screen locking on a client mid-rest.
const mockKeepAwake = jest.fn();
jest.mock('../../hooks/useSessionKeepAwake.ts', () => ({
  useSessionKeepAwake: (options: unknown) => {
    mockKeepAwake(options);
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

const BLOCKS = EXERCISE_NAMES.map((_, i) =>
  buildBlock({
    programExerciseId: `b-${String(i + 1)}`,
    exerciseId: `e-${String(i + 1)}`,
    orderIndex: i + 1,
  }),
);

const LIBRARY = EXERCISE_NAMES.map((name, i) => buildExercise({ id: `e-${String(i + 1)}`, name }));

/**
 * A real prescription, not a `null` payload with a count beside it. Task 03
 * renders the pager FROM the payload, so a stub whose `exerciseCount`
 * disagreed with it would assert a screen the app cannot produce.
 *
 * The fixture session is `scheduled` with no `programSnapshot`, so nothing
 * is frozen and task 09's notice is correctly absent from every test that
 * uses it.
 */
const PRESCRIPTION: LocalSessionPayload = {
  session: buildUpcomingSession({ exercises: BLOCKS }),
  exercises: LIBRARY,
};

/**
 * Started, frozen, and untouched since — the ordinary case. The frozen copy
 * and the coach's live day are the same blocks, so there is nothing to say.
 */
const FROZEN_UNCHANGED: LocalSessionPayload = {
  session: buildUpcomingSession({
    status: 'in_progress',
    programSnapshot: BLOCKS,
    exercises: BLOCKS,
  }),
  exercises: LIBRARY,
};

/** The same session after the coach raised the opening block's target sets. */
const FROZEN_CHANGED: LocalSessionPayload = {
  session: buildUpcomingSession({
    status: 'in_progress',
    programSnapshot: BLOCKS,
    exercises: BLOCKS.map((block, i) => (i === 0 ? { ...block, targetSets: 5 } : block)),
  }),
  exercises: LIBRARY,
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
  mockComplete.mockResolvedValue(COMPLETED);
});

function renderScreen() {
  const onExit = jest.fn();
  const onCompleted = jest.fn();
  // The set-entry slot inside reaches `useUndoToast` (`set-entry/06`), which
  // needs the host the root layout provides in the app.
  render(
    <ToastProvider>
      <SessionLoggerScreen
        sessionLocalId="local-1"
        onExit={onExit}
        onCompleted={onCompleted}
        now={STARTED_AT}
      />
    </ToastProvider>,
  );
  return { onExit, onCompleted };
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

  it('fills the page slot with task 04 s target line', () => {
    renderScreen();

    // Without this the pager renders a card with an exercise name and an
    // empty well under it. Exactly ONE is reachable, not two: task 03 keeps
    // the neighbouring page out of the reading order, so its line is mounted
    // but not queryable — the same thing a screen reader sees.
    expect(screen.getAllByText(NO_HISTORY_LABEL)).toHaveLength(1);
  });

  it('builds it only for the pages inside the render window', () => {
    renderScreen();

    // ±1. A six-exercise session that built all six would run six history
    // reads on mount, four of them for pages the client cannot reach without
    // swiping (`frontend-performance` §3).
    //
    // Counted as DISTINCT PAGES rather than calls: `set-entry/01` mounts a
    // second consumer of this hook in the same slot (the composer needs the
    // same last-time weight the line prints), so the call count is now one
    // per consumer per page. The window is what this test owns, and a third
    // consumer must not break it.
    const windowed = new Set(
      mockExerciseTarget.mock.calls.map((call) => call[0]?.page?.key as string),
    );
    expect(windowed.size).toBe(2);
    expect(mockExerciseTarget).not.toHaveBeenCalledWith(
      expect.objectContaining({ page: expect.objectContaining({ key: 'b-4' }) }),
    );
  });

  it('resolves the target for the page the client is actually on', () => {
    renderScreen();

    // Matched on `programExerciseId`, which is the page key — a day may carry
    // the same exercise twice, so resolving by anything else shows the wrong
    // prescription.
    expect(mockExerciseTarget).toHaveBeenCalledWith(
      expect.objectContaining({ page: expect.objectContaining({ key: 'b-1' }) }),
    );
  });

  it('gives it the live payload and the session it belongs to', () => {
    renderScreen();

    // The payload is the live prescription mirror — a `null` here is the
    // bulk-edit read path silently going dark. The session id is what the
    // history read is scoped by; the wrong one reads another session's sets.
    expect(mockExerciseTarget).toHaveBeenCalledWith(
      expect.objectContaining({ payload: PRESCRIPTION, sessionLocalId: 'local-1' }),
    );
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

describe('the screen the open logger holds awake', () => {
  it('holds it while the client is logging', () => {
    mockState = { kind: 'session', session: buildSession() };
    renderScreen();

    expect(mockKeepAwake).toHaveBeenCalledWith({ isActive: true });
  });

  it('holds it for a session started offline, which the server has never seen', () => {
    // Unlike the claim, keep-awake needs no server id: the client is standing
    // in the gym under a loaded bar either way, and a session logged in
    // airplane mode is the logger's normal case, not its edge case.
    mockState = { kind: 'session', session: buildSession({ serverId: null }) };
    renderScreen();

    expect(mockKeepAwake).toHaveBeenCalledWith({ isActive: true });
  });

  it('lets it sleep for a session the client is not logging', () => {
    // A completed or paused session opened for review. Pinning the screen for
    // it is pure battery cost (`frontend-performance` §8).
    mockState = {
      kind: 'session',
      session: buildSession({ status: 'completed', isInProgress: false }),
    };
    renderScreen();

    expect(mockKeepAwake).toHaveBeenCalledWith({ isActive: false });
  });

  it.each([
    ['while the read is still in flight', { kind: 'loading' } as const],
    ['for a session the device does not have', { kind: 'not-found' } as const],
    ['when the local read failed', { kind: 'error', error: new Error('locked') } as const],
  ])('lets it sleep %s', (_label, state) => {
    // None of these is a workout in progress, and each is a screen a client
    // could leave open indefinitely.
    mockState = state;
    renderScreen();

    expect(mockKeepAwake).toHaveBeenCalledWith({ isActive: false });
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

describe('a coach who edited the day mid-session', () => {
  it('tells the client, and says when the change applies', () => {
    mockState = { kind: 'session', session: buildSession({ payload: FROZEN_CHANGED }) };
    renderScreen();

    expect(screen.getByTestId('program-changed-notice')).toBeTruthy();
    // Both sentences, and as ONE accessible element. The fact on its own
    // reads mid-set as something to act on, so the sentence that defuses it
    // has to be announced with it rather than after it.
    expect(screen.getByLabelText(speakProgramChanged())).toBeTruthy();
    expect(screen.getByText(PROGRAM_CHANGED_WHEN)).toBeTruthy();
  });

  it('says nothing when the frozen and live copies agree', () => {
    // The ordinary session. A note that appeared on every workout would stop
    // being read by the one client who needs it.
    mockState = { kind: 'session', session: buildSession({ payload: FROZEN_UNCHANGED }) };
    renderScreen();

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });

  it('says nothing once the session is over', () => {
    // The freeze rule ends with the session — from here the edit simply
    // applies, so there is no longer a discrepancy to report.
    mockState = {
      kind: 'session',
      session: buildSession({
        status: 'completed',
        isInProgress: false,
        payload: {
          ...FROZEN_CHANGED,
          session: { ...FROZEN_CHANGED.session, status: 'completed' },
        },
      }),
    };
    renderScreen();

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });

  it.each([
    ['while the read is still in flight', { kind: 'loading' } as const],
    ['for a session the device does not have', { kind: 'not-found' } as const],
    ['when the local read failed', { kind: 'error', error: new Error('locked') } as const],
  ])('says nothing %s', (_label, state) => {
    // None of these holds a payload to compare, and the screen hands the
    // notice `null` rather than letting it guess.
    mockState = state;
    renderScreen();

    expect(screen.queryByTestId('program-changed-notice')).toBeNull();
  });

  it('sits above the body without displacing the pager or the target line', () => {
    mockState = { kind: 'session', session: buildSession({ payload: FROZEN_CHANGED }) };
    renderScreen();

    // A note rendered INSIDE the body would travel with the pages. All four
    // still stand with it on screen, and the target line is still the only
    // one in the reading order.
    expect(screen.getByTestId('program-changed-notice')).toBeTruthy();
    expect(screen.getByTestId('exercise-pager')).toBeTruthy();
    expect(screen.getByTestId('logger-finish')).toBeTruthy();
    expect(screen.getAllByText(NO_HISTORY_LABEL)).toHaveLength(1);
  });
});

describe('finishing the session', () => {
  beforeEach(() => {
    mockState = { kind: 'session', session: buildSession() };
  });

  it('offers one way to finish, named for what it ends', () => {
    renderScreen();

    // "Finish workout", not "Finish": the control sits on the same screen as
    // `Pause` and the two mean opposite things, so the object is named
    // (`DESIGN.md` §10.8).
    expect(screen.getByTestId('logger-finish')).toBeTruthy();
    expect(screen.getByLabelText(FINISH_COPY.action)).toBeTruthy();
  });

  it('never asks the client to confirm', () => {
    const { onCompleted } = renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    // `ui-conventions` §5 prefers undo to confirm, and the summary screen is
    // the confirmation. A dialog between the tap and the completion would be
    // the reflex-dismissed kind.
    expect(mockComplete).toHaveBeenCalledWith('local-1');
    return waitFor(() => {
      expect(onCompleted).toHaveBeenCalledTimes(1);
    });
  });

  it('hands the summary route the id the completion resolved, not the one it was mounted with', async () => {
    const { onCompleted } = renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledWith(COMPLETED.localId);
    });
  });

  it('fires the one sanctioned Success haptic, and no other', async () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    await waitFor(() => {
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });
    // Once per session, never per exercise, and never the set-logged impact
    // — `ui-conventions` §5 sanctions exactly three triggers and this screen
    // may fire exactly one of them.
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('offers it for an ad-hoc session, which has no last exercise to reach', () => {
    // The session `today-card/04` starts. There is no plan to page, so a
    // control living inside the pager would leave this client unable to
    // finish at all.
    mockState = {
      kind: 'session',
      session: buildSession({ name: null, exerciseCount: 0, payload: AD_HOC }),
    };
    renderScreen();

    expect(screen.getByTestId('logger-no-prescription')).toBeTruthy();
    expect(screen.getByTestId('logger-finish')).toBeTruthy();
  });

  it.each([
    ['while the read is still in flight', { kind: 'loading' } as const],
    ['for a session the device does not have', { kind: 'not-found' } as const],
    ['when the local read failed', { kind: 'error', error: new Error('locked') } as const],
  ])('offers nothing to finish %s', (_label, state) => {
    // None of these holds a session, and a control that queued a completion
    // for one would report a finish that never happened.
    mockState = state;
    renderScreen();

    expect(screen.queryByTestId('logger-finish')).toBeNull();
  });

  it('offers nothing to finish for a session that is already complete', () => {
    // Opened for review. The same gate the claim and the wake lock read.
    mockState = {
      kind: 'session',
      session: buildSession({ status: 'completed', isInProgress: false }),
    };
    renderScreen();

    expect(screen.queryByTestId('logger-finish')).toBeNull();
  });
});

describe('a completion the device refused', () => {
  beforeEach(() => {
    mockState = { kind: 'session', session: buildSession() };
    mockComplete.mockRejectedValue(new Error('database is locked'));
  });

  it('says so in place rather than leaving the tap silent', async () => {
    // The failure this whole surface exists for: without it the client taps
    // Finish, nothing happens, and the session stays open.
    renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    await waitFor(() => {
      expect(screen.getByTestId('logger-finish-error')).toBeTruthy();
    });
    expect(screen.getByText(FINISH_COPY.failed)).toBeTruthy();
  });

  it('never navigates, and never celebrates', async () => {
    const { onCompleted } = renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    await waitFor(() => {
      expect(screen.getByTestId('logger-finish-error')).toBeTruthy();
    });
    expect(onCompleted).not.toHaveBeenCalled();
    // `Success` on a session that did not complete would be the phone saying
    // something the data does not, and `Warning` belongs to validation
    // failure — a mirror that could not be written is not a mistyped value.
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('never shows the raw error, and never destroys the screen around it', async () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));

    await waitFor(() => {
      expect(screen.getByTestId('logger-finish-error')).toBeTruthy();
    });
    expect(screen.queryByText(/database is locked/)).toBeNull();
    // The session and every logged set are still on screen and still fine;
    // replacing the logger with a full error state would be disproportionate.
    expect(screen.getByTestId('exercise-pager')).toBeTruthy();
    expect(screen.queryByTestId('logger-error')).toBeNull();
  });

  it('leaves the control pressable, because it is the retry', async () => {
    const { onCompleted } = renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));
    await waitFor(() => {
      expect(screen.getByTestId('logger-finish-error')).toBeTruthy();
    });

    mockComplete.mockResolvedValue(COMPLETED);
    fireEvent.press(screen.getByTestId('logger-finish'));

    // No second button, and no dismissal step between the message and the
    // next attempt.
    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledWith(COMPLETED.localId);
    });
  });

  it('still lets the client pause and leave', async () => {
    const { onExit } = renderScreen();

    fireEvent.press(screen.getByTestId('logger-finish'));
    await waitFor(() => {
      expect(screen.getByTestId('logger-finish-error')).toBeTruthy();
    });

    // `screen-composition` §3 rule 3 — the way out never depends on anything
    // that can fail, including this.
    fireEvent.press(screen.getByLabelText('Pause workout and go back'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

/** Every `testID` in the rendered tree, in document order. */
function testIdsInOrder(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) testIdsInOrder(child, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  const element = node as { props?: Record<string, unknown>; children?: unknown };
  const id = element.props?.['testID'];
  if (typeof id === 'string') found.push(id);
  return testIdsInOrder(element.children, found);
}

describe('the rest countdown', () => {
  // Scoped here so it runs before `jest.setup.ts`'s root-level store reset,
  // which would otherwise land on a mounted subscriber.
  afterEach(cleanup);

  beforeEach(() => {
    mockState = { kind: 'session', session: buildSession() };
  });

  it('is absent from the shell until a rest is actually running', async () => {
    renderScreen();
    // The slot's seed read is asynchronous; letting it land before the
    // assertions keeps its state update inside `act()`.
    await screen.findByTestId('set-entry-row');

    // `ui-conventions`' absent-not-gated: it costs no layout on every other
    // frame of the session.
    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
  });

  it('mounts above the body, so the composer below it cannot move', async () => {
    renderScreen();
    // The slot's seed read is asynchronous; letting it land before the
    // assertions keeps its state update inside `act()`.
    await screen.findByTestId('set-entry-row');

    act(() => {
      useRestTimerStore.getState().startRest(90, { nowMs: Date.now() });
    });

    expect(screen.getByTestId('rest-timer-bar')).toBeTruthy();
    // The ORDER is the acceptance criterion, not merely the presence: the
    // bar must be a sibling ahead of `logger-body`, because everything from
    // the body down is bottom-pinned to `set-entry`'s 205px composer. A bar
    // that drifted below the body would lift the confirm control off its
    // one screen coordinate, forty times a session.
    const order = testIdsInOrder(screen.toJSON());
    expect(order).toContain('rest-timer-bar');
    expect(order.indexOf('rest-timer-bar')).toBeLessThan(order.indexOf('logger-body'));
  });

  it('ends the rest in full idle when skipped, so nothing alerts', async () => {
    renderScreen();
    // The slot's seed read is asynchronous; letting it land before the
    // assertions keeps its state update inside `act()`.
    await screen.findByTestId('set-entry-row');

    act(() => {
      useRestTimerStore.getState().startRest(90, { nowMs: Date.now() });
    });
    fireEvent.press(screen.getByLabelText(REST_TIMER_COPY.skipAction));

    expect(useRestTimerStore.getState().startedAtMs).toBeNull();
    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
    // The session is untouched — skipping a rest is not leaving a workout.
    expect(screen.getByTestId('exercise-pager')).toBeTruthy();
  });
});
