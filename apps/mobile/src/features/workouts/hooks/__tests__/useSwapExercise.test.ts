import { renderHook, waitFor } from '@testing-library/react-native';
import { eq, sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import type { AlternativeExercise } from '../../lib/alternatives.ts';
import type { ExercisePage } from '../../lib/exercise-pages.ts';
import {
  useSubstitutedExercisesStore,
  type ExerciseSubstitution,
} from '../../store/substituted-exercises-store.ts';
import {
  SUBSTITUTED_EXERCISES_META_KEY,
  parseStoredSubstitutions,
  resetSwapPersistenceForTests,
  restoreSubstitutions,
  substitutionNote,
  substitutionNoteLine,
  useSwapExercise,
} from '../useSwapExercise.ts';

// `phase-09-workout-logger/session-modifications/02`. Five things have to be
// true, and three of them are the task's own acceptance criteria: a swap
// queues nothing on the wire so it works with the radio off, it belongs to
// one slot of one session and never leaks into another, it survives a
// force-quit, the substitution line reaches exactly the first set logged
// against the substitute, and it never overwrites the client's own words.

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
  resetSwapPersistenceForTests();
  useSubstitutedExercisesStore.setState({ sessionLocalId: null, substitutions: new Map() });
});

function page(overrides: Partial<ExercisePage> = {}): ExercisePage {
  return {
    key: 'b-1',
    exerciseId: 'e-squat',
    name: 'Barbell back squat',
    substitutedFor: null,
    position: 1,
    total: 3,
    supersetGroup: null,
    supersetPosition: null,
    supersetMemberCount: null,
    badge: '1',
    isRunStart: true,
    isRunEnd: true,
    targetSets: 3,
    setsLogged: null,
    ...overrides,
  };
}

const PRESS: AlternativeExercise = { id: 'e-press', name: 'Leg press', primaryMuscle: 'quads' };
const HACK: AlternativeExercise = { id: 'e-hack', name: 'Hack squat', primaryMuscle: 'quads' };

function entry(overrides: Partial<ExerciseSubstitution> = {}): ExerciseSubstitution {
  return {
    exerciseKey: 'b-1',
    originalExerciseId: 'e-squat',
    originalName: 'Barbell back squat',
    substituteExerciseId: 'e-press',
    substituteName: 'Leg press',
    atMs: TAP.getTime(),
    ...overrides,
  };
}

function mount(sessionLocalId = SESSION) {
  return renderHook(() => useSwapExercise({ sessionLocalId, now: () => TAP }));
}

