import { ToastProvider } from '@coachos/ui';
import { act, cleanup, render, screen } from '@testing-library/react-native';

import {
  buildBlock,
  buildExercise,
  buildSession as buildUpcomingSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LoggerSession, LoggerSessionState } from '../../hooks/useLoggerSession.ts';
import { useRestTimerStore } from '../../store/rest-timer-store.ts';
import { SessionLoggerScreen } from '../SessionLoggerScreen.tsx';

// `rest-timer/05`'s containment criterion, and the only honest way to hold
// it is to count renders.
//
// The bar re-renders once a second for as long as a rest runs — forty rests
// a session, ninety renders each. `SessionElapsed` already made this
// argument for the session clock on this same screen: the component that
// ticks must be the only component that ticks, because the exercise pager,
// the rail and the set rows are under a client's thumb mid-set and
// `CLAUDE.md` §19 budgets them ≥55fps.
//
// Two things are proved here, and the second is the one that would go
// wrong silently: that the store's TICK does not reach the pager, and that
// the bar's own MOUNT and UNMOUNT do not either. The bar is mounted as a
// sibling above the body and subscribes to the store itself, so
// `SessionLoggerScreen` never reads the store and never re-renders for it.

const mockPagerRender = jest.fn();

// Stands in for the pager AND everything inside it — the exercise rail, the
// target line, the set rows and the composer all mount through `renderPage`,
// which this never calls. It renders nothing: what is being counted is how
// often this function runs, not what it draws.
jest.mock('../ExercisePager.tsx', () => ({
  ExercisePager: () => {
    mockPagerRender();
    return null;
  },
}));

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The screen reads the display unit for `usePRCelebration`
// (`personal-records/03`) and hands it down, rather than every surface that
// prints a weight reading it again. That is one TanStack Query subscription
// to `me.get` — stable once loaded, so it cannot tick — but it needs a tRPC
// provider, and this file deliberately mounts the screen without one.
jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

jest.mock('../../hooks/useSessionHeartbeat.ts', () => ({ useSessionHeartbeat: () => undefined }));
jest.mock('../../hooks/useSessionKeepAwake.ts', () => ({ useSessionKeepAwake: () => undefined }));
jest.mock('../../hooks/useCompleteSession.ts', () => ({
  useCompleteSession: () => ({ complete: jest.fn() }),
}));

let mockState: LoggerSessionState = { kind: 'loading' };
jest.mock('../../hooks/useLoggerSession.ts', () => ({
  useLoggerSession: () => ({ state: mockState, retry: jest.fn() }),
}));

const T0 = 1_760_000_000_000;
const STARTED_AT = new Date('2026-08-15T09:00:00.000Z');

const BLOCKS = [buildBlock({ programExerciseId: 'b-1', exerciseId: 'e-1', orderIndex: 1 })];
const PAYLOAD: LocalSessionPayload = {
  session: buildUpcomingSession({ exercises: BLOCKS }),
  exercises: [buildExercise({ id: 'e-1', name: 'Barbell bench press' })],
};

const SESSION: LoggerSession = {
  localId: 'local-1',
  serverId: 'session-1',
  name: 'Upper A',
  status: 'in_progress',
  isInProgress: true,
  startedAt: STARTED_AT,
  exerciseCount: 1,
  targetSets: 4,
  setsLogged: 3,
  payload: PAYLOAD,
};

describe('the rest countdown is contained to its own component', () => {
  // Before `jest.setup.ts`'s root-level store reset, so it never lands on a
  // mounted tree.
  afterEach(cleanup);

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = { kind: 'session', session: SESSION };
  });

  it('never re-renders the pager, the rail or the set rows — not on a tick, not on the bar appearing', () => {
    render(
      <ToastProvider>
        <SessionLoggerScreen
          sessionLocalId="local-1"
          onExit={jest.fn()}
          onCompleted={jest.fn()}
          now={STARTED_AT}
        />
      </ToastProvider>,
    );

    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
    const beforeRest = mockPagerRender.mock.calls.length;

    act(() => {
      useRestTimerStore.getState().startRest(90, { nowMs: T0 });
    });

    // The bar is on screen and reading the store...
    expect(screen.getByTestId('rest-timer-value')).toHaveTextContent('1:30');

    for (const second of [1, 2, 3]) {
      act(() => {
        useRestTimerStore.getState().tick(T0 + second * 1000);
      });
    }

    // ...and has redrawn three times...
    expect(screen.getByTestId('rest-timer-value')).toHaveTextContent('1:27');
    // ...while nothing under the thumb has redrawn once.
    expect(mockPagerRender.mock.calls.length).toBe(beforeRest);

    act(() => {
      useRestTimerStore.getState().stopRest();
    });

    expect(screen.queryByTestId('rest-timer-bar')).toBeNull();
    expect(mockPagerRender.mock.calls.length).toBe(beforeRest);
  });
});
