import { renderHook } from '@testing-library/react-native';

import { useProgramDayBuilder } from '../hooks/useProgramDayBuilder.ts';

// The optimistic half of `program-builder/03`'s drop: the list has to move
// the moment the coach lets go, reconcile against what the server actually
// settled on, and go back exactly where it was if the write is refused
// (`CLAUDE.md` §19 — the drop is a local, sub-100ms confirmation, never a
// round trip).
//
// The mutation's own callbacks are what carry all three, so they are
// captured and driven directly rather than through a live TanStack Query
// client — the same seam `useCompleteOnboarding.test.ts` uses.

const DAY_ID = 'day-1';

// Only the two fields the reorder callbacks touch — the real cached day
// carries the rest and none of it is read here.
interface CachedDay {
  programId: string;
  exercises: {
    id: string;
    orderIndex: number;
    supersetGroup: string | null;
    alternatives?: { id: string; name: string }[];
  }[];
}

type ReorderVariables = { programDayId: string; orderedExerciseIds: string[] };
type ReorderResult = { exercises: { id: string; orderIndex: number }[] };
interface ReorderOptions {
  onMutate: (variables: ReorderVariables) => Promise<{ previous: CachedDay | undefined }>;
  onSuccess: (result: ReorderResult, variables: ReorderVariables) => void;
  onError: (
    error: unknown,
    variables: ReorderVariables,
    context: { previous: CachedDay | undefined } | undefined,
  ) => void;
  onSettled: () => Promise<void>;
}

// `program-builder/04`'s grouping rides the same seam: the optimistic
// write, the reconcile against what the server settled on, and the rollback.
type GroupVariables = { programDayId: string; exerciseIds: string[]; group: string | null };
type GroupResult = { exercises: { id: string; supersetGroup: string | null }[] };
interface GroupOptions {
  onMutate: (variables: GroupVariables) => Promise<{ previous: CachedDay | undefined }>;
  onSuccess: (result: GroupResult, variables: GroupVariables) => void;
  onError: (
    error: unknown,
    variables: GroupVariables,
    context: { previous: CachedDay | undefined } | undefined,
  ) => void;
  onSettled: () => Promise<void>;
}

// `program-builder/05`'s swap list. NOT optimistic — the sheet's own footer
// already shows the coach it is saving, and the resolved names only exist
// server-side — so only the reconcile and the invalidation are captured.
type AlternativesVariables = { programExerciseId: string; alternativeExerciseIds: string[] };
type AlternativesResult = { alternatives: { id: string; name: string }[] };
interface AlternativesOptions {
  onSuccess: (result: AlternativesResult, variables: AlternativesVariables) => void;
  onSettled: () => Promise<void>;
}

let mockReorderOptions: ReorderOptions;
let mockGroupOptions: GroupOptions;
let mockAlternativesOptions: AlternativesOptions;
const mockCache = new Map<string, CachedDay>();
const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockInvalidateDay = jest.fn().mockResolvedValue(undefined);
const mockInvalidateProgram = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    programs: {
      get: { invalidate: jest.fn() },
      days: {
        get: { useQuery: () => ({ data: undefined }) },
        // `session-runtime/09`'s warning read. Stubbed here because every
        // write in this file now refreshes it; what it answers is pinned by
        // `./useProgramDayBuilder-mid-session.test.ts`, not by this file.
        midSessionClients: {
          useQuery: () => ({ data: undefined, refetch: jest.fn().mockResolvedValue({ data: [] }) }),
        },
      },
      exercises: {
        create: { useMutation: () => ({}) },
        update: { useMutation: () => ({}) },
        delete: { useMutation: () => ({}) },
        reorder: {
          useMutation: (options: unknown) => {
            mockReorderOptions = options as ReorderOptions;
            return { mutate: jest.fn(), isPending: false };
          },
        },
        setSupersetGroup: {
          useMutation: (options: unknown) => {
            mockGroupOptions = options as GroupOptions;
            return { mutate: jest.fn(), isPending: false };
          },
        },
        setAlternatives: {
          useMutation: (options: unknown) => {
            mockAlternativesOptions = options as AlternativesOptions;
            return { mutate: jest.fn(), isPending: false };
          },
        },
      },
    },
    useUtils: () => ({
      programs: {
        get: { invalidate: mockInvalidateProgram },
        days: {
          get: {
            cancel: mockCancel,
            invalidate: mockInvalidateDay,
            getData: ({ programDayId }: { programDayId: string }) => mockCache.get(programDayId),
            setData: ({ programDayId }: { programDayId: string }, value: CachedDay) => {
              mockCache.set(programDayId, value);
            },
          },
        },
      },
    }),
  },
}));

