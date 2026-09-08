import { renderHook } from '@testing-library/react-native';

import type { WipeResult } from '../../../../db/wipe.ts';
import { useAuthStore } from '../../store.ts';
import { useSignOut } from '../useSignOut.ts';

// `local-database/03-wipe-on-logout.md`: the real device-mirror wipe and
// query-cache clear are covered by `db/__tests__/wipe.test.ts` and
// `persister.ts`'s own tests. This file's concern is the composition —
// that the voluntary sign-out path calls them in the right order and, per
// this task's acceptance criteria, refuses the whole sign-out (not just the
// file delete) when the wipe reports pending work.

const mockMutateAsync = jest.fn();
const mockInvalidate = jest.fn();
const mockWipeLocalDatabase = jest.fn<Promise<WipeResult>, [{ force?: boolean }?]>();
const mockClearPersistedQueryCache = jest.fn();

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    auth: { signOut: { useMutation: () => ({ mutateAsync: mockMutateAsync }) } },
    useUtils: () => ({ invalidate: mockInvalidate }),
  },
}));

jest.mock('../../token-store.ts', () => ({
  getTokens: jest.fn(async () => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    accessExpiresAt: '2026-01-01T00:00:00.000Z',
  })),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('../../../../db/wipe.ts', () => ({
  wipeLocalDatabase: (...args: [{ force?: boolean }?]) => mockWipeLocalDatabase(...args),
}));

jest.mock('../../../../lib/query/persister.ts', () => ({
  clearPersistedQueryCache: (...args: unknown[]) => mockClearPersistedQueryCache(...args),
}));

beforeEach(() => {
  mockMutateAsync.mockReset().mockResolvedValue(undefined);
  mockInvalidate.mockClear();
  mockWipeLocalDatabase.mockReset().mockResolvedValue({ outcome: 'wiped' });
  mockClearPersistedQueryCache.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'u1',
    role: 'coach',
    isOnboarded: true,
  });
});

describe('useSignOut', () => {
  it('wipes the device mirror and signs out when the outbox is empty', async () => {
    const { result } = renderHook(() => useSignOut());

    const wipeResult = await result.current.signOut();

    expect(wipeResult).toEqual({ outcome: 'wiped' });
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('blocks the entire sign-out when the outbox has pending rows and force is not set', async () => {
    mockWipeLocalDatabase.mockResolvedValue({ outcome: 'blocked', pendingCount: 2 });
    const { result } = renderHook(() => useSignOut());

    const wipeResult = await result.current.signOut();

    expect(wipeResult).toEqual({ outcome: 'blocked', pendingCount: 2 });
    // Nothing else happened: still signed in, session untouched.
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
  });

  it('signs out anyway when force is set, despite pending rows', async () => {
    mockWipeLocalDatabase.mockImplementation(async (options) =>
      options?.force ? { outcome: 'wiped' } : { outcome: 'blocked', pendingCount: 1 },
    );
    const { result } = renderHook(() => useSignOut());

    const wipeResult = await result.current.signOut({ force: true });

    expect(wipeResult).toEqual({ outcome: 'wiped' });
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(mockWipeLocalDatabase).toHaveBeenCalledWith({ force: true });
  });

  // The ordering guarantee DB§13 exists for: nothing observes
  // "unauthenticated" while the wipe is still in flight.
  it('does not flip the store to unauthenticated until the wipe has resolved', async () => {
    let resolveWipe: (value: WipeResult) => void = () => {
      throw new Error('resolveWipe called before assignment');
    };
    mockWipeLocalDatabase.mockReturnValue(
      new Promise<WipeResult>((resolve) => {
        resolveWipe = resolve;
      }),
    );
    const { result } = renderHook(() => useSignOut());

    const signOutPromise = result.current.signOut();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuthStore.getState().status).toBe('authenticated');

    resolveWipe({ outcome: 'wiped' });
    await signOutPromise;

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('clears the persisted query cache before completing sign-out', async () => {
    const { result } = renderHook(() => useSignOut());

    await result.current.signOut();

    expect(mockClearPersistedQueryCache).toHaveBeenCalledTimes(1);
  });

  it('does not clear the persisted query cache when the wipe is blocked', async () => {
    mockWipeLocalDatabase.mockResolvedValue({ outcome: 'blocked', pendingCount: 1 });
    const { result } = renderHook(() => useSignOut());

    await result.current.signOut();

    expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
  });
});
