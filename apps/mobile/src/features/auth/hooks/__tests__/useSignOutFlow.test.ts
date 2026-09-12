import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { WipeResult } from '../../../../db/wipe.ts';
import { useSignOutFlow } from '../useSignOutFlow.ts';

// `account-actions/01`: `useSignOut` and its wipe ordering are already
// covered by `useSignOut.test.ts` and `db/__tests__/wipe.test.ts`. What is
// untested until here is the BRANCH — which of the three `WipeResult`
// outcomes opens the prompt, which reports, and which does neither.

const mockSignOut = jest.fn<Promise<WipeResult>, [{ force?: boolean }?]>();
const mockCaptureLocalWipeFailure = jest.fn();

jest.mock('../useSignOut.ts', () => ({
  useSignOut: () => ({
    signOut: (...args: [{ force?: boolean }?]) => mockSignOut(...args),
    isSigningOut: false,
  }),
}));

jest.mock('../../../../lib/sentry.ts', () => ({
  captureLocalWipeFailure: (...args: unknown[]) => mockCaptureLocalWipeFailure(...args),
}));

beforeEach(() => {
  mockSignOut.mockReset().mockResolvedValue({ outcome: 'wiped' });
  mockCaptureLocalWipeFailure.mockReset();
});

describe('useSignOutFlow — wiped', () => {
  it('signs out with no prompt and nothing reported', async () => {
    const { result } = renderHook(() => useSignOutFlow());

    await act(async () => {
      result.current.requestSignOut();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(result.current.pendingCount).toBeNull();
    expect(mockCaptureLocalWipeFailure).not.toHaveBeenCalled();
  });
});

describe('useSignOutFlow — blocked', () => {
  beforeEach(() => {
    mockSignOut.mockImplementation(async (options) =>
      options?.force === true ? { outcome: 'wiped' } : { outcome: 'blocked', pendingCount: 3 },
    );
  });

  it('opens the prompt with the count the wipe reported', async () => {
    const { result } = renderHook(() => useSignOutFlow());

    await act(async () => {
      result.current.requestSignOut();
    });

    await waitFor(() => expect(result.current.pendingCount).toBe(3));
  });

  it('keeps the user signed in and queues no second attempt', async () => {
    const { result } = renderHook(() => useSignOutFlow());
    await act(async () => {
      result.current.requestSignOut();
    });

    act(() => {
      result.current.keepSignedIn();
    });

    expect(result.current.pendingCount).toBeNull();
    // Approach step 3 — closing the prompt does nothing else. P08's
    // connectivity listener flushes the outbox; this hook builds no
    // second flusher and starts no retry.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('retries with force, and only with force, when discard is chosen', async () => {
    const { result } = renderHook(() => useSignOutFlow());
    await act(async () => {
      result.current.requestSignOut();
    });

    await act(async () => {
      result.current.discardAndSignOut();
    });

    expect(mockSignOut).toHaveBeenNthCalledWith(1);
    expect(mockSignOut).toHaveBeenNthCalledWith(2, { force: true });
    await waitFor(() => expect(result.current.pendingCount).toBeNull());
  });
});

describe('useSignOutFlow — failed', () => {
  const dbError = new Error('unable to delete database file for priya@example.com');

  beforeEach(() => {
    mockSignOut.mockResolvedValue({ outcome: 'failed', error: dbError });
  });

  it('proceeds rather than trapping the user, and never prompts', async () => {
    const { result } = renderHook(() => useSignOutFlow());

    await act(async () => {
      result.current.requestSignOut();
    });

    // `useSignOut`'s own rule: a `failed` wipe still signs out. Nothing
    // here second-guesses that — there is simply no prompt to show.
    expect(result.current.pendingCount).toBeNull();
  });

  it('reports the failure with a class name and nothing else', async () => {
    const { result } = renderHook(() => useSignOutFlow());

    await act(async () => {
      result.current.requestSignOut();
    });

    expect(mockCaptureLocalWipeFailure).toHaveBeenCalledTimes(1);
    expect(mockCaptureLocalWipeFailure).toHaveBeenCalledWith('Error');
    // `security-and-privacy` §5 — a raw database error message can carry
    // row values, so the message never leaves this device.
    expect(JSON.stringify(mockCaptureLocalWipeFailure.mock.calls)).not.toContain('priya');
  });

  it('describes a thrown non-Error by its type rather than its contents', async () => {
    mockSignOut.mockResolvedValue({ outcome: 'failed', error: 'priya@example.com not found' });
    const { result } = renderHook(() => useSignOutFlow());

    await act(async () => {
      result.current.requestSignOut();
    });

    expect(mockCaptureLocalWipeFailure).toHaveBeenCalledWith('string');
  });
});

describe('useSignOutFlow — one attempt at a time', () => {
  it('ignores a second tap while the first is still in flight', async () => {
    let resolveWipe: (value: WipeResult) => void = () => {
      throw new Error('resolveWipe called before assignment');
    };
    mockSignOut.mockReturnValue(
      new Promise<WipeResult>((resolve) => {
        resolveWipe = resolve;
      }),
    );
    const { result } = renderHook(() => useSignOutFlow());

    act(() => {
      result.current.requestSignOut();
      result.current.requestSignOut();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWipe({ outcome: 'wiped' });
    });
  });
});
