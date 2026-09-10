import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { TodaySessionState } from '../../hooks/useTodaySession.ts';
import { TodayScreen } from '../TodayScreen.tsx';

// `phase-09-workout-logger/today-card/04` part (c): the screen actually
// supplies the ad-hoc handler, and a press ends where the design says it
// ends — in the logger, at the local id (`DESIGN-SPEC.md` §3.9). Tasks `01`
// and `03` left all three buttons wired to a prop nothing passed, so
// "renders" and "calls something" are not the same assertion here.
//
// The screen is real; only its data is stood in for, the same split
// `ClientTabBar.test.tsx` makes and for the same reason — the local SQLite
// read is asynchronous and has nothing to do with what is being proved.

const mockStartAdHoc = jest.fn();
let mockState: TodaySessionState = { kind: 'no-program', hasCoach: true };
const mockRetry = jest.fn();

jest.mock('../../../../lib/trpc.ts', () => ({
  api: { me: { get: { useQuery: () => ({ data: undefined }) } } },
}));

jest.mock('../../hooks/useTodaySession.ts', () => ({
  useTodaySession: () => ({
    state: mockState,
    header: {
      dateLabel: 'Saturday, 15 Aug',
      date: '2026-08-15',
      programName: null,
      weekNumber: null,
      totalWeeks: null,
      coachFirstName: null,
    },
    timeZone: 'Asia/Kolkata',
    retry: mockRetry,
  }),
}));

jest.mock('../../hooks/useStartAdHocSession.ts', () => ({
  useStartAdHocSession: jest.fn(() => ({ startAdHoc: mockStartAdHoc })),
}));

const { useStartAdHocSession } = jest.requireMock('../../hooks/useStartAdHocSession.ts') as {
  useStartAdHocSession: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStartAdHoc.mockResolvedValue({
    localId: 'local-9',
    outboxId: 'outbox-9',
    startedAt: new Date(),
  });
});

function renderScreen() {
  const onOpenSession = jest.fn();
  render(
    <TodayScreen
      onOpenSession={onOpenSession}
      onViewSummary={jest.fn()}
      onOpenSettings={jest.fn()}
    />,
  );
  return { onOpenSession };
}

const COMPLETED: TodaySessionState = {
  kind: 'session',
  session: {
    localId: 'local-1',
    serverId: 'session-1',
    name: 'Upper A',
    exerciseCount: 6,
    targetSets: 22,
    estimatedMinutes: 55,
    previewExerciseNames: [],
    remainingExerciseCount: 0,
  },
  phase: {
    phase: 'completed',
    completedAt: new Date('2026-08-15T12:42:00.000Z'),
    setsLogged: 22,
    volumeKg: 12450,
    durationSeconds: 3480,
  },
};

const ENTRY_POINTS: [string, TodaySessionState, string][] = [
  ['no program (frame E)', { kind: 'no-program', hasCoach: true }, 'Log a workout anyway'],
  ['rest day (frame D)', { kind: 'rest-day', isRestDay: true }, 'Log something anyway'],
  ['a session already finished today (frame C)', COMPLETED, 'Log another workout'],
];

describe('the ad-hoc entry points', () => {
  it.each(ENTRY_POINTS)('renders and fires the handler from %s', async (_label, given, label) => {
    mockState = given;
    const { onOpenSession } = renderScreen();

    fireEvent.press(screen.getByRole('button', { name: label }));

    expect(mockStartAdHoc).toHaveBeenCalledTimes(1);
    // The logger opens at the LOCAL id — a session started offline has no
    // server id, and the local key is the one that always exists.
    await waitFor(() => {
      expect(onOpenSession).toHaveBeenCalledWith('local-9');
    });
  });

  it("resolves the day in the client's own zone, not a second one of its own", () => {
    mockState = { kind: 'rest-day', isRestDay: true };
    renderScreen();

    // The row this writes has to land on the same calendar day the card is
    // showing (`CLAUDE.md` §25.5), so the zone comes from `useTodaySession`.
    expect(useStartAdHocSession).toHaveBeenCalledWith({ timeZone: 'Asia/Kolkata' });
  });

  it('re-runs the local read instead of navigating when the device could not record it', async () => {
    // `startAdHoc` only answers null when the device's own SQLite mirror
    // refused to write — the same handle the card's read uses, so the
    // honest next step is that read, which either recovers or lands in
    // §3.7's section error (`ERRORS.md` ER§1.4 `LOCAL_READ_FAILED`).
    mockStartAdHoc.mockResolvedValue(null);
    mockState = { kind: 'no-program', hasCoach: true };
    const { onOpenSession } = renderScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Log a workout anyway' }));

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalled();
    });
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});
