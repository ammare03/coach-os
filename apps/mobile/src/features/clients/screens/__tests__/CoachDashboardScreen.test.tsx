import { render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { CoachDashboardClient } from '../../hooks/useCoachDashboard.ts';
import { CoachDashboardScreen } from '../CoachDashboardScreen.tsx';

// The hook is the screen's only dependency on the network, so mocking it
// is what lets this suite render the real `FlashList` — the swap from
// `FlatList` is otherwise verified by nothing but the typechecker.
const mockUseCoachDashboard = jest.fn();
jest.mock('../../hooks/useCoachDashboard.ts', () => ({
  useCoachDashboard: () => mockUseCoachDashboard() as unknown,
}));

function client(index: number, overrides: Partial<CoachDashboardClient> = {}) {
  return {
    clientId: `01924f2c-0000-7000-8000-00000000000${index.toString(16)}`,
    name: `Client ${String(index)}`,
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    unreadMessages: 0,
    lastActiveAt: new Date('2026-09-12T08:00:00.000Z'),
    sessionsCompleted7d: 4,
    sessionsScheduled7d: 5,
    unreviewedSessions: 0,
    unreviewedVideos: 0,
    latestWeightKg: 70,
    trainingAdherence: 80,
    nutritionAdherence: 90,
    overallAdherence: 84,
    adherenceColor: 'amber',
    ...overrides,
  } as CoachDashboardClient;
}

function setQuery(state: Record<string, unknown>) {
  mockUseCoachDashboard.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    ...state,
  });
}

// The screen reads `useSafeAreaInsets`, which throws without a provider
// ancestor, and `initialWindowMetrics` resolves to `null` under Jest — the
// same wrapper `WelcomeScreen.test.tsx` uses, for the same reason.
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function renderScreen() {
  const onOpenClient = jest.fn<void, [string]>();
  const onInviteClient = jest.fn();
  rtlRender(
    <SafeAreaProvider initialMetrics={TEST_METRICS}>
      <CoachDashboardScreen onOpenClient={onOpenClient} onInviteClient={onInviteClient} />
    </SafeAreaProvider>,
  );
  return { onOpenClient, onInviteClient };
}

beforeEach(() => {
  mockUseCoachDashboard.mockReset();
});

describe('CoachDashboardScreen', () => {
  it('renders the counters and the client rows through FlashList', () => {
    setQuery({
      data: { needsReview: 7, offTrack: 3, checkinsDue: 5, clients: [client(1), client(2)] },
    });
    renderScreen();

    expect(screen.getByLabelText('Needs review, 7')).toBeTruthy();
    expect(screen.getByLabelText('Off plan, 3')).toBeTruthy();
    expect(screen.getByLabelText('Check-ins due, 5')).toBeTruthy();
    expect(screen.getByText('Client 1')).toBeTruthy();
    expect(screen.getByText('Client 2')).toBeTruthy();
  });

  it('shows a skeleton on a cold first open, not a blank screen', () => {
    setQuery({ isPending: true });
    renderScreen();

    expect(screen.getByLabelText('Loading your clients')).toBeTruthy();
    // Counters are withheld rather than drawn at zero: three confident
    // zeroes while the answer is unknown is a lie, not a loading state.
    expect(screen.queryByLabelText(/Needs review/)).toBeNull();
  });

  it('gives a coach with no clients one next step, never an empty list', () => {
    setQuery({ data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [] } });
    const { onInviteClient } = renderScreen();

    // Exactly once: the header subtitle goes blank rather than repeating
    // the empty state's own title.
    expect(screen.getAllByText('No clients yet')).toHaveLength(1);
    expect(screen.getByTestId('dashboard-empty')).toBeTruthy();
    // The counters still render, at zero — they are the page's structure,
    // and a zero counter is not a red counter (`ui-conventions` §2).
    expect(screen.getByLabelText('Needs review, 0')).toBeTruthy();
    expect(onInviteClient).not.toHaveBeenCalled();
  });

  it('offers a retry rather than a dead end when the read fails', () => {
    setQuery({ isError: true });
    renderScreen();

    expect(screen.getByTestId('dashboard-error')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  // `DESIGN.md` §8 wants a key wherever the adherence graphic repeats. With
  // no rows there is no graphic, and a legend for nothing is noise.
  it('draws the adherence key once there are dots to explain', () => {
    setQuery({ data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [client(1)] } });
    renderScreen();

    // `includeHiddenElements` because the key is deliberately hidden from
    // the accessibility tree — every row already announces its states in
    // words, so a four-item legend would only add a preamble.
    expect(screen.getByTestId('adherence-key', { includeHiddenElements: true })).toBeTruthy();
  });

  it('omits the adherence key when there are no rows', () => {
    setQuery({ data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [] } });
    renderScreen();

    expect(screen.queryByTestId('adherence-key', { includeHiddenElements: true })).toBeNull();
  });
});
