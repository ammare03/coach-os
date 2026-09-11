import { api } from '../../../lib/trpc.ts';

// The feature's whole tRPC call surface for `programs.*`
// (`code-conventions` §1 — a feature talks to the API through one module,
// so a query key or an invalidation rule has exactly one place to live).
// No component calls `api.programs.*` directly.

/** The builder's single read: program → weeks → days, in one round trip. */
export function useProgram(programId: string, enabled = true) {
  return api.programs.get.useQuery({ programId }, { enabled });
}

/**
 * One week of the hierarchy, inferred from the procedure rather than
 * declared (`code-conventions` §3). Tasks 02-06 receive these and should
 * name the types rather than restate their fields.
 */
export type ProgramDetail = NonNullable<ReturnType<typeof useProgram>['data']>;
export type ProgramWeek = ProgramDetail['weeks'][number];
export type ProgramDay = ProgramWeek['days'][number];

/** One day of the program, with its exercises — the day screen's single read. */
export function useProgramDay(programDayId: string, enabled = true) {
  return api.programs.days.get.useQuery({ programDayId }, { enabled });
}

/**
 * Who is inside this day right now (`session-runtime/09` step 5).
 *
 * `enabled: false` by default and refetched on demand: the answer only
 * matters at the instant a coach saves, and a day screen left open would
 * otherwise poll a question nobody asked. `staleTime: 0` so the refetch
 * after a save is a real request rather than a cache hit from the last one
 * — a client who finished in between must drop off the warning.
 */
export function useMidSessionClients(programDayId: string) {
  return api.programs.days.midSessionClients.useQuery(
    { programDayId },
    { enabled: false, staleTime: 0, gcTime: 0 },
  );
}

export type ProgramDayDetail = NonNullable<ReturnType<typeof useProgramDay>['data']>;
export type ProgramDayExercise = ProgramDayDetail['exercises'][number];
export type ProgramDaySlot = ProgramDayDetail['siblingDays'][number];

/**
 * The Programs tab's default view (`program-templates/01`). Keyset-paginated
 * — `code-conventions` §5, `ui-conventions` §6 — most-recently-edited page
 * first, exactly as `programs.listTemplates` orders it server-side.
 */
export function useProgramTemplates() {
  return api.programs.listTemplates.useInfiniteQuery(
    {},
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );
}

export type ProgramTemplate = NonNullable<
  ReturnType<typeof useProgramTemplates>['data']
>['pages'][number]['items'][number];

/** The "New program" sheet's write, whichever entry point opened it. */
export function useCreateProgram() {
  return api.programs.create.useMutation();
}
