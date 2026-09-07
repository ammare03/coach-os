import { formatNumeric } from '@coachos/utils';

// The one place `program_exercises`' target columns cross the Drizzle
// boundary in either direction (`code-conventions` §3's "numeric trap":
// `target_rpe` and `target_percent_1rm` are `numeric(_,1)` and arrive as
// strings). Shared by create, update and the day read so a value written
// and the same value read back cannot disagree about its scale.

/** The `s` in `numeric(p, s)` for both intensity columns (DB§5.2). */
export const INTENSITY_SCALE = 1;

/**
 * Every DB§5.2 target column a coach sets, as the API accepts them.
 * `undefined` is "the coach did not set this", which the writers below
 * turn into a real `null` — the sheet always sends the whole block, so an
 * absent field is a cleared field, not an untouched one
 * (`packages/schemas`' `targetBlockShape`).
 */
export interface ProgramExerciseTargets {
  targetSets: number;
  targetRepsMin?: number | undefined;
  targetRepsMax?: number | undefined;
  targetRpe?: number | undefined;
  targetRir?: number | undefined;
  targetPercent1rm?: number | undefined;
  tempo?: string | undefined;
  targetRestSeconds?: number | undefined;
  coachNotes?: string | undefined;
}

/** The column values, with every absent field explicitly nulled. */
export function targetColumns(targets: ProgramExerciseTargets) {
  return {
    targetSets: targets.targetSets,
    targetRepsMin: targets.targetRepsMin ?? null,
    targetRepsMax: targets.targetRepsMax ?? null,
    targetRpe:
      targets.targetRpe === undefined ? null : formatNumeric(targets.targetRpe, INTENSITY_SCALE),
    targetRir: targets.targetRir ?? null,
    targetPercent1rm:
      targets.targetPercent1rm === undefined
        ? null
        : formatNumeric(targets.targetPercent1rm, INTENSITY_SCALE),
    tempo: targets.tempo ?? null,
    targetRestSeconds: targets.targetRestSeconds ?? null,
    // An emptied notes field is a cleared note, not an empty one — the
    // schema has already trimmed it, so this is the only case left.
    coachNotes:
      targets.coachNotes === undefined || targets.coachNotes === '' ? null : targets.coachNotes,
  };
}
