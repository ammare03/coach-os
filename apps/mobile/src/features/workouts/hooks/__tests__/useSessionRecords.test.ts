import { act, renderHook, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import {
  publishOutboxResult,
  resetOutboxResultListenersForTests,
  type OutboxSendResult,
} from '../../../../lib/outbox/results.ts';
import {
  resetSessionRecordsForTests,
  selectSessionRecords,
  useSessionRecordsStore,
} from '../../store/session-records-store.ts';
import {
  SESSION_RECORDS_META_KEY,
  parseStoredRecords,
  resetSessionRecordsPersistenceForTests,
  restoreSessionRecords,
  useSessionRecords,
} from '../useSessionRecords.ts';

// `phase-09-workout-logger/session-summary/01`. The summary lists EVERY
// record from the session, and three things have to be true for that: the
// ledger hears a confirmation whether or not a pill was shown, it hears one
// that arrives after the client has left the logger, and what it heard
// survives a force-quit.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '0198f2d6-0000-7000-8000-0000000000aa';
const OTHER_SESSION = '0198f2d6-0000-7000-8000-0000000000ee';
const SET_A = '0198f2d6-0000-7000-8000-0000000000bb';
const SET_B = '0198f2d6-0000-7000-8000-0000000000cc';
const EXERCISE = '0198f2d6-0000-7000-8000-0000000000dd';

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetOutboxResultListenersForTests();
  resetSessionRecordsPersistenceForTests();
  resetSessionRecordsForTests();
});

function logSetResult(
  overrides: {
    setLocalId?: string;
    sessionLocalId?: string;
    newPersonalRecords?: string[];
    weightKg?: number | null;
  } = {},
): OutboxSendResult {
  const setLocalId = overrides.setLocalId ?? SET_A;
  return {
    procedure: 'workouts.logSet',
    clientLocalId: setLocalId,
    input: { sessionClientLocalId: overrides.sessionLocalId ?? SESSION, clientLocalId: setLocalId },
    result: {
      clientLocalId: setLocalId,
      exerciseId: EXERCISE,
      setNumber: 4,
      reps: 5,
      weightKg: overrides.weightKg === undefined ? 92.5 : overrides.weightKg,
      estimated1rmKg: 107.9,
      isWarmup: false,
      newPersonalRecords: overrides.newPersonalRecords ?? ['max_weight'],
    },
  };
}

function records() {
  return selectSessionRecords(useSessionRecordsStore.getState());
}

describe('useSessionRecords', () => {
  it('records every confirmed record of this session', () => {
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));

    act(() => {
      publishOutboxResult(logSetResult({ setLocalId: SET_A }));
      publishOutboxResult(
        logSetResult({ setLocalId: SET_B, newPersonalRecords: ['max_reps', 'max_volume'] }),
      );
    });

    expect(records().map((entry) => entry.setLocalId)).toEqual([SET_A, SET_B]);
    expect(records()[1]?.types).toEqual(['max_reps', 'max_volume']);
  });

  it('ignores a confirmation that belongs to another session', () => {
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));

    act(() => {
      publishOutboxResult(logSetResult({ sessionLocalId: OTHER_SESSION }));
    });

    expect(records()).toHaveLength(0);
  });

  it('ignores an ordinary set', () => {
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));

    act(() => {
      publishOutboxResult(logSetResult({ newPersonalRecords: [] }));
    });

    expect(records()).toHaveLength(0);
  });

  it('records a set whose record could never be worded', () => {
    // A bodyweight set that took `max_weight` cannot be phrased, so
    // `personal-records/03` shows no pill for it. The record is still real
    // and still belongs on the summary — the two decisions are separate.
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));

    act(() => {
      publishOutboxResult(logSetResult({ weightKg: null }));
    });

    expect(records()).toHaveLength(1);
  });

  it('stops listening once the screen is gone', () => {
    const { unmount } = renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));
    unmount();

    act(() => {
      publishOutboxResult(logSetResult());
    });

    expect(records()).toHaveLength(0);
  });

  it('survives a force-quit: mirrored to meta and restored', async () => {
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));
    act(() => {
      publishOutboxResult(logSetResult());
    });

    const db = await getLocalDb();
    await waitFor(async () => {
      const [row] = await db
        .select({ value: meta.value })
        .from(meta)
        .where(eq(meta.key, SESSION_RECORDS_META_KEY))
        .limit(1);
      expect(parseStoredRecords(row?.value)?.records).toHaveLength(1);
    });

    // The process is gone; the ledger is not.
    resetSessionRecordsForTests();
    useSessionRecordsStore.getState().openSession(SESSION);
    await restoreSessionRecords(SESSION, db);

    expect(records().map((entry) => entry.setLocalId)).toEqual([SET_A]);
  });

  it('drops a stored ledger that belongs to another session', async () => {
    renderHook(() => useSessionRecords({ sessionLocalId: SESSION }));
    act(() => {
      publishOutboxResult(logSetResult());
    });

    const db = await getLocalDb();
    await waitFor(async () => {
      const [row] = await db
        .select({ value: meta.value })
        .from(meta)
        .where(eq(meta.key, SESSION_RECORDS_META_KEY))
        .limit(1);
      expect(row?.value).toBeDefined();
    });

    resetSessionRecordsForTests();
    useSessionRecordsStore.getState().openSession(OTHER_SESSION);
    await restoreSessionRecords(OTHER_SESSION, db);

    expect(records()).toHaveLength(0);
    const [row] = await db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, SESSION_RECORDS_META_KEY))
      .limit(1);
    expect(row).toBeUndefined();
  });
});

describe('parseStoredRecords', () => {
  it('returns null for anything this build cannot vouch for', () => {
    expect(parseStoredRecords(null)).toBeNull();
    expect(parseStoredRecords('{')).toBeNull();
    expect(parseStoredRecords('[]')).toBeNull();
    expect(parseStoredRecords(JSON.stringify({ sessionLocalId: '', records: [] }))).toBeNull();
    expect(
      parseStoredRecords(
        JSON.stringify({ sessionLocalId: SESSION, records: [{ setLocalId: SET_A }] }),
      ),
    ).toBeNull();
    // One unreadable entry discards the whole ledger — a half-read list of
    // records is worse than none, because it looks complete.
    expect(
      parseStoredRecords(
        JSON.stringify({
          sessionLocalId: SESSION,
          records: [
            {
              setLocalId: SET_A,
              exerciseId: EXERCISE,
              reps: 5,
              weightKg: 92.5,
              estimated1rmKg: null,
              types: ['nonsense'],
              atMs: 1,
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('reads back a well-formed ledger', () => {
    const stored = JSON.stringify({
      sessionLocalId: SESSION,
      records: [
        {
          setLocalId: SET_A,
          exerciseId: EXERCISE,
          reps: 5,
          weightKg: null,
          estimated1rmKg: null,
          types: ['max_reps'],
          atMs: 42,
        },
      ],
    });

    expect(parseStoredRecords(stored)).toEqual({
      sessionLocalId: SESSION,
      records: [
        {
          setLocalId: SET_A,
          exerciseId: EXERCISE,
          reps: 5,
          weightKg: null,
          estimated1rmKg: null,
          types: ['max_reps'],
          atMs: 42,
        },
      ],
    });
  });
});
