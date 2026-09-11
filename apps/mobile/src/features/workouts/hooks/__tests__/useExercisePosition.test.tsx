import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getLocalDb } from '../../../../db/client.ts';
import { readLoggerPosition, writeLoggerPosition } from '../../lib/logger-position.ts';
import { useExercisePosition } from '../useExercisePosition.ts';

// `expo-sqlite` has no Jest-side native module, so the hook runs against the
// same fake `lib/outbox` maintains — same mock, same reason, as
// `lib/__tests__/logger-position.test.ts`, which covers the two queries
// underneath. What is tested HERE is the composition the pager actually
// gets: restore on mount, the clamp against a since-shortened session, and
// that a page turn reaches SQLite rather than only React state.
//
// Deliberately not mocked away: the write really lands in the fake's `meta`
// table and is read back through `readLoggerPosition`. `03`'s second
// acceptance criterion is about persistence, and a mocked persister would
// assert that the hook called a function rather than that a killed app
// could find the position again.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// The fake implements INSERT / UPDATE / SELECT and no DELETE, so every test
// takes a fresh session id rather than clearing the table — which is also a
// truer model, since sessions never share a row.
let counter = 0;
function nextSession(): string {
  counter += 1;
  return `local-session-${String(counter)}`;
}

describe('useExercisePosition', () => {
  it('starts at the first exercise for a session this device has never paged', async () => {
    const { result } = renderHook(() => useExercisePosition(nextSession(), 4));

    expect(result.current.index).toBe(0);
    // Let the restore settle so the assertion is not just "before the read".
    await waitFor(() => {
      expect(result.current.index).toBe(0);
    });
  });

  it('restores the persisted position on mount, which is what kill-recovery reads', async () => {
    const session = nextSession();
    await writeLoggerPosition(await getLocalDb(), session, 2);

    const { result } = renderHook(() => useExercisePosition(session, 4));

    await waitFor(() => {
      expect(result.current.index).toBe(2);
    });
  });

  it('writes the new position to SQLite on a page turn, not only to React state', async () => {
    const session = nextSession();
    const { result } = renderHook(() => useExercisePosition(session, 4));

    act(() => {
      result.current.setIndex(3);
    });

    expect(result.current.index).toBe(3);
    await waitFor(async () => {
      await expect(readLoggerPosition(await getLocalDb(), session)).resolves.toBe(3);
    });
  });

  it('lets the client move backwards as freely as forwards', async () => {
    // Non-linear navigation is `03`'s third criterion: nothing about the
    // stored position may assume the session only advances.
    const session = nextSession();
    const { result } = renderHook(() => useExercisePosition(session, 4));

    act(() => {
      result.current.setIndex(3);
    });
    act(() => {
      result.current.setIndex(1);
    });

    expect(result.current.index).toBe(1);
    await waitFor(async () => {
      await expect(readLoggerPosition(await getLocalDb(), session)).resolves.toBe(1);
    });
  });

  it('ends on the last page turn when two land back to back', async () => {
    // The writes are chained and each link reads the LATEST index, so an
    // out-of-order completion cannot resurrect the first turn.
    const session = nextSession();
    const { result } = renderHook(() => useExercisePosition(session, 6));

    act(() => {
      result.current.setIndex(1);
      result.current.setIndex(5);
    });

    expect(result.current.index).toBe(5);
    await waitFor(async () => {
      await expect(readLoggerPosition(await getLocalDb(), session)).resolves.toBe(5);
    });
  });

  it('does not let a slow restore overwrite a turn the client already made', async () => {
    // The restore is async — open the handle, read the row — and a client
    // who swipes before it lands has already chosen. The resolving read
    // must not drag them back, nor persist the index it read.
    const session = nextSession();
    await writeLoggerPosition(await getLocalDb(), session, 1);

    const { result } = renderHook(() => useExercisePosition(session, 6));

    // Synchronously, before the read can resolve.
    act(() => {
      result.current.setIndex(4);
    });

    await waitFor(async () => {
      await expect(readLoggerPosition(await getLocalDb(), session)).resolves.toBe(4);
    });
    expect(result.current.index).toBe(4);
  });

  it('clamps a position past the end of the session instead of storing it', async () => {
    const session = nextSession();
    const { result } = renderHook(() => useExercisePosition(session, 3));

    act(() => {
      result.current.setIndex(9);
    });

    expect(result.current.index).toBe(2);
    await waitFor(async () => {
      await expect(readLoggerPosition(await getLocalDb(), session)).resolves.toBe(2);
    });
  });

  it('restores a position even though the page count is still 0 when the read starts', async () => {
    // The real mount sequence, which every other test in this file skips by
    // passing a constant. `SessionLoggerScreen` renders `loading` first, so
    // `buildExercisePages(null)` is empty and `pages.length` is 0 for the
    // frame this hook's restore effect runs in; the count only becomes 6
    // once the session read lands. The effect's deps are `[sessionLocalId]`
    // alone, so it keeps the 0 it captured forever — and clamping the
    // stored value against it sent every restored position to the first
    // exercise. That is kill-recovery's entire job, lost silently
    // (`session-runtime/06`'s audit).
    const session = nextSession();
    await writeLoggerPosition(await getLocalDb(), session, 3);

    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useExercisePosition(session, count),
      { initialProps: { count: 0 } },
    );

    // Synchronously, before the restore can resolve — the session read
    // landing a frame later is what the pager actually does.
    rerender({ count: 6 });

    await waitFor(() => {
      expect(result.current.index).toBe(3);
    });
  });

  it('clamps a restored position whose exercise the coach has since removed', async () => {
    // Live-reference assignment (`CLAUDE.md` §27): the coach's edit reaches
    // the client immediately, so a stored index can outlive its exercise.
    const session = nextSession();
    await writeLoggerPosition(await getLocalDb(), session, 5);

    const { result } = renderHook(() => useExercisePosition(session, 2));

    await waitFor(() => {
      expect(result.current.index).toBe(1);
    });
  });

  it('keeps two concurrent sessions on their own positions', async () => {
    const a = nextSession();
    const b = nextSession();
    const first = renderHook(() => useExercisePosition(a, 4));
    const second = renderHook(() => useExercisePosition(b, 4));

    act(() => {
      first.result.current.setIndex(1);
    });
    act(() => {
      second.result.current.setIndex(3);
    });

    await waitFor(async () => {
      const db = await getLocalDb();
      await expect(readLoggerPosition(db, a)).resolves.toBe(1);
      await expect(readLoggerPosition(db, b)).resolves.toBe(3);
    });
  });
});
