import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { trackEvent } from '../../../../lib/analytics/index.ts';
import { QUERY_CACHE_MAX_AGE_MS } from '../../../../lib/query/persister.ts';
import {
  COACH_DASHBOARD_QUERY_KEY,
  COACH_DASHBOARD_STALE_TIME_MS,
  useCoachDashboard,
  type CoachDashboard,
} from '../useCoachDashboard.ts';

// `coach-dashboard/03`. The three cases §8.2 and §19 actually distinguish —
// warm cache, cold first launch, explicit pull-to-refresh — asserted against
// real TanStack Query, not against a stubbed hook result. A fixture that
// simply returns `{ isPending: false, data }` would pass whatever `staleTime`
// this hook set, including zero, which is the one value the task's Risks
// section rules out.
//
// Only the network is faked: `api.coach.dashboard.useQuery` below forwards
// its options into a genuine `useQuery` on the same key, so the cache, the
// staleness clock, the background refetch, and every flag the screen reads
// are the library's own.

const mockDashboardKey = ['coach', 'dashboard'] as const;
let mockFetch: jest.Mock<Promise<CoachDashboard>, []>;

jest.mock('../../../../lib/trpc.ts', () => {
  const reactQuery = jest.requireActual('@tanstack/react-query') as {
    useQuery: (options: Record<string, unknown>) => unknown;
  };
  return {
    api: {
      coach: {
        dashboard: {
          useQuery: (_input: undefined, options: Record<string, unknown>) =>
            reactQuery.useQuery({
              queryKey: mockDashboardKey,
              queryFn: () => mockFetch(),
              ...options,
            }),
        },
      },
    },
  };
});

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: jest.fn(),
}));

const mockTrackEvent = jest.mocked(trackEvent);

function buildClient(clientId: string): CoachDashboard['clients'][number] {
  return {
    clientId,
    name: 'A Client',
    status: 'active',
    goal: null,
    avatarAssetId: null,
    unreadMessages: 0,
    lastActiveAt: null,
    sessionsCompleted7d: 2,
    sessionsScheduled7d: 4,
    unreviewedSessions: 1,
    unreviewedVideos: 0,
    latestWeightKg: null,
    trainingAdherence: 0.5,
    nutritionAdherence: null,
    overallAdherence: 50,
    adherenceColor: 'amber',
  };
}

const CACHED: CoachDashboard = {
  needsReview: 3,
  offTrack: 1,
  checkinsDue: 2,
  clients: [buildClient('c-1'), buildClient('c-2')],
};

const FRESH: CoachDashboard = {
  needsReview: 7,
  offTrack: 0,
  checkinsDue: 0,
  clients: [buildClient('c-1'), buildClient('c-2'), buildClient('c-3')],
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * Deliberately bare: no `staleTime` and no `gcTime`. Anything this suite
 * observes about staleness or retention therefore comes from the hook's own
 * options, not from a default the test supplied to itself.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Renders the hook and records every render's state flags, in order. */
function renderDashboard() {
  const renders: { isPending: boolean; isRefetching: boolean; hasData: boolean }[] = [];
  const rendered = renderHook(
    () => {
      const dashboard = useCoachDashboard();
      renders.push({
        isPending: dashboard.isPending,
        isRefetching: dashboard.isRefetching,
        hasData: dashboard.data !== undefined,
      });
      return dashboard;
    },
    { wrapper },
  );
  return { ...rendered, renders };
}

beforeEach(() => {
  queryClient = createQueryClient();
  mockFetch = jest.fn<Promise<CoachDashboard>, []>().mockResolvedValue(FRESH);
  mockTrackEvent.mockClear();
});

afterEach(() => {
  queryClient.clear();
});

describe('useCoachDashboard — warm cache', () => {
  it('paints restored data with no loading state on the very first render', () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED);

    const { result, renders } = renderDashboard();

    expect(renders[0]).toEqual({ isPending: false, isRefetching: false, hasData: true });
    expect(result.current.data).toEqual(CACHED);
  });

  it('does not go to the network for a cache that is still inside staleTime', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED, {
      updatedAt: Date.now() - Math.floor(COACH_DASHBOARD_STALE_TIME_MS / 2),
    });

    renderDashboard();
    await act(async () => {
      await Promise.resolve();
    });

    // The assertion that pins `staleTime` off zero: at zero, mounting a
    // cached dashboard refetches every single time (the task's Risks section).
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('revalidates a stale cache in the background without ever showing a loading or refresh state', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED, {
      updatedAt: Date.now() - COACH_DASHBOARD_STALE_TIME_MS - 1,
    });

    const { result, renders } = renderDashboard();

    expect(result.current.data).toEqual(CACHED);
    await waitFor(() => {
      expect(result.current.data).toEqual(FRESH);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // A background revalidation must not drive the screen's `RefreshControl`
    // — the coach did not ask for it, so nothing may spin.
    expect(renders.every((render) => !render.isPending && !render.isRefetching)).toBe(true);
  });

  it('keeps the cached copy on screen when the background revalidation fails', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED, {
      updatedAt: Date.now() - COACH_DASHBOARD_STALE_TIME_MS - 1,
    });
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderDashboard();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toEqual(CACHED);
  });
});

