import { act, renderHook } from '@testing-library/react-native';

import { useProgramDayBuilder } from '../hooks/useProgramDayBuilder.ts';

// `session-runtime/09` step 5. The warning is only as good as the moment it
// is asked for, so what this file pins is WHICH writes ask: all six that can
// rewrite a prescription, not just the three that happen to share
// `invalidate`.

const DAY_ID = 'day-1';

let mockRefetch: jest.Mock;
let mockMidSessionData: { clientId: string; name: string; startedAt: Date }[] | undefined;

interface Handlers {
  onSuccess?: (...args: unknown[]) => unknown;
  onSettled?: (...args: unknown[]) => unknown;
}

// `mock`-prefixed and assigned from inside the factory's closures, never
// read while the factory itself runs — the only shape Jest's hoisting
// allows, and the one `./useProgramDayBuilder-reorder.test.ts` already uses.
let mockCaptured: Record<string, Handlers>;

jest.mock('../../../lib/trpc.ts', () => {
  const capture = (name: string) => ({
    useMutation: (options: unknown) => {
      mockCaptured[name] = (options ?? {}) as Handlers;
      return { mutate: jest.fn(), isPending: false };
    },
  });

  return {
    api: {
      programs: {
        get: { invalidate: jest.fn() },
        days: {
          get: { useQuery: () => ({ data: { programId: 'program-1' } }) },
          midSessionClients: {
            useQuery: () => ({ data: mockMidSessionData, refetch: mockRefetch }),
          },
        },
        exercises: {
          create: capture('create'),
          update: capture('update'),
          delete: capture('delete'),
          reorder: capture('reorder'),
          setSupersetGroup: capture('setSupersetGroup'),
          setAlternatives: capture('setAlternatives'),
        },
      },
      useUtils: () => ({
        programs: {
          get: { invalidate: jest.fn() },
          days: {
            get: {
              cancel: jest.fn(),
              invalidate: jest.fn(),
              getData: jest.fn(() => undefined),
              setData: jest.fn(),
            },
          },
        },
      }),
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptured = {};
  mockRefetch = jest.fn().mockResolvedValue({ data: [] });
  mockMidSessionData = undefined;
});

describe('useProgramDayBuilder — the mid-session warning', () => {
  it.each([
    ['create', 'onSuccess'],
    ['update', 'onSuccess'],
    ['delete', 'onSuccess'],
    ['reorder', 'onSettled'],
    ['setSupersetGroup', 'onSettled'],
    ['setAlternatives', 'onSettled'],
  ] as const)('asks who is mid-session after %s settles', async (mutation, hook) => {
    renderHook(() => useProgramDayBuilder(DAY_ID));

    const handler = mockCaptured[mutation]?.[hook];
    expect(handler).toBeDefined();
    await act(async () => {
      await handler?.({ exercises: [] }, { programDayId: DAY_ID });
    });

    // Every write that changes a prescription asks. A reorder changes what
    // a client would be shown next just as much as a target edit does, so
    // one that did not ask would leave the warning silently absent for
    // some saves — the worst of the three possible behaviours.
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('surfaces the names once the answer arrives', () => {
    mockMidSessionData = [
      { clientId: 'c1', name: 'Priya Nair', startedAt: new Date('2026-08-18T18:00:00.000Z') },
    ];

    const { result } = renderHook(() => useProgramDayBuilder(DAY_ID));

    expect(result.current.midSessionClientNames).toEqual(['Priya Nair']);
  });

  it('is empty before the query has ever run, and on a failed read', () => {
    // A warning that cannot be resolved must not become a second failure on
    // a screen whose save already succeeded.
    const { result } = renderHook(() => useProgramDayBuilder(DAY_ID));

    expect(result.current.midSessionClientNames).toEqual([]);
  });

  it('stays dismissed until the next save, then comes back', async () => {
    mockMidSessionData = [
      { clientId: 'c1', name: 'Priya Nair', startedAt: new Date('2026-08-18T18:00:00.000Z') },
    ];
    const { result } = renderHook(() => useProgramDayBuilder(DAY_ID));

    act(() => {
      result.current.dismissMidSessionWarning();
    });
    expect(result.current.midSessionClientNames).toEqual([]);

    // It reports a live fact, not an event: a save that is still true earns
    // the warning back rather than staying silenced for the session.
    await act(async () => {
      await mockCaptured.update?.onSuccess?.();
    });
    expect(result.current.midSessionClientNames).toEqual(['Priya Nair']);
  });
});