function seedCache(): CachedDay {
  const day: CachedDay = {
    programId: 'program-1',
    exercises: [
      { id: 'a', orderIndex: 1, supersetGroup: null },
      { id: 'b', orderIndex: 2, supersetGroup: null },
      { id: 'c', orderIndex: 3, supersetGroup: null },
    ],
  };
  mockCache.set(DAY_ID, day);
  return day;
}

function cachedIds(): string[] {
  return (mockCache.get(DAY_ID)?.exercises ?? []).map((exercise) => exercise.id);
}

beforeEach(() => {
  mockCache.clear();
  mockCancel.mockClear();
  mockInvalidateDay.mockClear();
  renderHook(() => useProgramDayBuilder(DAY_ID));
});

describe('useProgramDayBuilder — reorder', () => {
  it('moves the list before the server answers, and stops the in-flight read racing it', async () => {
    seedCache();

    await mockReorderOptions.onMutate({
      programDayId: DAY_ID,
      orderedExerciseIds: ['c', 'a', 'b'],
    });

    expect(mockCancel).toHaveBeenCalledWith({ programDayId: DAY_ID });
    expect(cachedIds()).toEqual(['c', 'a', 'b']);
    // Renumbered to the gapless 1..N the server settles on, so the two
    // cannot disagree once the response lands.
    expect(mockCache.get(DAY_ID)?.exercises.map((exercise) => exercise.orderIndex)).toEqual([
      1, 2, 3,
    ]);
  });

  it('reconciles against the order the server actually settled on, not the guess', async () => {
    seedCache();
    await mockReorderOptions.onMutate({
      programDayId: DAY_ID,
      orderedExerciseIds: ['c', 'a', 'b'],
    });

    // The server disagrees — another device moved something too.
    mockReorderOptions.onSuccess(
      {
        exercises: [
          { id: 'b', orderIndex: 1 },
          { id: 'c', orderIndex: 2 },
          { id: 'a', orderIndex: 3 },
        ],
      },
      { programDayId: DAY_ID, orderedExerciseIds: ['c', 'a', 'b'] },
    );

    expect(cachedIds()).toEqual(['b', 'c', 'a']);
  });

  it('puts the list back exactly as it was when the write is refused', async () => {
    const before = seedCache();
    const variables = { programDayId: DAY_ID, orderedExerciseIds: ['c', 'a', 'b'] };
    const context = await mockReorderOptions.onMutate(variables);
    expect(cachedIds()).toEqual(['c', 'a', 'b']);

    mockReorderOptions.onError(new Error('PROGRAM_DAY_ORDER_STALE'), variables, context);

    expect(mockCache.get(DAY_ID)).toBe(before);
    expect(cachedIds()).toEqual(['a', 'b', 'c']);
  });

  it('survives a drop against a cache that has already been evicted', async () => {
    const context = await mockReorderOptions.onMutate({
      programDayId: DAY_ID,
      orderedExerciseIds: ['c', 'a', 'b'],
    });

    expect(context.previous).toBeUndefined();
    expect(mockCache.has(DAY_ID)).toBe(false);
    // Nothing to put back, and nothing thrown.
    mockReorderOptions.onError(
      new Error('offline'),
      { programDayId: DAY_ID, orderedExerciseIds: ['c', 'a', 'b'] },
      context,
    );
    expect(mockCache.has(DAY_ID)).toBe(false);
  });

  // A reorder changes no count, so `programs.get`'s "5 exercises" meta line
  // on the screen behind is not stale — invalidating it would be a refetch
  // nothing asked for.
  it('refreshes this day only', async () => {
    await mockReorderOptions.onSettled();

    expect(mockInvalidateDay).toHaveBeenCalledWith({ programDayId: DAY_ID });
    expect(mockInvalidateProgram).not.toHaveBeenCalled();
  });
});

