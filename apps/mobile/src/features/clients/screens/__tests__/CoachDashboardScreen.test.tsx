import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SEARCH_DEBOUNCE_MS } from '../../hooks/useClientListFilters.ts';
import type { CoachDashboardClient } from '../../hooks/useCoachDashboard.ts';
import {
  resetClientListPreferencesForTests,
  useClientListPreferences,
} from '../../store/client-list-preferences.ts';
import { CoachDashboardScreen } from '../CoachDashboardScreen.tsx';

// jest-expo's `Dimensions` fixture reports `fontScale: 2`, which is not a
// device default — it is the same number as its pixel `scale`. Left alone it
// would put `ClientListControls` permanently in its 200%-text reflow
// (`SORT_REFLOW_FONT_SCALE`), so every case below would silently exercise a
// branch no ordinary coach sees. Pinned to 1 here; the reflow itself has its
// own case in `ClientListControls.test.tsx`.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

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
    pausedAt: null,
    archivedAt: null,
    coachSince: null,
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
  // Sort and the filter chips are persisted, so they outlive a case
  // (`store/client-list-preferences.ts`).
  resetClientListPreferencesForTests();
});

/**
 * Which clients are on screen — as a SET, sorted for comparison.
 *
 * Deliberately not an order assertion: FlashList v2 renders from a render
 * stack keyed by `keyExtractor` and positions each row by layout, so the
 * element tree is in recycler order and not in visual order. The ordering
 * itself is asserted where it is defined, in
 * `hooks/__tests__/useClientListFilters.test.ts`.
 */
function renderedIds(): string[] {
  return screen
    .queryAllByTestId(/^client-row-/)
    .map((row) => String(row.props.testID).replace('client-row-', ''))
    .sort();
}

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

// ── coach-dashboard/02 ──────────────────────────────────────────────────

describe('CoachDashboardScreen — sort, search, and filter', () => {
  // Fake timers rather than `waitFor`: the 150ms search debounce and
  // FlashList's own layout commit both settle inside `act` this way, so the
  // suite's output stays clean instead of carrying act(...) warnings from
  // updates that landed after the assertion.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    // FlashList schedules its layout commit on a task of its own. Drained
    // here, inside `act`, so it cannot land in the NEXT case and be reported
    // there as an unwrapped update.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  /** Let the search debounce, and anything it wakes, settle. */
  function settleSearch() {
    act(() => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
  }

  function roster() {
    return [
      client(1, { clientId: 'calm', name: 'Calm Client', overallAdherence: 95 }),
      client(2, {
        clientId: 'waiting',
        name: 'Waiting Client',
        unreviewedVideos: 2,
        overallAdherence: 99,
      }),
      client(3, { clientId: 'struggling', name: 'Struggling Client', overallAdherence: 20 }),
    ];
  }

  function showRoster() {
    setQuery({ data: { needsReview: 2, offTrack: 1, checkinsDue: 4, clients: roster() } });
    return renderScreen();
  }

  it('opens on attention-needed with the whole roster showing', () => {
    showRoster();

    expect(renderedIds()).toEqual(['calm', 'struggling', 'waiting']);
    expect(useClientListPreferences.getState().sort).toBe('attention');
    // Nothing is narrowed, so there is no count line to read.
    expect(screen.queryByTestId('client-list-count')).toBeNull();
  });

  it('re-sorts from the control, and the choice is the one that persists', () => {
    showRoster();

    fireEvent.press(screen.getByLabelText('Name, tab 2 of 3'));

    expect(useClientListPreferences.getState().sort).toBe('name');
    // The screen's one and only read stays one read: nothing here refetches.
    expect(mockUseCoachDashboard).toHaveBeenCalled();
    expect(renderedIds()).toHaveLength(3);
  });

  it('narrows on a case-insensitive substring once typing settles', () => {
    showRoster();

    fireEvent.changeText(screen.getByLabelText('Search clients'), 'STRUG');
    settleSearch();

    expect(renderedIds()).toEqual(['struggling']);
    expect(screen.getByText('1 of 3 clients')).toBeTruthy();
  });

  it('offers a way back rather than a dead end when nothing matches', () => {
    showRoster();

    fireEvent.changeText(screen.getByLabelText('Search clients'), 'zzzz');
    settleSearch();

    expect(screen.getByTestId('dashboard-no-results')).toBeTruthy();
    // Never the "no clients yet" state — this coach has three.
    expect(screen.queryByTestId('dashboard-empty')).toBeNull();

    fireEvent.press(screen.getByText('Clear search and filters'));
    settleSearch();

    expect(renderedIds()).toHaveLength(3);
  });

  it('drills into a counter and back out of it on a second tap', () => {
    showRoster();

    fireEvent.press(screen.getByLabelText('Needs review, 2'));
    expect(renderedIds()).toEqual(['waiting']);

    fireEvent.press(screen.getByLabelText('Needs review, 2'));
    expect(renderedIds()).toHaveLength(3);
  });

  it('narrows to the clients whose dot reads off plan', () => {
    showRoster();

    fireEvent.press(screen.getByLabelText('Off plan, 1'));

    // The fixture's amber default; only a red client is off plan.
    expect(renderedIds()).toEqual([]);
    expect(screen.getByTestId('dashboard-no-results')).toBeTruthy();
  });

  // `v_client_overview` carries no per-client pending-check-in column, so
  // this counter is a stat rather than a filter. It must not draw itself as
  // selected over a list it did not change.
  it('leaves the roster whole when Check-ins due is tapped', () => {
    showRoster();

    fireEvent.press(screen.getByLabelText('Check-ins due, 4'));

    expect(renderedIds()).toHaveLength(3);
  });

  it('keeps the controls off a coach who has no clients to sort', () => {
    setQuery({ data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [] } });
    renderScreen();

    expect(screen.queryByLabelText('Search clients')).toBeNull();
    expect(screen.getByTestId('dashboard-empty')).toBeTruthy();
  });
});

