// Session volume — Σ (reps × weight) over the working sets of a session,
// in kilograms.
//
// `phase-09-workout-logger/today-card/01` needs it on the device (the
// completed card's Volume metric, DESIGN-SPEC §3.3) and DB§8.3 needs the
// same number server-side on completion. That is exactly the two-consumer
// case `code-conventions` §1 puts in `packages/utils`: one implementation,
// one test, so the coach's stored total and the client's card can never
// disagree by a rule.
//
// Kilograms in, kilograms out (`CLAUDE.md` hard rule). Nothing here knows
// `users.weight_unit` exists — `formatWeight` at the render edge does.

/** The three fields of a logged set the volume rule reads. */
export interface VolumeSet {
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

/**
 * Warm-up sets are excluded: they are ramp-up work the client did not
 * prescribe to themselves, and counting them makes a heavier warm-up look
 * like a harder session. Bodyweight and duration-only sets contribute
 * nothing rather than zero — a set with no weight recorded is unknown, not
 * weightless.
 *
 * Returns `null` when no working set carries both a rep count and a
 * weight, so a caller can omit the metric instead of rendering a `0` that
 * reads as "you lifted nothing" (`COPY.md` CO§2).
 */
export function sessionVolumeKg(sets: readonly VolumeSet[]): number | null {
  let total = 0;
  let counted = 0;

  for (const set of sets) {
    if (set.isWarmup) continue;
    if (set.reps === null || set.weightKg === null) continue;
    if (!Number.isFinite(set.reps) || !Number.isFinite(set.weightKg)) continue;
    total += set.reps * set.weightKg;
    counted += 1;
  }

  return counted === 0 ? null : total;
}

/** Working sets only — the `n` in "Set 8 of 22", and the `Sets` metric's numerator. */
export function countWorkingSets(sets: readonly { isWarmup: boolean }[]): number {
  return sets.reduce((count, set) => (set.isWarmup ? count : count + 1), 0);
}