describe('useCoachDashboard — cold first launch', () => {
  it('reports a real loading state, then the fetched data', async () => {
    const { result, renders } = renderDashboard();

    expect(renders[0]).toEqual({ isPending: true, isRefetching: false, hasData: false });

    await waitFor(() => {
      expect(result.current.data).toEqual(FRESH);
    });
    expect(result.current.isPending).toBe(false);
  });

  it('surfaces an error rather than an empty success when the first-ever fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderDashboard();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useCoachDashboard — pull to refresh', () => {
  it('drives isRefetching, never isPending, and holds the cached rows while it runs', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED);
    const { result } = renderDashboard();

    let release: (value: CoachDashboard) => void = () => undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise<CoachDashboard>((resolve) => {
          release = resolve;
        }),
    );

    act(() => {
      void result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isRefetching).toBe(true);
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(CACHED);

    await act(async () => {
      release(FRESH);
    });

    await waitFor(() => {
      expect(result.current.isRefetching).toBe(false);
    });
    expect(result.current.data).toEqual(FRESH);
  });

  it('clears isRefetching when the refresh fails', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED);
    const { result } = renderDashboard();

    mockFetch.mockRejectedValue(new Error('offline'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isRefetching).toBe(false);
    expect(result.current.data).toEqual(CACHED);
  });
});

describe('useCoachDashboard — retention', () => {
  it('holds the entry for the whole persistence window, so a restore is not evicted under it', () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED);

    renderDashboard();

    const entry = queryClient.getQueryCache().find({ queryKey: COACH_DASHBOARD_QUERY_KEY });

    expect(entry?.gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
  });
});

describe('useCoachDashboard — dashboard_viewed', () => {
  it('reports a warm open as from_cache, once, with the roster it painted', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED, {
      updatedAt: Date.now() - 5_000,
    });

    renderDashboard();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('dashboard_viewed', {
      client_count: CACHED.clients.length,
      needs_attention_count: CACHED.needsReview,
      load_ms: expect.any(Number),
      from_cache: true,
    });
  });

  it('reports a cold open as a network load', async () => {
    const { result } = renderDashboard();

    await waitFor(() => {
      expect(result.current.data).toEqual(FRESH);
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'dashboard_viewed',
      expect.objectContaining({ from_cache: false, client_count: FRESH.clients.length }),
    );
  });

  it('does not fire again when the coach pulls to refresh', async () => {
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, CACHED, {
      updatedAt: Date.now() - 5_000,
    });
    const { result } = renderDashboard();

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('never fires while the first-ever open is still loading', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderDashboard();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});