/**
 * `relationship-controls/01` put all four statuses in the payload, which
 * gave this screen two jobs it did not have: summarising a roster that is no
 * longer all-active, and drawing a list that is all-archived.
 */
describe('CoachDashboardScreen \u2014 paused and archived clients', () => {
  function mixedRoster() {
    return [
      client(1, { clientId: 'a1', name: 'Active One' }),
      client(2, { clientId: 'a2', name: 'Active Two' }),
      client(3, {
        clientId: 'p1',
        name: 'Paused One',
        status: 'paused',
        pausedAt: new Date('2026-09-11T09:00:00.000Z'),
      }),
      client(4, { clientId: 'i1', name: 'Invited One', status: 'invited' }),
      client(5, {
        clientId: 'z1',
        name: 'Archived One',
        status: 'archived',
        archivedAt: new Date('2026-09-04T12:00:00.000Z'),
        coachSince: new Date('2025-11-12T12:00:00.000Z'),
      }),
    ];
  }

  function showMixed() {
    setQuery({ data: { needsReview: 1, offTrack: 0, checkinsDue: 0, clients: mixedRoster() } });
    return renderScreen();
  }

  function selectStatus(...statuses: ('active' | 'invited' | 'paused' | 'archived')[]) {
    act(() => {
      for (const status of statuses) {
        useClientListPreferences.getState().toggleStatus(status);
      }
    });
  }

  /**
   * **`CLAUDE.md` \u00a715.5 on the one line a coach reads as their seat count.**
   *
   * The summary was `clients.length - invited` while the payload held two
   * statuses, where it was exact. With four it would report this coach's
   * paused and archived clients as active \u2014 two active clients rendered as
   * four.
   */
  it('counts the roster summary per status, never as \u201cthe rest are active\u201d', () => {
    showMixed();

    expect(screen.getByText('2 active \u00b7 1 paused \u00b7 1 invited')).toBeTruthy();
  });

  it('leaves archived out of the summary entirely rather than reporting it at zero', () => {
    setQuery({
      data: {
        needsReview: 0,
        offTrack: 0,
        checkinsDue: 0,
        clients: [client(1), client(2, { clientId: 'a2' })],
      },
    });
    renderScreen();

    // No "0 archived" on a coach who has never archived anyone \u2014 that is a
    // prompt to do it, not a fact worth stating.
    expect(screen.getByText('2 active')).toBeTruthy();
    expect(screen.queryByText(/archived/i)).toBeNull();
  });

  it('keeps paused clients in the default list and drops archived ones', () => {
    showMixed();

    // A paused client is still this coach's client and the coach decided
    // they would be back; an archived one is on the record rather than on
    // the roster (`useClientListFilters`'s `matchesStatus`).
    expect(renderedIds()).toEqual(['a1', 'a2', 'i1', 'p1']);
  });

  describe('the archived filter', () => {
    it('shows the archived clients, and only them', () => {
      showMixed();
      selectStatus('archived');

      expect(renderedIds()).toEqual(['z1']);
    });

    it('answers the question a coach comes here to ask, above the list', () => {
      showMixed();
      selectStatus('archived');

      // The typed confirmation said this once, under pressure, to someone
      // deciding. This is read calmly by someone checking whether they lost
      // anything (`ArchivedListNote`).
      expect(screen.getByTestId('archived-list-note')).toBeTruthy();
      expect(
        screen.getByLabelText(
          'Archived clients keep everything they logged. They do not count against your plan. Send a new invite to work with someone again.',
        ),
      ).toBeTruthy();
    });

    it('draws no adherence key, because it draws no dots', () => {
      showMixed();
      selectStatus('archived');

      expect(screen.queryByTestId('adherence-key', { includeHiddenElements: true })).toBeNull();
      // The row's own lane is gone with it \u2014 the two must agree.
      expect(screen.queryByText('T', { includeHiddenElements: true })).toBeNull();
    });

    it('drops the per-row chip, which the filter has already said', () => {
      showMixed();
      selectStatus('archived');

      // By testID, not by the word: "Archived" is also the filter chip's
      // own label, and the point of this case is the ROW's chip.
      expect(
        screen.queryByTestId('client-status-chip-archived', { includeHiddenElements: true }),
      ).toBeNull();
      expect(screen.getByText('Archived 4 Sep \u00b7 42 weeks together')).toBeTruthy();
    });

    /**
     * The variant is about the LIST, not the status. The moment a second
     * status shares the list, every row owes the reader its own again.
     */
    it('goes back to the full row treatment as soon as the list is mixed', () => {
      showMixed();
      selectStatus('archived', 'active');

      expect(renderedIds()).toEqual(['a1', 'a2', 'z1']);
      expect(
        screen.getByTestId('client-status-chip-archived', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(screen.getByTestId('adherence-key', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('archived-list-note')).toBeNull();
    });

    it('has its own empty state, not \u201cno clients match\u201d', () => {
      setQuery({
        data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [client(1), client(2)] },
      });
      renderScreen();
      selectStatus('archived');

      // Nothing was narrowed away here \u2014 there is simply nothing to show
      // yet, and answering with "clear your filters" would be answering a
      // question the coach did not ask.
      expect(screen.getByTestId('dashboard-no-archived')).toBeTruthy();
      expect(screen.queryByTestId('dashboard-no-results')).toBeNull();
      expect(screen.getByText('No archived clients')).toBeTruthy();
    });

    it('offers the way back out of a filter with nothing behind it', () => {
      setQuery({
        data: { needsReview: 0, offTrack: 0, checkinsDue: 0, clients: [client(1), client(2)] },
      });
      renderScreen();
      selectStatus('archived');

      fireEvent.press(screen.getByText('Back to your clients'));

      expect(renderedIds()).toEqual([
        '01924f2c-0000-7000-8000-000000000001',
        '01924f2c-0000-7000-8000-000000000002',
      ]);
    });
  });
});