async function outboxDepth(): Promise<number> {
  const db = await getLocalDb();
  const [row] = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM outbox`);
  return row?.n ?? 0;
}

async function storedValue(): Promise<string | null | undefined> {
  const db = await getLocalDb();
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, SUBSTITUTED_EXERCISES_META_KEY))
    .limit(1);
  return row?.value;
}

describe('applying a swap', () => {
  it('records the substitute against the slot, synchronously with the tap', () => {
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });

    const stored = useSubstitutedExercisesStore.getState().substitutions.get('b-1');
    expect(stored).toEqual(entry());
  });

  it('queues nothing on the wire, so it works with the radio off', () => {
    // The task's criterion. The swap's only durable consequence is the sets
    // logged against the substitute, which sync by their own path.
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });

    return expect(outboxDepth()).resolves.toBe(0);
  });

  it('captures the instant at the tap, never at persistence time', () => {
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });

    expect(useSubstitutedExercisesStore.getState().substitutions.get('b-1')?.atMs).toBe(
      TAP.getTime(),
    );
  });

  it('touches no other slot', () => {
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });

    expect(useSubstitutedExercisesStore.getState().substitutions.has('b-2')).toBe(false);
    expect(useSubstitutedExercisesStore.getState().substitutions.size).toBe(1);
  });

  it('keeps naming the COACH’S exercise when the client swaps a second time', () => {
    // Otherwise the note would tell the coach the client replaced the first
    // substitute, rather than the exercise they were actually programmed.
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });
    result.current.swap({
      page: page({
        exerciseId: 'e-press',
        name: 'Leg press',
        substitutedFor: { exerciseId: 'e-squat', name: 'Barbell back squat' },
      }),
      substitute: HACK,
    });

    expect(useSubstitutedExercisesStore.getState().substitutions.get('b-1')).toEqual(
      entry({ substituteExerciseId: 'e-hack', substituteName: 'Hack squat' }),
    );
  });

  it('puts the coach’s own exercise back, and queues nothing to do it', async () => {
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });
    result.current.revert('b-1');

    expect(useSubstitutedExercisesStore.getState().substitutions.size).toBe(0);
    await expect(outboxDepth()).resolves.toBe(0);
  });
});

describe('the session scope', () => {
  it('refuses a write naming a session the store is not open on', () => {
    mount(SESSION);

    useSubstitutedExercisesStore.getState().substitute(OTHER_SESSION, entry());

    expect(useSubstitutedExercisesStore.getState().substitutions.size).toBe(0);
  });

  it('wipes when the logger opens a different session', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSwapExercise({ sessionLocalId: id, now: () => TAP }),
      { initialProps: { id: SESSION } },
    );
    result.current.swap({ page: page(), substitute: PRESS });

    rerender({ id: OTHER_SESSION });

    expect(useSubstitutedExercisesStore.getState().substitutions.size).toBe(0);
  });
});

describe('surviving a force-quit', () => {
  it('mirrors the swap to meta', async () => {
    const { result } = mount();

    result.current.swap({ page: page(), substitute: PRESS });

    await waitFor(async () => {
      expect(parseStoredSubstitutions(await storedValue())).toEqual({
        sessionLocalId: SESSION,
        substitutions: [entry()],
      });
    });
  });

  it('clears the row rather than storing an empty set once everything is reverted', async () => {
    const { result } = mount();
    result.current.swap({ page: page(), substitute: PRESS });
    await waitFor(async () => {
      expect(await storedValue()).toBeDefined();
    });

    result.current.revert('b-1');

    await waitFor(async () => {
      expect(await storedValue()).toBeUndefined();
    });
  });

  it('hydrates the store from what the last process recorded', async () => {
    useSubstitutedExercisesStore.getState().openSession(SESSION);
    const db = await getLocalDb();
    await db.insert(meta).values({
      key: SUBSTITUTED_EXERCISES_META_KEY,
      value: JSON.stringify({ sessionLocalId: SESSION, substitutions: [entry()] }),
    });

    await restoreSubstitutions(SESSION, db);

    expect(useSubstitutedExercisesStore.getState().substitutions.get('b-1')).toEqual(entry());
  });

  it('drops a record belonging to a different session rather than swapping the wrong workout', async () => {
    useSubstitutedExercisesStore.getState().openSession(SESSION);
    const db = await getLocalDb();
    await db.insert(meta).values({
      key: SUBSTITUTED_EXERCISES_META_KEY,
      value: JSON.stringify({ sessionLocalId: OTHER_SESSION, substitutions: [entry()] }),
    });

    await restoreSubstitutions(SESSION, db);

    expect(useSubstitutedExercisesStore.getState().substitutions.size).toBe(0);
    expect(await storedValue()).toBeUndefined();
  });

  it('never clobbers a swap the client made in this process', () => {
    // The restore can land after the client has already swapped something,
    // and the live copy is the newer of the two.
    useSubstitutedExercisesStore.getState().openSession(SESSION);
    const live = entry({ substituteExerciseId: 'e-hack', substituteName: 'Hack squat' });
    useSubstitutedExercisesStore.getState().substitute(SESSION, live);

    useSubstitutedExercisesStore.getState().hydrate(SESSION, [entry()]);

    expect(useSubstitutedExercisesStore.getState().substitutions.get('b-1')).toEqual(live);
  });

  it('rejects a half-readable record whole rather than rebuilding part of it', () => {
    expect(
      parseStoredSubstitutions('{"sessionLocalId":"x","substitutions":[{"bad":1}]}'),
    ).toBeNull();
    expect(parseStoredSubstitutions('not json')).toBeNull();
    expect(parseStoredSubstitutions(null)).toBeNull();
  });
});

describe('the note the coach reads', () => {
  it('names the exercise the client was programmed', () => {
    expect(substitutionNoteLine(entry())).toBe('Substituted for Barbell back squat.');
  });

  it('lands on the first set logged against the substitute', () => {
    expect(substitutionNote(entry(), 0)).toBe('Substituted for Barbell back squat.');
  });

  it('lands on no other set — the fact is about the exercise, not each set of it', () => {
    expect(substitutionNote(entry(), 1)).toBeNull();
    expect(substitutionNote(entry(), 7)).toBeNull();
  });

  it('never overwrites the client’s own words', () => {
    // The task's acceptance criterion. Prepended on its own line, so what
    // the client wrote survives verbatim.
    expect(substitutionNote(entry(), 0, 'Machine felt heavy')).toBe(
      'Substituted for Barbell back squat.\nMachine felt heavy',
    );
  });

  it('keeps the client’s note alone on a set that takes no substitution line', () => {
    expect(substitutionNote(entry(), 2, 'Machine felt heavy')).toBe('Machine felt heavy');
    expect(substitutionNote(null, 0, 'Machine felt heavy')).toBe('Machine felt heavy');
  });

  it('is null for an unswapped exercise with nothing written on it', () => {
    expect(substitutionNote(null, 0)).toBeNull();
    expect(substitutionNote(undefined, 0, '   ')).toBeNull();
  });
});
