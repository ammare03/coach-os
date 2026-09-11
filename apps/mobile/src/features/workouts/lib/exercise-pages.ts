import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import type { ExerciseSubstitution } from '../store/substituted-exercises-store.ts';

import { resolvePrescription } from './prescription.ts';

// The page model behind `components/ExercisePager.tsx` — one page per
// prescribed block, with the rail's badge, the page header's position line,
// and the superset run edges all derived here.
//
// **Pure, and deliberately outside the component** for the reason
// `programs/drag-reorder.ts` gives about the drag arithmetic: a grouping
// rule fused into a render is a rule you can only test by rendering. It is
// also what `session-runtime/04` (the target line) and `set-entry` will
// read to find the block they belong to, so the shape is stated once.
//
// **Not `programs/supersets.ts`.** That module is the coach's day builder
// and its `GroupableBlock` is keyed on `program_day_exercises.id`; a
// prescription on the device arrives as `UpcomingSessionExercise`, keyed on
// `programExerciseId`, with no `id` at all. The rule is the same one — one
// uppercase letter in `superset_group`, no join table (DB§5.2) — applied to
// the other shape. Promoting a shared helper is a `code-conventions` §1
// call for whichever task needs it in a third place.

/** What the client is shown for one prescribed exercise. */
export interface ExercisePage {
  /** `program_exercises.id` — stable across a re-render, unique within the session. */
  key: string;
  /**
   * What the client is actually doing — **the substitute's id once this slot
   * has been swapped** (`session-modifications/02`), the coach's own
   * otherwise. Every consumer that logs, reads history, or celebrates a
   * record keys on this, which is the whole reason the swap is folded in
   * here rather than at each of them.
   */
  exerciseId: string;
  /**
   * The library name, or one neutral word when the exercise cache missed
   * that id. A miss must stay pageable: a client mid-gym cannot refetch.
   */
  name: string;
  /**
   * The coach-authored exercise this slot was swapped away from, or `null`
   * for a slot showing what was programmed.
   *
   * The page's `targetSets` and `key` are deliberately untouched by a swap:
   * `key` is `program_exercises.id`, so `hooks/useExerciseTarget.ts` resolves
   * the coach's own block and the prescription carries over verbatim — task
   * 02's "no translation between movement patterns".
   */
  substitutedFor: { exerciseId: string; name: string } | null;
  /** 1-based — the "2" in "Exercise 2 of 6". */
  position: number;
  /** Every page carries the total, so a page can name its own place alone. */
  total: number;
  /** `program_exercises.superset_group`, one uppercase letter, or `null`. */
  supersetGroup: string | null;
  /** 1-based within the group, counted across the whole day. `null` when standalone. */
  supersetPosition: number | null;
  supersetMemberCount: number | null;
  /** `"A1"` for a superset member, else the 1-based position — what the rail stop shows. */
  badge: string;
  /**
   * Whether this page opens / closes a visual RUN of adjacent members.
   * The rail brackets a run; a group split by a standalone block reads as
   * two runs, which is the honest rendering of a contradiction.
   */
  isRunStart: boolean;
  isRunEnd: boolean;
  targetSets: number;
  /**
   * Working sets logged against this exercise, or `null` for "not known".
   *
   * `null` is not `0`. Nothing in `session-runtime` writes a set log —
   * `set-entry` does, and it owns both the count and its invalidation — so
   * until then the caller supplies no counts and the rail renders no
   * progress channel at all. A `0` here would claim nothing was logged.
   */
  setsLogged: number | null;
}

/** The neutral name for an exercise the device holds a block for but no library row. */
const UNKNOWN_EXERCISE_NAME = 'Exercise';

/**
 * One page per block, in `orderIndex` order.
 *
 * `counts` maps `exercises.id` to working sets logged in this session.
 * Omit it and every page's `setsLogged` is `null` — see the field's note.
 *
 * `substitutions` maps `ExercisePage.key` to the swap in force for that slot
 * (`session-modifications/02`). **This is the one place a swap is applied.**
 * The alternative — leaving the page describing the coach's exercise and
 * substituting inside the composer, the target line, the history read and
 * the record celebration separately — is four places that can disagree about
 * what the client is doing, on the screen where disagreeing puts the wrong
 * weight on a bar. Here, the page IS the substitute and every consumer
 * inherits it for free.
 */
