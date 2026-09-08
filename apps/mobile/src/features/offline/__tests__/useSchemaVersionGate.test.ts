import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { SchemaVersionCheckResult } from '../../../db/schema-version.ts';
import { useSchemaVersionGate } from '../useSchemaVersionGate.ts';

// The composition under test: which `checkSchemaVersion()` outcome maps to
// which `phase`, and that confirming calls `confirmSchemaVersionReset()`
// and shows a busy state until it resolves. The check's own SQL and the
// wipe itself are covered by `db/__tests__/schema-version.test.ts`.

const mockCheckSchemaVersion = jest.fn<Promise<SchemaVersionCheckResult>, []>();
const mockConfirmSchemaVersionReset = jest.fn<Promise<void>, []>();

jest.mock('../../../db/schema-version.ts', () => ({
  checkSchemaVersion: () => mockCheckSchemaVersion(),
  confirmSchemaVersionReset: () => mockConfirmSchemaVersionReset(),
}));

beforeEach(() => {
  mockCheckSchemaVersion.mockReset();
  mockConfirmSchemaVersionReset.mockReset().mockResolvedValue(undefined);
});

describe('useSchemaVersionGate', () => {
  it('starts in the checking phase', () => {
    mockCheckSchemaVersion.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSchemaVersionGate());

    expect(result.current.phase).toBe('checking');
  });

  it('moves straight to ready when the check resolves ok', async () => {
    mockCheckSchemaVersion.mockResolvedValue({ status: 'ok' });

    const { result } = renderHook(() => useSchemaVersionGate());

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.counts).toBeNull();
  });

  it('surfaces the counts and holds at confirm-required when confirmation is needed', async () => {
    mockCheckSchemaVersion.mockResolvedValue({
      status: 'confirm-required',
      counts: [{ procedure: 'workouts.logSet', label: 'Logged sets', count: 2 }],
    });

    const { result } = renderHook(() => useSchemaVersionGate());

    await waitFor(() => expect(result.current.phase).toBe('confirm-required'));
    expect(result.current.counts).toEqual([
      { procedure: 'workouts.logSet', label: 'Logged sets', count: 2 },
    ]);
    expect(mockConfirmSchemaVersionReset).not.toHaveBeenCalled();
  });

  it('holds confirm-required with null counts when the outbox could not be read', async () => {
    mockCheckSchemaVersion.mockResolvedValue({ status: 'confirm-required', counts: null });

    const { result } = renderHook(() => useSchemaVersionGate());

    await waitFor(() => expect(result.current.phase).toBe('confirm-required'));
    expect(result.current.counts).toBeNull();
  });

  it('shows a busy state while confirming and moves to ready once the reset resolves', async () => {
    mockCheckSchemaVersion.mockResolvedValue({ status: 'confirm-required', counts: null });
    let resolveReset: () => void = () => {
      throw new Error('resolveReset called before assignment');
    };
    mockConfirmSchemaVersionReset.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReset = resolve;
      }),
    );
    const { result } = renderHook(() => useSchemaVersionGate());
    await waitFor(() => expect(result.current.phase).toBe('confirm-required'));

    act(() => {
      result.current.confirm();
    });

    expect(result.current.isClearing).toBe(true);
    expect(result.current.phase).toBe('confirm-required');

    await act(async () => {
      resolveReset();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });

  it('resets the busy state instead of silently marking ready when the reset itself fails', async () => {
    // A failed wipe (native storage failure) is not the expected path this
    // dialog exists for — it is an unexpected error, and `code-conventions`
    // §8 forbids swallowing it silently. The hook re-throws it (asserted by
    // the rejection below); what matters for this test is that the busy
    // state clears rather than hanging, and the phase is NOT advanced to
    // `'ready'` on a reset that didn't actually happen — so a retry is
    // still possible.
    mockCheckSchemaVersion.mockResolvedValue({ status: 'confirm-required', counts: null });
    const failure = new Error('native module unavailable');
    mockConfirmSchemaVersionReset.mockRejectedValue(failure);
    const { result } = renderHook(() => useSchemaVersionGate());
    await waitFor(() => expect(result.current.phase).toBe('confirm-required'));

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.confirm();
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBe(failure);
    expect(result.current.isClearing).toBe(false);
    expect(result.current.phase).toBe('confirm-required');
  });
});
