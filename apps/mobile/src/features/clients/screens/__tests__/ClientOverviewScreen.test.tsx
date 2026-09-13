import { NOT_FOUND_COPY } from '@coachos/ui';
import { render, screen } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';

import type { ClientOverview } from '../../api.ts';
import { ClientOverviewScreen } from '../ClientOverviewScreen.tsx';

// The four states `ui-conventions` §4 requires of every screen that loads
// data, on the route that needs the fourth one most: `(coach)/client/[id]`
// takes an id, so "this isn't yours to open" is reachable by a stale deep
// link and by a released client, and it must not look like a crash.
//
// `ERRORS.md` ER§2.1 answers that case with NOT_FOUND rather than FORBIDDEN
// — a 403 would confirm the row exists and turn id-walking into an
// enumeration oracle — so the assertion below is deliberately on the
// not-found copy, not on a forbidden state.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';

let mockOverview: {
  data?: ClientOverview;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
};

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return { ...actual, useClientOverview: () => mockOverview };
});

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

// The relationship rows own a real mutation and a real toast; both have
// their own files. This screen's share of the feature is WHERE the block
// goes, and that is all this file asserts about it.
jest.mock('../../hooks/useClientStatus.ts', () => ({
  useClientStatus: () => ({
    pause: jest.fn(),
    resume: jest.fn(),
    archive: jest.fn(),
    release: jest.fn(),
    isPending: false,
  }),
}));