export function buildExercisePages(
  payload: LocalSessionPayload | null,
  counts?: ReadonlyMap<string, number>,
  substitutions?: ReadonlyMap<string, ExerciseSubstitution>,
): ExercisePage[] {
  // `resolvePrescription`, not `payload.session.exercises` — task 09. A
  // session in progress pages through the copy frozen when it started, so
  // a coach removing an exercise at 18:04 cannot take a page out from
  // under a client on it at 18:03. `hooks/useExerciseTarget.ts` asks the
  // same function, which is what keeps a page and its target line
  // describing the same exercise.
  //
  // Still synchronous, and still empty for a null payload: the snapshot
  // arrives inside the payload this call already has, so it opens no new
  // window in which the page count is 0 for a session that has pages.
  const blocks = [...resolvePrescription(payload)].sort((a, b) => a.orderIndex - b.orderIndex);
  if (blocks.length === 0) return [];

  const names = new Map((payload?.exercises ?? []).map((exercise) => [exercise.id, exercise.name]));

  const memberCounts = new Map<string, number>();
  for (const block of blocks) {
    if (block.supersetGroup === null) continue;
    memberCounts.set(block.supersetGroup, (memberCounts.get(block.supersetGroup) ?? 0) + 1);
  }

  /**
   * Which exercise this slot is showing, after any swap.
   *
   * The stored substitute's name is preferred over the cache's: the client
   * chose it by that name in the picker, and an exercise that has since
   * fallen out of the cache must not silently become "Exercise" under them.
   */
  const subject = (
    block: (typeof blocks)[number],
  ): Pick<ExercisePage, 'exerciseId' | 'name' | 'substitutedFor'> => {
    const swap = substitutions?.get(block.programExerciseId);
    const programmedName = names.get(block.exerciseId) ?? UNKNOWN_EXERCISE_NAME;

    if (swap === undefined) {
      return { exerciseId: block.exerciseId, name: programmedName, substitutedFor: null };
    }
    return {
      exerciseId: swap.substituteExerciseId,
      name: names.get(swap.substituteExerciseId) ?? swap.substituteName,
      substitutedFor: { exerciseId: block.exerciseId, name: swap.originalName },
    };
  };

  const seen = new Map<string, number>();
  return blocks.map((block, index) => {
    const position = index + 1;
    const group = block.supersetGroup;
    // Counted against what the client is LOGGING, not what was programmed —
    // a swapped slot's sets are filed under the substitute's id.
    const shown = subject(block);

    if (group === null) {
      return {
        key: block.programExerciseId,
        ...shown,
        position,
        total: blocks.length,
        supersetGroup: null,
        supersetPosition: null,
        supersetMemberCount: null,
        badge: String(position),
        isRunStart: true,
        isRunEnd: true,
        targetSets: block.targetSets,
        setsLogged: counts ? (counts.get(shown.exerciseId) ?? 0) : null,
      };
    }

    // Counted across the DAY, not across the run: a group that has somehow
    // been split still reads A1 … A2 rather than restarting at A1 twice.
    const supersetPosition = (seen.get(group) ?? 0) + 1;
    seen.set(group, supersetPosition);

    return {
      key: block.programExerciseId,
      ...shown,
      position,
      total: blocks.length,
      supersetGroup: group,
      supersetPosition,
      supersetMemberCount: memberCounts.get(group) ?? 1,
      badge: `${group}${String(supersetPosition)}`,
      isRunStart: blocks[index - 1]?.supersetGroup !== group,
      isRunEnd: blocks[index + 1]?.supersetGroup !== group,
      targetSets: block.targetSets,
      setsLogged: counts ? (counts.get(shown.exerciseId) ?? 0) : null,
    };
  });
}

/**
 * An index the pager can actually render.
 *
 * Every entry point runs through this: a restored position from a session
 * whose coach has since removed an exercise, a caller's prop, and the
 * gesture's own result. `0` for an empty session rather than `-1`, because
 * the caller renders nothing at all in that case and a negative index would
 * reach a transform first.
 */
export function clampPageIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  const whole = Math.trunc(index);
  if (count <= 0) return 0;
  return Math.min(Math.max(whole, 0), count - 1);
}

/**
 * What a screen reader hears on a rail stop: the exercise, where it sits,
 * whether it is part of a superset, and how much of it is done.
 *
 * One string, so the stop reads as a single item rather than as three
 * fragments (`accessibility` §2).
 */
export function exerciseStopLabel(page: ExercisePage): string {
  const parts = [page.name, `exercise ${String(page.position)} of ${String(page.total)}`];

  if (page.supersetGroup !== null && page.supersetPosition !== null) {
    parts.push(
      `superset ${page.supersetGroup}`,
      `${String(page.supersetPosition)} of ${String(page.supersetMemberCount ?? 1)}`,
    );
  }

  if (page.setsLogged !== null) {
    parts.push(
      page.targetSets > 0
        ? `${String(page.setsLogged)} of ${String(page.targetSets)} sets logged`
        : `${String(page.setsLogged)} sets logged`,
    );
  }

  return parts.join(', ');
}

/** "Exercise 2 of 6" · "Exercise 4 of 5 · superset A" — the page's own eyebrow. */
export function exercisePositionLine(page: ExercisePage): string {
  const place = `Exercise ${String(page.position)} of ${String(page.total)}`;
  return page.supersetGroup === null ? place : `${place} · superset ${page.supersetGroup}`;
}
