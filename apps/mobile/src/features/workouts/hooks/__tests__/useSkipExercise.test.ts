import { renderHook, waitFor } from '@testing-library/react-native';
import { eq, sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import {
  useSkippedExercisesStore,
  type SkippedExercise,
} from '../../store/skipped-exercises-store.ts';
import {
  SKIPPED_EXERCISES_META_KEY,
  composeSkipNotes,
  parseStoredSkips,
  resetSkipPersistenceForTests,
  restoreSkips,
  skipNoteLine,
  useSkipExercise,
} from '../useSkipExercise.ts';

// `phase-09-workout-logger/session-modifications/03`. Five things have to be
// true, and four of them are the task's own acceptance criteria: a skip never
// asks for a logged set first, it moves the pager on the same tick, it queues
// nothing on the wire so it works with the radio off, it survives a
// force-quit, and the sentence it composes is the one the coach reads.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '018f4b1e-0000-7000-8000-0000000000aa';
const OTHER_SESSION = '018f4b1e-0000-7000-8000-0000000000bb';
const TAP = new Date('2026-08-15T19:00:00.000Z');

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetSkipPersistenceForTests();
  useSkippedExercisesStore.setState({ sessionLocalId: null, skips: new Map() });
});

function page(position: number, overrides: Partial<ExercisePage> = {}): ExercisePage {
  return {
    key: `b-${String(position)}`,
    exerciseId: `e-${String(position)}`,
    name: 'Barbell back squat',
    position,
    total: 3,
    supersetGroup: null,
    supersetPosition: null,
    supersetMemberCount: null,
    substitutedFor: null,
    badge: String(position),
    isRunStart: true,
    isRunEnd: true,
    targetSets: 3,
    setsLogged: null,
    ...overrides,
  };
}

function entry(overrides: Partial<SkippedExercise> = {}): SkippedExercise {
  return {
    exerciseKey: 'b-1',
    exerciseId: 'e-1',
    exerciseName: 'Barbell back squat',
    reason: 'pain',
    note: null,
    atMs: TAP.getTime(),
    ...overrides,
  };
}

async function storedValue(): Promise<string | null | undefined> {
  const db = await getLocalDb();
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, SKIPPED_EXERCISES_META_KEY))
    .limit(1);
  return row?.value;
}

async function outboxCount(): Promise<number> {
  const db = await getLocalDb();
  return db.all<{ id: string }>(sql`SELECT id FROM outbox`).length;
}