function makeOverview(overrides: Partial<ClientOverview> = {}): ClientOverview {
  return {
    clientId: CLIENT_ID,
    name: 'Priya Sharma',
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    coachSince: new Date('2026-03-01T00:00:00.000Z'),
    pausedAt: null,
    archivedAt: null,
    injuries: [],
    weightTrend: [
      { weekStartISO: '2026-08-03', weightKg: 81 },
      { weekStartISO: '2026-08-10', weightKg: 79.4 },
    ],
    adherence: {
      sessionsCompleted7d: 4,
      sessionsScheduled7d: 5,
      trainingAdherence: 80,
      nutritionAdherence: 95,
      overallAdherence: 86,
      state: 'on-track',
      trend: [{ weekStartISO: '2026-08-03', trainingAdherence: 80 }],
    },
    program: {
      assignmentId: 'a1',
      programId: 'p1',
      name: 'Hypertrophy block B',
      currentWeek: 3,
      durationWeeks: 12,
      startDate: '2026-08-03',
    },
    nextCheckin: {
      checkinId: 'k1',
      periodStart: '2026-09-08',
      periodEnd: '2026-09-14',
      status: 'pending',
    },
    pinnedNotes: [
      {
        noteId: 'n1',
        body: 'Prefers morning sessions.',
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function settle(data: ClientOverview): void {
  mockOverview = { data, isPending: false, isError: false, error: null, refetch: jest.fn() };
}

const onBack = jest.fn();
const onReleased = jest.fn();

beforeEach(() => {
  onBack.mockClear();
  onReleased.mockClear();
  settle(makeOverview());
});

function renderScreen() {
  return render(
    <ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} onReleased={onReleased} />,
  );
}

/**
 * Where a testID sits in the rendered tree. Crude on purpose: the ONE
 * thing this task asks the screen to decide is document order, and every
 * less crude way of asking (a children array, a layout measurement) is
 * either fragile against a wrapper view or unavailable without a device.
 */
function positionOf(testID: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(`"${testID}"`);
}

describe('ClientOverviewScreen', () => {
  it('shows a skeleton, not a spinner, on the first load', () => {
    mockOverview = {
      isPending: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    };
    renderScreen();

    expect(screen.getByLabelText("Loading this client's week")).toBeTruthy();
  });

  it('renders every section §8.3 names, in one pass', () => {
    renderScreen();

    expect(screen.getByTestId('weight-trend')).toBeTruthy();
    expect(screen.getByTestId('adherence-summary')).toBeTruthy();
    expect(screen.getByTestId('current-program')).toBeTruthy();
    expect(screen.getByTestId('next-checkin')).toBeTruthy();
    expect(screen.getByTestId('pinned-notes')).toBeTruthy();
    expect(screen.getByText('Hypertrophy block B')).toBeTruthy();
    expect(screen.getByText('Week 3 of 12')).toBeTruthy();
    expect(screen.getByText('Due 14 Sep')).toBeTruthy();
    expect(screen.getByText('Prefers morning sessions.')).toBeTruthy();
  });

  it('omits the injuries banner unless the client has injuries', () => {
    renderScreen();
    expect(screen.queryByTestId('injuries-banner')).toBeNull();

    settle(
      makeOverview({
        injuries: [{ area: 'left knee', notes: null, since: null, severity: null }],
      }),
    );
    screen.rerender(
      <ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} onReleased={onReleased} />,
    );
    expect(screen.getByTestId('injuries-banner')).toBeTruthy();
  });

  it('states the fact in each section a client has no data for, with no next step invented', () => {
    settle(
      makeOverview({
        weightTrend: [],
        program: null,
        nextCheckin: null,
        pinnedNotes: [],
        adherence: {
          sessionsCompleted7d: 0,
          sessionsScheduled7d: 0,
          trainingAdherence: null,
          nutritionAdherence: null,
          overallAdherence: null,
          state: 'no-data',
          trend: [],
        },
      }),
    );
    renderScreen();

    expect(screen.getByText('No weigh-ins yet')).toBeTruthy();
    expect(screen.getByText('Nothing scheduled yet')).toBeTruthy();
    expect(screen.getByText('No program assigned')).toBeTruthy();
    expect(screen.getByText('None scheduled')).toBeTruthy();
    expect(screen.getByText('Nothing pinned yet')).toBeTruthy();
    // A brand-new client is grey, never red (`DESIGN.md` §10.5).
    expect(screen.getByLabelText('Not started')).toBeTruthy();
  });

  it('offers a retry when the request failed', () => {
    mockOverview = {
      isPending: false,
      isError: true,
      error: new Error('offline'),
      refetch: jest.fn(),
    };
    renderScreen();

    expect(screen.getByTestId('client-overview-error')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('says not found — never forbidden — for a client that is not this coach’s', () => {
    mockOverview = {
      isPending: false,
      isError: true,
      error: notYourClientError(),
      refetch: jest.fn(),
    };
    renderScreen();

    expect(screen.getByTestId('client-overview-not-found')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND_COPY.title)).toBeNull(); // overridden with the client wording
    expect(screen.getByText("We couldn't find that client")).toBeTruthy();
    // The way out is never a dead end, and never depends on a query.
    expect(screen.getByText('Back to clients')).toBeTruthy();
  });
});

/** A `TRPCClientError` shaped the way the error formatter sends one over the wire. */
function notYourClientError(): TRPCClientError<never> {
  const error = new TRPCClientError<never>('not found');
  Object.defineProperty(error, 'data', {
    value: { appCode: 'NOT_YOUR_CLIENT', details: {} },
  });
  return error;
}

describe('where the relationship block goes', () => {
  it('puts it last for an active client, after every piece of evidence', () => {
    renderScreen();

    // The actions come AFTER the reasons: a coach arrives at "pause this
    // client" having just read the week that made them consider it.
    expect(positionOf('pinned-notes')).toBeGreaterThan(-1);
    expect(positionOf('client-status-actions')).toBeGreaterThan(positionOf('pinned-notes'));
  });

  it('puts it first for a paused client, under the injuries banner', () => {
    settle(
      makeOverview({
        status: 'paused',
        injuries: [
          { area: 'Right shoulder', severity: 'moderate', since: 'Jan 2026', notes: null },
        ],
      }),
    );
    renderScreen();

    // Injuries keep their unconditional first slot — `client-detail/01`'s
    // rule, which this task does not get to break.
    expect(positionOf('injuries-banner')).toBeLessThan(positionOf('client-status-actions'));
    expect(positionOf('client-status-actions')).toBeLessThan(positionOf('weight-trend'));
  });

  it('puts it first for an archived client too', () => {
    settle(makeOverview({ status: 'archived' }));
    renderScreen();

    expect(positionOf('client-status-actions')).toBeLessThan(positionOf('weight-trend'));
  });

  it('never moves it once the screen is up', () => {
    const view = renderScreen();
    const before = positionOf('client-status-actions') < positionOf('weight-trend');

    settle(makeOverview({ status: 'paused' }));
    view.rerender(
      <ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} onReleased={onReleased} />,
    );

    // Sliding the card eleven hundred pixels under an open undo window
    // would put Archive where Pause was, mid-gesture.
    expect(positionOf('client-status-actions') < positionOf('weight-trend')).toBe(before);
  });

  it('dims nothing on a paused client', () => {
    settle(makeOverview({ status: 'paused' }));
    renderScreen();

    // The week is reported in full: 82% is still what happened in the seven
    // days before they stopped, and greying it would say otherwise.
    expect(screen.getByText('4 of 5 sessions · nutrition 95%')).toBeTruthy();
    // No card on this screen carries an opacity — the only `opacity` the
    // feature owns is the inert row's, and no row is inert here.
    expect(JSON.stringify(screen.toJSON())).not.toContain('"opacity"');
  });
});