function cachedGroups(): (string | null)[] {
  return (mockCache.get(DAY_ID)?.exercises ?? []).map((exercise) => exercise.supersetGroup);
}

describe('useProgramDayBuilder — supersets', () => {
  it('tints the picked rows before the server answers', async () => {
    seedCache();

    await mockGroupOptions.onMutate({
      programDayId: DAY_ID,
      exerciseIds: ['a', 'b'],
      group: 'A',
    });

    expect(cachedGroups()).toEqual(['A', 'A', null]);
    expect(mockCancel).toHaveBeenCalledWith({ programDayId: DAY_ID });
  });

  it('clears the letter on an ungroup', async () => {
    seedCache();

    await mockGroupOptions.onMutate({
      programDayId: DAY_ID,
      exerciseIds: ['a', 'b'],
      group: 'A',
    });
    await mockGroupOptions.onMutate({
      programDayId: DAY_ID,
      exerciseIds: ['a', 'b'],
      group: null,
    });

    expect(cachedGroups()).toEqual([null, null, null]);
  });

  it('takes the server’s grouping over its own guess', async () => {
    seedCache();
    const variables = { programDayId: DAY_ID, exerciseIds: ['a', 'b'], group: 'A' };
    await mockGroupOptions.onMutate(variables);

    // Another device had already taken A, so the server settled on B.
    mockGroupOptions.onSuccess(
      {
        exercises: [
          { id: 'a', supersetGroup: 'B' },
          { id: 'b', supersetGroup: 'B' },
          { id: 'c', supersetGroup: null },
        ],
      },
      variables,
    );

    expect(cachedGroups()).toEqual(['B', 'B', null]);
  });

  it('puts the grouping back exactly as it was when the write is refused', async () => {
    const before = seedCache();
    const variables = { programDayId: DAY_ID, exerciseIds: ['a', 'b'], group: 'A' };
    const context = await mockGroupOptions.onMutate(variables);
    expect(cachedGroups()).toEqual(['A', 'A', null]);

    mockGroupOptions.onError(new Error('PROGRAM_SUPERSET_STALE'), variables, context);

    expect(mockCache.get(DAY_ID)).toBe(before);
    expect(cachedGroups()).toEqual([null, null, null]);
  });
});

describe('useProgramDayBuilder — approved swaps', () => {
  it('writes the server’s resolved list onto the one block it belongs to', () => {
    seedCache();

    mockAlternativesOptions.onSuccess(
      { alternatives: [{ id: 'ex-hack', name: 'Hack Squat' }] },
      { programExerciseId: 'b', alternativeExerciseIds: ['ex-hack'] },
    );

    const exercises = mockCache.get(DAY_ID)?.exercises ?? [];
    expect(exercises.map((exercise) => exercise.alternatives)).toEqual([
      undefined,
      [{ id: 'ex-hack', name: 'Hack Squat' }],
      undefined,
    ]);
  });

  it('survives a reconcile against a cache that has already been evicted', () => {
    mockCache.clear();

    expect(() => {
      mockAlternativesOptions.onSuccess(
        { alternatives: [] },
        { programExerciseId: 'b', alternativeExerciseIds: [] },
      );
    }).not.toThrow();
  });

  // A swap list changes no count, so `programs.get`'s "5 exercises" line is
  // not stale and must not be thrown away with it.
  it('refreshes this day only', async () => {
    await mockAlternativesOptions.onSettled();

    expect(mockInvalidateDay).toHaveBeenCalledWith({ programDayId: DAY_ID });
    expect(mockInvalidateProgram).not.toHaveBeenCalled();
  });
});
