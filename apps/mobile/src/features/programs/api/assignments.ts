import { MAX_PAGE_SIZE } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';

// The feature's whole tRPC call surface for `assignments.*`
// (`code-conventions` §1), sibling to `./programs.ts`.

/**
 * The assign sheet's whole client roster, in one call (`assignment/01`).
 * A coach's client count is bounded by their tier (2–75) — small enough to
 * read as "the roster" rather than a page of one, the same simplification
 * `ProgramTemplatesScreen`'s own `ScrollView` + `.map()` makes for a
 * coach's template count. Agency's "unlimited" tier is the one case this
 * single page doesn't cover; `assignment/02`'s bulk picker is the natural
 * place to revisit real keyset pagination if that edge turns out to
 * matter in practice.
 */
export function useAssignableClients() {
  return api.assignments.assignableClients.useQuery({ limit: MAX_PAGE_SIZE });
}

export type AssignableClient = NonNullable<
  ReturnType<typeof useAssignableClients>['data']
>['items'][number];

/** The single-client mode's write (`assignment/01`). `assignment/02` adds the bulk variant. */
export function useCreateAssignment() {
  return api.assignments.create.useMutation();
}

/** One of the two conflict resolutions the sheet offers. */
export function usePauseAssignment() {
  return api.assignments.pause.useMutation();
}

/** The other conflict resolution. */
export function useCompleteAssignment() {
  return api.assignments.complete.useMutation();
}
