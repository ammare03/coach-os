import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { FailedOutboxSummary } from '../../../lib/outbox/failed-entries.ts';
import { useSyncFailures } from '../useSyncFailures.ts';

jest.mock('../../../lib/outbox/failed-entries.ts', () => ({
  readFailedOutboxEntries: jest.fn(),
  retryFailedOutboxEntries: jest.fn(),
}));

const outbox = jest.requireMock('../../../lib/outbox/failed-entries.ts') as {
  readFailedOutboxEntries: jest.Mock;
  retryFailedOutboxEntries: jest.Mock;
};

const EMPTY: FailedOutboxSummary = { totalCount: 0, groups: [] };
const STUCK: FailedOutboxSummary = {
  totalCount: 1,
  groups: [{ procedure: 'workouts.logSet', label: 'Logged sets', count: 1, lastQueuedAt: 1_000 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  outbox.readFailedOutboxEntries.mockResolvedValue(EMPTY);
  outbox.retryFailedOutboxEntries.mockResolvedValue(0);
});

describe('useSyncFailures', () => {
  it('starts empty, so a banner never flashes before the outbox has been read', async () => {
    const { result } = renderHook(() => useSyncFailures());

    expect(result.current.summary).toEqual(EMPTY);
    await waitFor(() => expect(outbox.readFailedOutboxEntries).toHaveBeenCalled());
  });

  it('reports what is stuck once the outbox has been read', async () => {
    outbox.readFailedOutboxEntries.mockResolvedValue(STUCK);

    const { result } = renderHook(() => useSyncFailures());

    await waitFor(() => expect(result.current.summary.totalCount).toBe(1));
  });

  it('re-reads on demand, which is how a screen refreshes on foreground', async () => {
    const { result } = renderHook(() => useSyncFailures());
    await waitFor(() => expect(result.current.summary).toEqual(EMPTY));

    outbox.readFailedOutboxEntries.mockResolvedValue(STUCK);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.summary.totalCount).toBe(1);
  });

  it('retries through the outbox and re-reads what is left', async () => {
    outbox.readFailedOutboxEntries.mockResolvedValue(STUCK);
    const { result } = renderHook(() => useSyncFailures());
    await waitFor(() => expect(result.current.summary.totalCount).toBe(1));

    outbox.retryFailedOutboxEntries.mockImplementation(async () => {
      outbox.readFailedOutboxEntries.mockResolvedValue(EMPTY);
      return 1;
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(outbox.retryFailedOutboxEntries).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toEqual(EMPTY);
    expect(result.current.isRetrying).toBe(false);
  });

  it('clears the in-flight flag even when the retry itself throws', async () => {
    const { result } = renderHook(() => useSyncFailures());
    await waitFor(() => expect(outbox.readFailedOutboxEntries).toHaveBeenCalled());
    outbox.retryFailedOutboxEntries.mockRejectedValue(new Error('storage gone'));

    // A stuck spinner would leave the one recovery the client has looking
    // permanently unavailable.
    await act(async () => {
      await expect(result.current.retry()).rejects.toThrow('storage gone');
    });

    expect(result.current.isRetrying).toBe(false);
  });
});
