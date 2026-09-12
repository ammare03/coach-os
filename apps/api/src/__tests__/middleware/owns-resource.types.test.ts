// The compile-time half of `03-owns-resource.md` step 8, and
// `phase-10-coach-review-surfaces/coach-notes/`'s first feature acceptance
// criterion: "a `clientProcedure` cannot be given a `coachNote` guard
// without failing typecheck".
//
// Nothing here runs a query — `tsc` is the assertion. Every `@ts-expect-error`
// below is load-bearing in both directions: if the constraint regresses, the
// suppressed line stops erroring and TS reports TS2578 ("Unused
// '@ts-expect-error' directive"), which fails `pnpm typecheck` in this
// package. That is the whole fixture. The positive controls beside them are
// the other half — a guard that rejected *everything* would satisfy the
// negatives and break the product, so each one is paired with the
// composition that must keep compiling.
//
// This is the third lock on `coach_client_notes`, not a replacement for
// either of the first two: `hasRole` still rejects the wrong role at
// runtime, and `resolveOwnership` still throws `ROLE_REQUIRED` for a kind
// with no client branch (exercised in `owns-resource.test.ts`).
import { z } from 'zod';

import {
  RESOURCE_REGISTRY,
  type CoachOnlyResourceKind,
  type SharedResourceKind,
} from '../../trpc/authz/resource-registry.ts';
import {
  clientProcedure,
  coachOrClientProcedure,
  coachProcedure,
  ownsResource,
  protectedProcedure,
} from '../../trpc/procedures.ts';

const noteInput = z.object({ coachNoteId: z.string() });
const sessionInput = z.object({ workoutSessionId: z.string() });

const noteId = (i: { coachNoteId: string }) => i.coachNoteId;
const sessionId = (i: { workoutSessionId: string }) => i.workoutSessionId;

// --- must compile -----------------------------------------------------------

// A coach-only kind on the builder that has narrowed `role` to `'coach'`.
export const coachNoteOnCoach = coachProcedure
  .input(noteInput)
  .use(ownsResource('coachNote', noteId))
  .query(() => ({ ok: true }));

// A shared kind on each of the three builders that admit a client. These are
// what prove the constraint is about the *kind*, not about tightening
// `ownsResource` for everyone.
export const sessionOnClient = clientProcedure
  .input(sessionInput)
  .use(ownsResource('workoutSession', sessionId))
  .query(() => ({ ok: true }));

export const sessionOnEither = coachOrClientProcedure
  .input(sessionInput)
  .use(ownsResource('workoutSession', sessionId))
  .query(() => ({ ok: true }));

export const sessionOnProtected = protectedProcedure
  .input(sessionInput)
  .use(ownsResource('workoutSession', sessionId))
  .query(() => ({ ok: true }));

// --- must NOT compile -------------------------------------------------------

// The criterion itself.
export const coachNoteOnClient = clientProcedure
  .input(noteInput)
  // @ts-expect-error `coachNote` is coach-only — it may not be guarded on `clientProcedure`
  .use(ownsResource('coachNote', noteId))
  .query(() => ({ ok: true }));

// `coachOrClientProcedure` admits a client, so it is refused for the same
// reason — a guard that can only ever throw for half its callers is a bug the
// type system can see.
export const coachNoteOnEither = coachOrClientProcedure
  .input(noteInput)
  // @ts-expect-error `coachNote` is coach-only — `coachOrClientProcedure` admits a client
  .use(ownsResource('coachNote', noteId))
  .query(() => ({ ok: true }));

// `protectedProcedure` never narrows `role` at all, so it is refused too.
export const coachNoteOnProtected = protectedProcedure
  .input(noteInput)
  // @ts-expect-error `coachNote` is coach-only — `protectedProcedure` does not narrow the role
  .use(ownsResource('coachNote', noteId))
  .query(() => ({ ok: true }));

// --- the derivation itself --------------------------------------------------

// Assignability, not equality: these pin that the two unions came out of the
// registry populated rather than as `never`/everything. A `never`
// `CoachOnlyResourceKind` (what re-annotating `RESOURCE_REGISTRY` with
// `Record<...>` would produce) fails here *and* unuses all three suppressions
// above.
const coachOnlyIncludesCoachNote: CoachOnlyResourceKind = 'coachNote';
const sharedIncludesWorkoutSession: SharedResourceKind = 'workoutSession';

describe('ownsResource kind/role typing', () => {
  it('derives the coach-only kinds from the registry, not from a second list', () => {
    const derivedAtRuntime = Object.entries(RESOURCE_REGISTRY)
      .filter(([, entry]) => entry.clientOwnedIds === null)
      .map(([kind]) => kind)
      .sort();

    // Not the definition — the definition is `clientOwnedIds: null` on each
    // entry. This is a tripwire: a kind losing or gaining a client branch is
    // an authorisation change and should never pass review unnoticed. Expect
    // to edit this line when P07 gives the four `program*` kinds their client
    // branch through `assignment`.
    expect(derivedAtRuntime).toEqual([
      'coachNote',
      'invite',
      'program',
      'programDay',
      'programExercise',
      'programWeek',
    ]);
  });

  it('agrees with the compile-time union', () => {
    expect([coachOnlyIncludesCoachNote, sharedIncludesWorkoutSession]).toEqual([
      'coachNote',
      'workoutSession',
    ]);
  });
});
