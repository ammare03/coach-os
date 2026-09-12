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

function makeOverview(overrides: Partial<ClientOverview> = {}): ClientOverview {
  return {
    clientId: CLIENT_ID,
    name: 'Priya Sharma',
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    coachSince: new Date('2026-03-01T00:00:00.000Z'),
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

beforeEach(() => {
  onBack.mockClear();
  settle(makeOverview());
});

describe('ClientOverviewScreen', () => {
  it('shows a skeleton, not a spinner, on the first load', () => {
    mockOverview = {
      isPending: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    };
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);

    expect(screen.getByLabelText("Loading this client's week")).toBeTruthy();
  });

  it('renders every section §8.3 names, in one pass', () => {
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);

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
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);
    expect(screen.queryByTestId('injuries-banner')).toBeNull();

    settle(
      makeOverview({
        injuries: [{ area: 'left knee', notes: null, since: null, severity: null }],
      }),
    );
    screen.rerender(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);
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
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);

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
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);

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
    render(<ClientOverviewScreen clientId={CLIENT_ID} onBack={onBack} />);

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
