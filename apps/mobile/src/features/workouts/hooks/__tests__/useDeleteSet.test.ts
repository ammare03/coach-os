import { renderHook, act } from '@testing-library/react-native';
import { sql } from 'drizzle-orm';
import { Alert } from 'react-native';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import {
  DELETE_SET_PROCEDURE,
  commitDeleteSet,
  deleteSetToastMessage,
  resetHiddenSetsForTests,
  useDeleteSet,
} from '../useDeleteSet.ts';
import { logSet } from '../useLogSet.ts';
import { updateSet } from '../useUpdateSet.ts';

// `phase-09-workout-logger/set-entry/06`. The task's named risk is the whole
// of this file: deleting for real at the tap and re-creating the row on undo
// instead of deferring. Every assertion below is either a way that could
// still be happening, or a way the deferred delete could go wrong once the
// window does close.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  asUuid: (value: string) => value,
}));

/** What the hook hands `useUndoToast`. Captured rather than rendered. */
interface CapturedToast {
  message: string;
  onUndo: () => void;
  onCommit?: (() => void) | undefined;
  durationMs?: number | undefined;
  undoLabel?: string | undefined;
}

let nextToastId = 0;
const mockShowUndoToast = jest.fn((_options: CapturedToast): string => {
  nextToastId += 1;
  return `toast-${String(nextToastId)}`;
});

// The trap on `ConfirmModal` is the feature acceptance criterion made
// executable: "deletion uses the undo-toast pattern, never a confirm
// dialog". Reaching for it from `useDeleteSet` fails the suite at import.
jest.mock('@coachos/ui', () => {
  const mod: Record<string, unknown> = {
    useUndoToast: () => mockShowUndoToast,
  };
  Object.defineProperty(mod, 'ConfirmModal', {
    enumerable: false,
    get() {
      throw new Error('set deletion must use the undo toast, never a confirm dialog');
    },
  });
  return mod;
});

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetHiddenSetsForTests();
  mockTrackEvent.mockClear();
  mockShowUndoToast.mockClear();
  nextToastId = 0;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

const STARTED = new Date('2026-08-15T09:00:00.000Z');
/** The original confirming tap. */
const TAP = new Date('2026-08-15T09:14:22.000Z');
/** The delete tap. Must be what reaches the wire, not the moment the window closed. */
const DELETE_TAP = new Date('2026-08-15T09:20:05.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const SESSION_KEY = '018f4b1e-0000-7000-8000-0000000000aa';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';

/** See `useLogSet.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

async function seedInProgress(startOutboxId: string | null = null): Promise<void> {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SERVER_ID,
    clientLocalId: SESSION_KEY,
    serverId: SERVER_ID,
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: 'Push A',
    status: 'in_progress',
    startedAt: STARTED.getTime(),
    completedAt: null,
    payloadJson: '{}',
    startOutboxId,
    syncState: 'pending',
    updatedAt: STARTED.getTime(),
  });
}

const ONE_SET = {
  sessionLocalId: SESSION_KEY,
  exerciseId: EXERCISE_ID,
  setNumber: 2,
  reps: 10,
  weightKg: 80,
} as const;

/** A set already logged, exactly as `useLogSet` would have left it. */
async function logOriginal(): Promise<{ localId: string; outboxId: string }> {
  await seedInProgress();
  const logged = await logSet({ ...ONE_SET, now: () => TAP });
  mockTrackEvent.mockClear();
  return { localId: logged.localId, outboxId: logged.outboxId };
}

async function readRows() {
  const db = await getLocalDb();
  const sets = await db.select().from(localSetLogs);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sets, entries };
}

function payloadOf(entry: QueuedMutation | undefined): Record<string, unknown> {
  return deserializeOutboxPayload(entry?.payload_json ?? '') as Record<string, unknown>;
}

function deletesIn(entries: readonly QueuedMutation[]): QueuedMutation[] {
  return entries.filter((entry) => entry.procedure === DELETE_SET_PROCEDURE);
}

