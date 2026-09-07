import { programs as programsSchemas } from '@coachos/schemas';

import type { ProgramDayExercise } from './api/programs.ts';

// The approved-swaps model behind the sheet (`program-builder/05`, frame
// 1f) — pure, so every rule below is a unit test rather than a rendering.
//
// `program_exercises.alternatives` is a bare `uuid[]` with no foreign key
// (DB§5.2), which makes the server's write path the only integrity it has
// (`apps/api/src/features/programs/set-alternatives.ts`). Nothing here is a
// substitute for that. What lives here is the other half of the bargain the
// rest of this builder makes: a bound a coach can read before they hit it
// is guidance, and the same bound delivered as a rejection is a wall.

const { maxAlternatives } = programsSchemas.PROGRAM_BOUNDS;

export const ALTERNATIVE_BOUNDS = { maxApproved: maxAlternatives } as const;

/** One approved swap, as the day read resolves it — id plus the name a chip shows. */
export type ApprovedAlternative = ProgramDayExercise['alternatives'][number];

/**
 * The sentence under the picker, and the reason the commit goes inert at
 * the ceiling. Numerals, sentence case, no exclamation (`COPY.md` §CO6) —
 * and it states the limit as a fact rather than as a scolding, which is the
 * same shape "A day holds up to 30 exercises" takes on the day screen.
 */
export const ALTERNATIVES_LIMIT_HINT = `A block holds up to ${maxAlternatives} approved swaps.`;

/**
 * What the commit button says. It **counts** (`DESIGN.md` §10.8): a coach
 * about to save three swaps reads "Approve 3 swaps", never "Save".
 *
 * Saving an empty list is a real edit — it is how a coach takes the last
 * swap away — so it gets its own words rather than a "0 swaps" that reads
 * like a broken counter.
 */
export function approveActionLabel(selectedCount: number): string {
  if (selectedCount === 0) return 'Save with no swaps';
  return `Approve ${selectedCount} ${selectedCount === 1 ? 'swap' : 'swaps'}`;
}

/**
 * The read-only summary the target sheet shows beside its "Approved swaps"
 * eyebrow — the current answer, in the coach's own order, without opening
 * anything.
 *
 * Joined with ", " rather than assembled from sentence fragments: these are
 * exercise names, not clauses, so there is nothing here for a translator to
 * be handed out of order (`COPY.md` §CO6's localisation rule).
 */
export function approvedSummary(approved: readonly ApprovedAlternative[]): string | null {
  if (approved.length === 0) return null;
  return approved.map((exercise) => exercise.name).join(', ');
}

/**
 * The screen-reader sentence for the same summary. A comma-joined list is
 * read as one run-on by VoiceOver, so the count leads and the names follow
 * — "2 approved swaps: Hack Squat, Leg Press" (`accessibility` §2).
 */
export function approvedAccessibilityLabel(approved: readonly ApprovedAlternative[]): string {
  if (approved.length === 0) return 'No approved swaps yet';
  const names = approved.map((exercise) => exercise.name).join(', ');
  return `${approved.length} approved ${approved.length === 1 ? 'swap' : 'swaps'}: ${names}`;
}

/**
 * Adds or removes one exercise from the pending selection, preserving the
 * order the coach approved them in.
 *
 * **At the ceiling an unselected exercise is refused and the list comes
 * back unchanged**, so the caller's "already at the limit" branch and this
 * one cannot disagree about what happened. Deselecting always works — a
 * ceiling that traps a coach at the ceiling is worse than no ceiling.
 */
export function toggleAlternative(
  selected: readonly string[],
  exerciseId: string,
): readonly string[] {
  if (selected.includes(exerciseId)) {
    return selected.filter((id) => id !== exerciseId);
  }
  if (selected.length >= maxAlternatives) return selected;
  return [...selected, exerciseId];
}

/**
 * True when the pending list differs from what is saved — order included,
 * because the order is what the client's swap sheet lists them in and
 * reordering is therefore a real edit.
 *
 * The commit is inert while this is false: a coach who opened the sheet and
 * changed nothing has nothing to save, and offering to save it anyway
 * invites a pointless write.
 */
export function hasPendingChange(
  approved: readonly ApprovedAlternative[],
  selected: readonly string[],
): boolean {
  if (approved.length !== selected.length) return true;
  return approved.some((exercise, index) => exercise.id !== selected[index]);
}
