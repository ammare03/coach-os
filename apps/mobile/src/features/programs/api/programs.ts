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
