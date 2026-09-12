import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { QUERY_CACHE_MAX_AGE_MS } from '../../../lib/query/persister.ts';
import {
  CLIENT_DETAIL_STALE_TIME_MS,
  CLIENT_DETAIL_TABS,
  clientDetailKeys,
  useClientIdentity,
  useClientOverview,
  type ClientOverview,
} from '../api.ts';

// §8.3's caching acceptance criteria, asserted against real TanStack Query
// rather than a stubbed hook result:
//
//   - "each tab has its own independent query key"
//   - "switching tabs after each has loaded once shows no spinner"
//
// A fixture that simply returned `{ isPending: false, data }` would pass
// whatever `staleTime` this feature set, including zero — which is the one
// value that makes the second criterion false. Only the network is faked:
// the cache, the staleness clock, and every flag the screen reads are the
// library's own.

let mockFetch: jest.Mock<Promise<ClientOverview>, [{ clientId: string }]>;

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({
      client: {
        coach: {
          clients: { overview: { query: (input: { clientId: string }) => mockFetch(input) } },
        },
      },
    }),
  },
}));

const CLIENT_A = '01924f2c-0000-7000-8000-00000000000a';
const CLIENT_B = '01924f2c-0000-7000-8000-00000000000b';

function makeOverview(clientId: string, name = 'Priya Sharma'): ClientOverview {
  return {
    clientId,
    name,
    status: 'active',
    goal: 'fat_loss',
    avatarAssetId: null,
    coachSince: new Date('2026-03-01T00:00:00.000Z'),
    injuries: [],
    weightTrend: [],
    adherence: {
      sessionsCompleted7d: 4,
      sessionsScheduled7d: 5,
      trainingAdherence: 80,
      nutritionAdherence: 95,
      overallAdherence: 86,
      state: 'on-track',
      trend: [],
    },
    program: null,
    nextCheckin: null,
    pinnedNotes: [],
  };
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function buildClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  mockFetch = jest.fn((input: { clientId: string }) =>
    Promise.resolve(makeOverview(input.clientId)),
  );
});

describe('clientDetailKeys', () => {
  it('gives every tab its own key under one client', () => {
    const keys = CLIENT_DETAIL_TABS.map((tab) => clientDetailKeys.tab(CLIENT_A, tab));

    expect(keys).toEqual([
      ['clients', CLIENT_A, 'overview'],
      ['clients', CLIENT_A, 'training'],
      ['clients', CLIENT_A, 'nutrition'],
      ['clients', CLIENT_A, 'videos'],
      ['clients', CLIENT_A, 'checkins'],
      ['clients', CLIENT_A, 'chat'],
    ]);
    // Independent: no two tabs share an entry, so one tab loading, failing,
    // or being invalidated never touches another.
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
  });

  it('keeps two clients apart at the second level', () => {
    expect(clientDetailKeys.tab(CLIENT_A, 'overview')).not.toEqual(
      clientDetailKeys.tab(CLIENT_B, 'overview'),
    );
  });

  it('nests so a caller can invalidate one tab, one client, or the feature', async () => {
    const client = buildClient();
    client.setQueryData(clientDetailKeys.tab(CLIENT_A, 'overview'), makeOverview(CLIENT_A));
    client.setQueryData(clientDetailKeys.tab(CLIENT_A, 'training'), { items: [] });
    client.setQueryData(clientDetailKeys.tab(CLIENT_B, 'overview'), makeOverview(CLIENT_B));

    await client.invalidateQueries({ queryKey: clientDetailKeys.client(CLIENT_A) });

    const invalidated = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated ?? false;

    expect(invalidated(clientDetailKeys.tab(CLIENT_A, 'overview'))).toBe(true);
    expect(invalidated(clientDetailKeys.tab(CLIENT_A, 'training'))).toBe(true);
    // The narrowest key that is now stale, and no wider (`code-conventions`
    // §5): another client on the same screen stack is untouched.
    expect(invalidated(clientDetailKeys.tab(CLIENT_B, 'overview'))).toBe(false);
  });
});

describe('useClientOverview', () => {
  it('caches per client, so returning to a loaded tab does not refetch', async () => {
    const client = buildClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useClientOverview(CLIENT_A), { wrapper });
    await waitFor(() => {
      expect(first.result.current.data).toBeDefined();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Leaving the tab and coming back: the navigator unmounts nothing, but
    // even a full remount inside the stale window must not spend a request.
    first.unmount();
    const second = renderHook(() => useClientOverview(CLIENT_A), { wrapper });

    // Data on the FIRST render, not after a round trip — this is what
    // "switching tabs shows no spinner" means in the cache.
    expect(second.result.current.isPending).toBe(false);
    expect(second.result.current.data?.clientId).toBe(CLIENT_A);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches a different client rather than reusing the first one’s entry', async () => {
    const client = buildClient();
    const wrapper = wrapperFor(client);

    const a = renderHook(() => useClientOverview(CLIENT_A), { wrapper });
    await waitFor(() => {
      expect(a.result.current.data).toBeDefined();
    });

    const b = renderHook(() => useClientOverview(CLIENT_B), { wrapper });
    await waitFor(() => {
      expect(b.result.current.data).toBeDefined();
    });

    expect(b.result.current.data?.clientId).toBe(CLIENT_B);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('holds the entry for as long as the persister keeps it on disk', async () => {
    const client = buildClient();
    const wrapper = wrapperFor(client);

    const { result } = renderHook(() => useClientOverview(CLIENT_A), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    // A `gcTime` below the persistence window would evict the entry the
    // persister just restored, and the warm-cache guarantee would silently
    // become a cold one.
    const [entry] = client.getQueryCache().findAll({ queryKey: clientDetailKeys.client(CLIENT_A) });
    expect(entry?.gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
    expect(CLIENT_DETAIL_STALE_TIME_MS).toBeGreaterThan(0);
  });
});

describe('useClientIdentity', () => {
  it('reads the same cache entry as the Overview tab, not a second request', async () => {
    const client = buildClient();
    const wrapper = wrapperFor(client);

    const overview = renderHook(() => useClientOverview(CLIENT_A), { wrapper });
    await waitFor(() => {
      expect(overview.result.current.data).toBeDefined();
    });

    const identity = renderHook(() => useClientIdentity(CLIENT_A), { wrapper });

    expect(identity.result.current.data).toEqual({
      name: 'Priya Sharma',
      status: 'active',
      goal: 'fat_loss',
      avatarAssetId: null,
      coachSince: new Date('2026-03-01T00:00:00.000Z'),
    });
    // The header above six tabs costs nothing on the tab that already
    // fetched.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