describe('skipNoteLine', () => {
  it('names the exercise and the reason in a sentence a coach can read', () => {
    expect(skipNoteLine(entry({ reason: 'pain' }))).toBe(
      'Skipped: Barbell back squat — pain or discomfort',
    );
  });

  it("carries the client's own words when they left any", () => {
    expect(skipNoteLine(entry({ reason: 'pain', note: 'left knee' }))).toBe(
      'Skipped: Barbell back squat — pain or discomfort (left knee)',
    );
  });

  it('never says the client missed or failed anything', () => {
    // `COPY.md` §CO3 — the line reports a fact and attributes no judgement.
    const line = skipNoteLine(entry({ reason: 'time' }));
    expect(line).not.toMatch(/missed|failed|didn't|incomplete/i);
  });
});

describe('composeSkipNotes', () => {
  it('is empty for a session with no skips, so a caller can concatenate blind', () => {
    expect(composeSkipNotes([])).toBe('');
  });

  it('orders the lines by when the client took them, not by page', () => {
    const later = entry({
      exerciseKey: 'b-1',
      exerciseName: 'Leg press',
      atMs: TAP.getTime() + 60,
    });
    const earlier = entry({ exerciseKey: 'b-2', exerciseName: 'Lunge', atMs: TAP.getTime() });

    expect(composeSkipNotes([later, earlier]).split('\n')[0]).toContain('Lunge');
  });
});

describe('parseStoredSkips', () => {
  it('reads back what was written', () => {
    const stored = JSON.stringify({ sessionLocalId: SESSION, skips: [entry()] });
    expect(parseStoredSkips(stored)).toEqual({ sessionLocalId: SESSION, skips: [entry()] });
  });

  it.each([
    ['nothing at all', undefined],
    ['unparseable text', '{'],
    ['a record with no session', JSON.stringify({ skips: [] })],
    [
      'an unknown reason',
      JSON.stringify({ sessionLocalId: SESSION, skips: [{ ...entry(), reason: 'bored' }] }),
    ],
    [
      'a missing key',
      JSON.stringify({ sessionLocalId: SESSION, skips: [{ ...entry(), exerciseKey: '' }] }),
    ],
  ])('refuses %s rather than half-rebuilding it', (_label, stored) => {
    expect(parseStoredSkips(stored as string | undefined)).toBeNull();
  });
});

describe('useSkipExercise', () => {
  it('records a skip with no set logged first, and advances to the next exercise', () => {
    const onAdvance = jest.fn();
    const { result } = renderHook(() =>
      useSkipExercise({
        sessionLocalId: SESSION,
        pageCount: 3,
        onAdvance,
        now: () => TAP,
      }),
    );

    // Nothing has been logged against this exercise — `setsLogged: null`.
    result.current.skip({ page: page(2), reason: 'equipment' });

    // Synchronous with the tap: the store already holds it and the pager has
    // already been told to move, with nothing awaited in between.
    expect(useSkippedExercisesStore.getState().skips.get('b-2')).toMatchObject({
      reason: 'equipment',
      exerciseName: 'Barbell back squat',
      atMs: TAP.getTime(),
    });
    expect(onAdvance).toHaveBeenCalledWith(2);
  });

  it('stays put on the last exercise rather than wrapping to the first', () => {
    const onAdvance = jest.fn();
    const { result } = renderHook(() =>
      useSkipExercise({ sessionLocalId: SESSION, pageCount: 3, onAdvance }),
    );

    result.current.skip({ page: page(3), reason: 'time' });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(useSkippedExercisesStore.getState().skips.has('b-3')).toBe(true);
  });

  it('queues nothing on the wire, so it works with the radio off', async () => {
    const { result } = renderHook(() => useSkipExercise({ sessionLocalId: SESSION, pageCount: 3 }));

    result.current.skip({ page: page(1), reason: 'pain', note: 'left knee' });

    await waitFor(async () => {
      expect(await storedValue()).toEqual(expect.any(String));
    });
    expect(await outboxCount()).toBe(0);
  });

  it('stores a blank note as absent rather than as an empty string', async () => {
    const { result } = renderHook(() => useSkipExercise({ sessionLocalId: SESSION, pageCount: 3 }));

    result.current.skip({ page: page(1), reason: 'other', note: '   ' });

    expect(useSkippedExercisesStore.getState().skips.get('b-1')?.note).toBeNull();
  });

  it('survives a force-quit: what was mirrored is what comes back', async () => {
    const { result } = renderHook(() => useSkipExercise({ sessionLocalId: SESSION, pageCount: 3 }));
    result.current.skip({ page: page(1), reason: 'equipment' });

    await waitFor(async () => {
      expect(await storedValue()).toEqual(expect.any(String));
    });

    // The process died and the store came back empty.
    useSkippedExercisesStore.setState({ sessionLocalId: SESSION, skips: new Map() });
    await restoreSkips(SESSION);

    expect(useSkippedExercisesStore.getState().skips.get('b-1')?.reason).toBe('equipment');
  });

  it('discards a record left behind by a different session', async () => {
    const db = await getLocalDb();
    await db
      .insert(meta)
      .values({
        key: SKIPPED_EXERCISES_META_KEY,
        value: JSON.stringify({ sessionLocalId: OTHER_SESSION, skips: [entry()] }),
      })
      .onConflictDoUpdate({ target: meta.key, set: { value: null } });

    useSkippedExercisesStore.getState().openSession(SESSION);
    await restoreSkips(SESSION);

    expect(useSkippedExercisesStore.getState().skips.size).toBe(0);
    expect(await storedValue()).toBeUndefined();
  });

  it('undoes a skip and clears the mirror with it', async () => {
    const { result } = renderHook(() => useSkipExercise({ sessionLocalId: SESSION, pageCount: 3 }));
    result.current.skip({ page: page(1), reason: 'equipment' });

    await waitFor(async () => {
      expect(await storedValue()).toEqual(expect.any(String));
    });

    result.current.undo('b-1');

    expect(useSkippedExercisesStore.getState().skips.size).toBe(0);
    await waitFor(async () => {
      expect(await storedValue()).toBeUndefined();
    });
  });
});