/** Lets the deferred commit's promise chain and its SQLite work settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function lastToast(): CapturedToast {
  const call = mockShowUndoToast.mock.calls.at(-1);
  if (!call?.[0]) throw new Error('no undo toast was shown');
  return call[0];
}

describe('the tap', () => {
  it('hides the set without deleting anything — no local removal, no queued delete', async () => {
    // The task's Risks section, and the only reason this hook is shaped the
    // way it is. If a delete has already happened here, "undo" is a
    // re-creation and everything below is testing the wrong design.
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());

    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.clientLocalId).toBe(original.localId);
    expect(deletesIn(entries)).toHaveLength(0);
    expect(entries).toHaveLength(1); // only the original log
    expect(result.current.isSetHidden(original.localId)).toBe(true);
  });

  it('never asks first — the undo toast is shown and no dialog is raised', async () => {
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());

    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    expect(mockShowUndoToast).toHaveBeenCalledTimes(1);
    expect(lastToast().onUndo).toBeInstanceOf(Function);
    expect(lastToast().onCommit).toBeInstanceOf(Function);
    expect(alertSpy).not.toHaveBeenCalled();
    // The row is already gone from the list — nothing was awaited, which is
    // what distinguishes this from a confirmation.
    expect(result.current.isSetHidden(original.localId)).toBe(true);
  });

  it('leaves the window at the shared 5s default rather than setting its own', async () => {
    // `UNDO_WINDOW_MS` is "not a tuning knob" (`useUndoToast`). A feature
    // passing its own `durationMs` is asking for a different pattern.
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());

    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    expect(lastToast().durationMs).toBeUndefined();
  });

  it('returns the first toast when the same set is deleted twice in one window', async () => {
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());
    let first = '';
    let second = '';

    act(() => {
      first = result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
      second = result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    expect(second).toBe(first);
    expect(mockShowUndoToast).toHaveBeenCalledTimes(1);
  });
});

describe('undo', () => {
  it('restores the set with no data loss, because nothing was ever removed', async () => {
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());
    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    act(() => {
      lastToast().onUndo();
    });

    const { sets, entries } = await readRows();
    expect(result.current.isSetHidden(original.localId)).toBe(false);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      clientLocalId: original.localId,
      setNumber: 2,
      reps: 10,
      weightKg: 80,
      loggedAt: TAP.getTime(),
    });
    expect(deletesIn(entries)).toHaveLength(0);
  });

  it('does not re-create the row — the local set count never changed', async () => {
    // Guards the failure mode directly: a re-creating undo would show the
    // same count here while having written a new row under a new key.
    const original = await logOriginal();
    const before = await readRows();
    const { result } = renderHook(() => useDeleteSet());

    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });
    act(() => {
      lastToast().onUndo();
    });

    const after = await readRows();
    expect(after.sets).toEqual(before.sets);
    expect(after.entries).toHaveLength(before.entries.length);
  });
});

describe('the window elapsing', () => {
  it('removes the row once and queues exactly one delete', async () => {
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());
    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    act(() => {
      lastToast().onCommit?.();
    });
    await settle();

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(0);
    const deletes = deletesIn(entries);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.client_local_id).toBe(original.localId);
    expect(result.current.isSetHidden(original.localId)).toBe(true);
  });

  it('tells the caller so it can drop the row from its own list', async () => {
    const original = await logOriginal();
    const onCommitted = jest.fn();
    const { result } = renderHook(() => useDeleteSet());
    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2, onCommitted });
    });

    act(() => {
      lastToast().onCommit?.();
    });
    await settle();

    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('keeps the set hidden after the commit, so a stale list cannot resurrect it', async () => {
    const original = await logOriginal();
    const { result } = renderHook(() => useDeleteSet());
    act(() => {
      result.current.deleteSet({ setLocalId: original.localId, setNumber: 2 });
    });

    act(() => {
      lastToast().onCommit?.();
    });
    await settle();

    expect(result.current.hiddenSetIds.has(original.localId)).toBe(true);
  });
});

describe('two deletes at once', () => {
  it('runs a second delete independently while the first window is still open', async () => {
    await seedInProgress();
    const first = await logSet({ ...ONE_SET, setNumber: 1, now: () => TAP });
    const second = await logSet({ ...ONE_SET, setNumber: 2, now: () => TAP });
    const { result } = renderHook(() => useDeleteSet());

    act(() => {
      result.current.deleteSet({ setLocalId: first.localId, setNumber: 1 });
    });
    const firstToast = lastToast();
    act(() => {
      result.current.deleteSet({ setLocalId: second.localId, setNumber: 2 });
    });
    const secondToast = lastToast();

    expect(mockShowUndoToast).toHaveBeenCalledTimes(2);
    expect(result.current.hiddenSetIds.has(first.localId)).toBe(true);
    expect(result.current.hiddenSetIds.has(second.localId)).toBe(true);

    // The first is undone, the second commits. Two windows, two outcomes.
    act(() => {
      firstToast.onUndo();
    });
    act(() => {
      secondToast.onCommit?.();
    });
    await settle();

    const { sets, entries } = await readRows();
    expect(sets.map((row) => row.clientLocalId)).toEqual([first.localId]);
    const deletes = deletesIn(entries);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.client_local_id).toBe(second.localId);
    expect(result.current.isSetHidden(first.localId)).toBe(false);
  });
});

describe('the queued delete', () => {
  it('re-sends the set’s own key, so a replay withdraws one set rather than many', async () => {
    const original = await logOriginal();

    const deleted = await commitDeleteSet({
      setLocalId: original.localId,
      deletedAt: DELETE_TAP,
    });

    const { entries } = await readRows();
    const queued = deletesIn(entries)[0];
    expect(queued?.client_local_id).toBe(original.localId);
    expect(deleted.outboxId).toBe(queued?.id);
  });

  it('chains behind the log it withdraws, so it cannot overtake it', async () => {
    // Siblings flush concurrently (`enqueue.ts` rule 4). A delete that
    // reached the server before the log it withdraws names a
    // `client_local_id` the server has never heard of — ten failed attempts
    // and a "couldn't sync" banner for work that was fine.
    const original = await logOriginal();

    await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    const { entries } = await readRows();
    expect(deletesIn(entries)[0]?.depends_on).toBe(original.outboxId);
  });

  it('chains behind an edit when one is still queued, not behind the original log', async () => {
    const original = await logOriginal();
    await updateSet({ setLocalId: original.localId, reps: 12 });
    const afterEdit = await readRows();
    const editEntry = afterEdit.entries.at(-1);

    await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    const { entries } = await readRows();
    expect(deletesIn(entries)[0]?.depends_on).toBe(editEntry?.id);
  });

  it('falls back to the session start when nothing else carries the key', async () => {
    const { outboxId: startOutboxId } = await enqueueMutation({
      procedure: 'workouts.start',
      payload: {},
    });
    await seedInProgress(startOutboxId);
    const db = await getLocalDb();
    // A set the device holds with no outbox row of its own — a prefetched
    // row, or one whose log already flushed and was pruned.
    await db.insert(localSetLogs).values({
      id: '018f4b1e-0000-7000-8000-0000000000dd',
      clientLocalId: '018f4b1e-0000-7000-8000-0000000000dd',
      sessionLocalId: SESSION_KEY,
      exerciseId: EXERCISE_ID,
      setNumber: 1,
      reps: 8,
      weightKg: 60,
      isWarmup: false,
      isFailure: false,
      loggedAt: TAP.getTime(),
      syncState: 'synced',
    });

    await commitDeleteSet({
      setLocalId: '018f4b1e-0000-7000-8000-0000000000dd',
      deletedAt: DELETE_TAP,
    });

    const { entries } = await readRows();
    expect(deletesIn(entries)[0]?.depends_on).toBe(startOutboxId);
  });

  it('names the session by its client_local_id and carries the tap instant', async () => {
    // `offline-sync` §10: an instant captured at flush is the
    // "everything timestamped at reconnect" failure. The delete tap is what
    // the server records, and superjson keeps it a real Date.
    const original = await logOriginal();

    await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    const { entries } = await readRows();
    const payload = payloadOf(deletesIn(entries)[0]);
    expect(payload.sessionClientLocalId).toBe(SESSION_KEY);
    expect(payload.deletedAt).toEqual(DELETE_TAP);
    expect(payload.deletedAt).toBeInstanceOf(Date);
  });

  it('is a no-op on a set that is already gone, rather than queuing a second withdrawal', async () => {
    const original = await logOriginal();
    await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    const again = await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    const { entries } = await readRows();
    expect(again.outboxId).toBeNull();
    expect(deletesIn(entries)).toHaveLength(1);
  });

  it('fires no analytics event', async () => {
    // `useUpdateSet` rule (e), applied unchanged: re-firing `set_logged`
    // would inflate every per-set denominator, and a new `set_deleted`
    // needs an `ANALYTICS.md` row and a reader before it exists.
    const original = await logOriginal();

    await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

describe('set numbering', () => {
  it('leaves a gap rather than renumbering the sets after the deleted one', async () => {
    // `set-entry/03`'s last-time lookup matches strictly on `set_number` and
    // already tolerates gaps; `SetEntrySlot` derives the next number as
    // `highest + 1`, so a gap cannot collide. Renumbering would silently
    // re-point next week's comparison at a different set.
    await seedInProgress();
    const logged = [];
    for (const setNumber of [1, 2, 3, 4]) {
      logged.push(await logSet({ ...ONE_SET, setNumber, now: () => TAP }));
    }
    const second = logged[1];

    await commitDeleteSet({ setLocalId: second?.localId ?? '', deletedAt: DELETE_TAP });

    const { sets, entries } = await readRows();
    expect(sets.map((row) => row.setNumber).sort((a, b) => a - b)).toEqual([1, 3, 4]);
    // And no renumbering re-sends: one delete, and nothing else queued.
    expect(deletesIn(entries)).toHaveLength(1);
    expect(entries).toHaveLength(5); // four logs plus the one delete
  });
});

describe('offline', () => {
  it('takes the identical path with no signal — same row, same payload, same chain', async () => {
    // Nothing in this hook reads connectivity and nothing awaits the radio.
    // The proof is that the queued delete is byte-identical to the one an
    // online device produces.
    const online = await (async () => {
      const original = await logOriginal();
      await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });
      const { entries } = await readRows();
      const queued = deletesIn(entries)[0];
      return {
        procedure: queued?.procedure,
        payloadJson: queued?.payload_json,
        chainedToLog: queued?.depends_on === original.outboxId,
      };
    })();

    sqlite.__reset();
    resetLocalDbForTests();
    resetOutboxFlushStateForTests();

    const offline = await (async () => {
      const original = await logOriginal();
      await commitDeleteSet({ setLocalId: original.localId, deletedAt: DELETE_TAP });
      const { entries } = await readRows();
      const queued = deletesIn(entries)[0];
      return {
        procedure: queued?.procedure,
        payloadJson: queued?.payload_json,
        chainedToLog: queued?.depends_on === original.outboxId,
      };
    })();

    expect(offline).toEqual(online);
    expect(offline.procedure).toBe(DELETE_SET_PROCEDURE);
    expect(offline.chainedToLog).toBe(true);
  });
});

describe('the toast copy', () => {
  it('names the set by its number', () => {
    expect(deleteSetToastMessage({ setNumber: 3 })).toBe('Set 3 deleted');
  });

  it('names a warm-up by what it is, since the client does not count it', () => {
    expect(deleteSetToastMessage({ setNumber: 1, isWarmup: true })).toBe('Warm-up set deleted');
  });

  it('states a fact and nothing else — no exclamation, no blame (`COPY.md` CO§2)', () => {
    const message = deleteSetToastMessage({ setNumber: 2 });
    expect(message).not.toMatch(/[!?]/);
    expect(message).not.toMatch(/\b(you|your|just|simply|oops)\b/i);
  });
});
