import type { DbClient } from '@coachos/db';

import { listProgramBlocks, type UpcomingSessionExercise } from './program-blocks.ts';

// `workout_sessions.program_snapshot` — the prescription a session was
// STARTED with (`session-runtime/09`, DB§14.6).
//
// The rule it exists for: a session in progress is frozen. A coach editing
// Tuesday at 18:04 must not rewrite what a client is lifting at 18:03, and
// DB§14.3's "coach-authored data wins" — taken literally — would let them.
// This is a SEQUENCING rule, not a locking one: the coach's edit saves
// normally and lands on the client's NEXT session.
//
// Four decisions:
//
// (a) **Frozen at `started_at`, never at creation.** A session scheduled on
//     Monday and started on Thursday must pick up Tuesday's edit — the
//     client has not begun, so there is nothing to protect. Freezing at
//     materialisation would make a coach's edits useless for every session
//     generated in advance, which is all of them. So the write lives in
//     `./start.ts`, on the same UPDATE that makes the row `in_progress`.
//
// (b) **The prescription, not the program.** One day's blocks, in the shape
//     `./program-blocks.ts` already defines and `./upcoming.ts` already
//     serves. Keeping it to that is what makes writing it on every start
//     cheap, and reusing the shape is what stops the frozen and the live
//     copy from disagreeing about what a block even is.
//
// (c) **Numbers go in as numbers.** `./program-blocks.ts` parses `numeric`
//     at the boundary, so the JSONB document holds `60`, never `"60.00"`.
//     Nothing downstream re-parses — `readProgramSnapshot` refuses a
//     document that carries a string where a number belongs rather than
//     letting one through to render a target line the live path never
//     would.
//
// (d) **An unreadable snapshot degrades to "none".** The column is
//     server-written, so the guard is not defending against a hostile
//     client; it is defending against an OLD one — a row frozen by a build
//     that wrote a different envelope. Throwing would land in the middle of
//     a client's workout; degrading costs them nothing they can see,
//     because the live prescription is what they were being shown before
//     this feature existed.

/** Bumped only for a shape change the reader below cannot absorb. */
export const PROGRAM_SNAPSHOT_VERSION = 1;

/** The JSONB document, versioned so an old row is recognisable rather than half-read. */
export interface ProgramSnapshotEnvelope {
  version: number;
  exercises: UpcomingSessionExercise[];
}

export function wrapProgramSnapshot(exercises: UpcomingSessionExercise[]): ProgramSnapshotEnvelope {
  return { version: PROGRAM_SNAPSHOT_VERSION, exercises };
}

function isBlock(value: unknown): value is UpcomingSessionExercise {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  // The two ids the logger pages and matches on (`lib/exercise-pages.ts`
  // keys on `programExerciseId`; the target line matches on it too). A
  // block missing either is not renderable, so the document is not either.
  if (typeof candidate.programExerciseId !== 'string') return false;
  if (typeof candidate.exerciseId !== 'string') return false;

  for (const key of ['orderIndex', 'targetSets'] as const) {
    if (typeof candidate[key] !== 'number') return false;
  }
  for (const key of [
    'targetRepsMin',
    'targetRepsMax',
    'targetRpe',
    'targetRir',
    'targetWeightKg',
    'targetPercent1rm',
    'targetRestSeconds',
  ] as const) {
    const field = candidate[key];
    if (field !== null && typeof field !== 'number') return false;
  }
  if (!Array.isArray(candidate.alternatives)) return false;

  return true;
}

/**
 * The frozen prescription, or `null` when the column was never written or
 * cannot be read — decision (d).
 *
 * An empty array is a real answer and is NOT `null`: a coach may freeze a
 * day that has no blocks on it, and "frozen with nothing in it" has to stay
 * distinguishable from "never frozen", or a started empty day would fall
 * back to live and unfreeze itself.
 */
export function readProgramSnapshot(value: unknown): UpcomingSessionExercise[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== PROGRAM_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(candidate.exercises)) return null;
  return candidate.exercises.every(isBlock)
    ? (candidate.exercises as UpcomingSessionExercise[])
    : null;
}

/**
 * The document to freeze for one program day.
 *
 * `null` for a session with no `program_day_id` — an ad-hoc one, or one
 * whose day was deleted. There is no prescription to protect, so the column
 * stays null and the logger's fallback (live, which is also empty) is
 * already right.
 */
export async function buildProgramSnapshot(
  db: DbClient,
  programDayId: string | null,
): Promise<ProgramSnapshotEnvelope | null> {
  if (programDayId === null) return null;
  const byDay = await listProgramBlocks(db, [programDayId]);
  return wrapProgramSnapshot(byDay.get(programDayId) ?? []);
}
