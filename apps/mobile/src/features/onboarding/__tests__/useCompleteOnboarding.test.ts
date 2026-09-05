import { renderHook } from '@testing-library/react-native';

import { useAuthStore } from '../../auth/store.ts';
import { useCompleteOnboarding } from '../hooks/useCompleteOnboarding.ts';

// `phase-06-onboarding/onboarding-infrastructure/02`. The gate's own
// behaviour is asserted in `src/__tests__/auth-gate.test.tsx`; this file
// covers the half that feeds it — that the store is flipped by the write
// succeeding, and only by that.

const mockMutateAsync = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    me: {
      completeOnboarding: {
        useMutation: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
      },
    },
    useUtils: () => ({ me: { get: { invalidate: mockInvalidate } } }),
  },
}));

beforeEach(() => {
  mockMutateAsync.mockReset().mockResolvedValue({ onboardingCompletedAt: new Date() });
  mockInvalidate.mockClear();
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'u1',
    role: 'coach',
    isOnboarded: false,
  });
});

describe('useCompleteOnboarding', () => {
  it('marks the session onboarded as soon as the mutation resolves', async () => {
    const { result } = renderHook(() => useCompleteOnboarding());

    await result.current.complete();

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isOnboarded).toBe(true);
  });

  // The flip must be visible to the gate before `complete()` resolves to
  // its caller — a flow that awaited it and then navigated would otherwise
  // race the gate it is trying to satisfy.
  it('has already flipped the store by the time complete() resolves', async () => {
    const { result } = renderHook(() => useCompleteOnboarding());

    const settled = result.current.complete().then(() => useAuthStore.getState().isOnboarded);

    await expect(settled).resolves.toBe(true);
  });

  it('leaves the session alone when the write fails', async () => {
    mockMutateAsync.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCompleteOnboarding());

    await expect(result.current.complete()).rejects.toThrow('offline');

    expect(useAuthStore.getState().isOnboarded).toBe(false);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('invalidates the profile that carries the authoritative timestamp', async () => {
    const { result } = renderHook(() => useCompleteOnboarding());

    await result.current.complete();

    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
