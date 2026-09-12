import { render, screen, fireEvent } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';

import type { SessionHistoryItem } from '../../api.ts';
import { ClientTrainingScreen } from '../ClientTrainingScreen.tsx';

// The four states `ui-conventions` §4 requires, plus the one thing this
// screen has that Overview does not: a second page. `onEndReached` fires
// more than once per arrival at the end of a list, so "fetch the next page"
// and "fetch it once" are two different assertions.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';

interface MockHistory {
  data?: { pages: { items: SessionHistoryItem[]; nextCursor: string | null }[] };
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: jest.Mock;
  refetch: jest.Mock;
}

let mockHistory: MockHistory;

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return { ...actual, useClientTrainingHistory: () => mockHistory };
});

jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

function makeSession(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    sessionId: '01924f2c-0000-7000-8000-00000000001a',
    scheduledDate: '2026-09-08',
    name: 'Upper A',
    status: 'completed',
    skipReason: null,
    durationSeconds: 2880,
    totalVolumeKg: 7240,
    personalRecordCount: 2,
    reviewedAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

function settle(items: SessionHistoryItem[], opts: Partial<MockHistory> = {}): void {
  mockHistory = {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
    ...opts,
  };
}

const onOpenSession = jest.fn();
const onOpenOverview = jest.fn();
const onBack = jest.fn();

function renderScreen() {
  return render(
    <ClientTrainingScreen
      clientId={CLIENT_ID}
      onOpenSession={onOpenSession}
      onOpenOverview={onOpenOverview}
      onBack={onBack}
    />,
  );
}

beforeEach(() => {
  onOpenSession.mockClear();
  onOpenOverview.mockClear();
  onBack.mockClear();
  settle([makeSession()]);
});

describe('ClientTrainingScreen', () => {
  it('shows a skeleton, not a spinner, on the first load', () => {
    mockHistory = {
      isPending: true,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    };
    renderScreen();

    expect(screen.getByLabelText("Loading this client's sessions")).toBeTruthy();
  });

  it('renders every row from the page, with no further round trip', () => {
    settle([
      makeSession({ sessionId: 's1', name: 'Upper A' }),
      makeSession({ sessionId: 's2', name: 'Lower B', scheduledDate: '2026-09-06' }),
    ]);
    renderScreen();

    expect(screen.getByTestId('session-row-s1')).toBeTruthy();
    expect(screen.getByTestId('session-row-s2')).toBeTruthy();
  });

  it('opens session-review with the session’s own id', () => {
    settle([makeSession({ sessionId: 's1' })]);
    renderScreen();

    fireEvent.press(screen.getByTestId('session-row-s1'));

    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('states the fact, and points at the one place the reason lives', () => {
    settle([]);
    renderScreen();

    expect(screen.getByTestId('client-training-empty')).toBeTruthy();
    expect(screen.getByText('No sessions logged yet')).toBeTruthy();

    fireEvent.press(screen.getByText('Open overview'));
    expect(onOpenOverview).toHaveBeenCalled();
  });

  it('offers a retry when the list fails, and says nothing was lost', () => {
    const refetch = jest.fn();
    mockHistory = {
      isPending: false,
      isError: true,
      error: new Error('offline'),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch,
    };
    renderScreen();

    expect(screen.getByTestId('client-training-error')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });

  it('answers a client that is not this coach’s with not-found, never forbidden', () => {
    // ER§2.1: a 403 here would confirm the row exists and turn id-walking
    // into an enumeration oracle.
    mockHistory = {
      isPending: false,
      isError: true,
      error: notYourClientError(),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    };
    renderScreen();

    expect(screen.getByTestId('client-training-not-found')).toBeTruthy();
    fireEvent.press(screen.getByText('Back to clients'));
    expect(onBack).toHaveBeenCalled();
  });

  it('fetches the next page when the end comes into view', () => {
    const fetchNextPage = jest.fn();
    settle([makeSession({ sessionId: 's1' })], { hasNextPage: true, fetchNextPage });
    renderScreen();

    fireEvent(screen.getByTestId('client-training-history'), 'endReached');

    // Not a call COUNT: FlashList fires `onEndReached` itself the moment a
    // short list mounts, which is correct — a page that does not fill the
    // viewport should pull the next one — and it means the count here is
    // the recycler's business, not this screen's. What the screen owns is
    // the guard, and the two tests below assert exactly that.
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('does not fetch the same cursor twice while a page is already in flight', () => {
    const fetchNextPage = jest.fn();
    settle([makeSession({ sessionId: 's1' })], {
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage,
    });
    renderScreen();

    fireEvent(screen.getByTestId('client-training-history'), 'endReached');
    fireEvent(screen.getByTestId('client-training-history'), 'endReached');

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('does not reach for a page that is not there', () => {
    const fetchNextPage = jest.fn();
    settle([makeSession({ sessionId: 's1' })], { hasNextPage: false, fetchNextPage });
    renderScreen();

    fireEvent(screen.getByTestId('client-training-history'), 'endReached');

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('says a page is arriving rather than replacing the rows already on screen', () => {
    settle([makeSession({ sessionId: 's1' })], { hasNextPage: true, isFetchingNextPage: true });
    renderScreen();

    expect(screen.getByTestId('session-row-s1')).toBeTruthy();
    expect(screen.getByText('Loading more')).toBeTruthy();
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
