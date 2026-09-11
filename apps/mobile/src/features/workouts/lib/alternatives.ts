import type { UpcomingExercise } from 'api/src/features/workouts/upcoming.ts';

import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';

import type { ExercisePage } from './exercise-pages.ts';
import { resolvePrescription } from './prescription.ts';

// `phase-09-workout-logger/session-modifications/02` — which exercises a
// client may swap this slot for, resolved from data already on the device.
//
// ================= THE ONE RULE THIS FILE EXISTS FOR ==================
//
// **The only source is this block's `program_exercises.alternatives`.**
//
// Not `exercises.search`, not the local exercise cache at large, and not
// either of them as a "just this once" fallback when the array comes back
// empty. §8.4's wording is "swap exercise (from coach-approved
// alternatives)", and a picker that can reach past that array lets a client
// substitute a movement their coach never sanctioned — which is task 02's
// named risk, stated in as many words. The empty case is handled by telling
// the client so (`components/SwapExerciseSheet.tsx`), never by widening the
// source.
//
// There is exactly one function here and it takes no query client, no
// search term, and no database handle. That is the enforcement: a search
// cannot be added to this path without changing its signature.
//
// ============================== OFFLINE ===============================
//
// No fetch, and nothing to fetch. `apps/api/src/features/workouts/
// upcoming.ts` decision (c) already puts every `alternatives` target into
// the payload's `exercises` array precisely so a coach-approved swap works
// with no signal, so this is a map lookup over data the pager is already
// rendering from.
//
// ========================= WHICH PRESCRIPTION =========================
//
// `resolvePrescription`, never `payload.session.exercises` directly — the
// frozen copy for a session in progress and the live day otherwise
// (`./prescription.ts`). A picker resolved from the live copy under a page
// built from the frozen one would offer the swaps of a block the client is
// not on.

/**
 * One exercise the coach approved as a substitute for a block — exactly what
 * a picker row shows, and nothing else.
 *
 * A `Pick` of the payload's own shape rather than a re-declaration, so a
 * change to `exercises` fails typecheck here (`code-conventions` §3). Narrow
 * on purpose: the row prints a name and a muscle, and handing it the demo
 * URL and the cue list would invite a second, heavier surface into a sheet
 * a client reads between two working sets.
 */
export type AlternativeExercise = Pick<UpcomingExercise, 'id' | 'name' | 'primaryMuscle'>;

const NO_ALTERNATIVES: readonly AlternativeExercise[] = [];

/**
 * The coach-approved swaps for this page's block, in the coach's own order.
 *
 * Empty for a block with no `alternatives`, for an ad-hoc session with no
 * block at all, and for a block whose targets are not in the payload's
 * exercise list — the last is a cache that did not carry what it should
 * have, and offering a row with no name is worse than offering nothing.
 * All three land on the same designed empty state, which is correct: from
 * the client's side there is nothing to pick either way.
 *
 * **Matched on `ExercisePage.key` (`program_exercises.id`)**, never on
 * `exerciseId`: a day may carry the same exercise twice with different
 * approved swaps, and a swapped page's `exerciseId` is the substitute's,
 * which no block names at all.
 */
export function resolveAlternatives(
  page: ExercisePage,
  payload: LocalSessionPayload | null,
): readonly AlternativeExercise[] {
  const block = resolvePrescription(payload).find(
    (candidate) => candidate.programExerciseId === page.key,
  );
  if (block === undefined || block.alternatives.length === 0) return NO_ALTERNATIVES;

  const byId = new Map((payload?.exercises ?? []).map((exercise) => [exercise.id, exercise]));

  const resolved: AlternativeExercise[] = [];
  for (const exerciseId of block.alternatives) {
    const exercise = byId.get(exerciseId);
    if (exercise === undefined) continue;
    resolved.push({
      id: exercise.id,
      name: exercise.name,
      primaryMuscle: exercise.primaryMuscle,
    });
  }
  return resolved;
}
