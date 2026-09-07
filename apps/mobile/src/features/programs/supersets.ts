import { programs as programsSchemas } from '@coachos/schemas';

import type { ProgramDayExercise } from './api/programs.ts';

// The superset model behind the day screen (`program-builder/04`, frame
// 1e) — pure, so every rule below is a unit test rather than a rendering.
//
// `superset_group` is one uppercase letter per DB§5.2, and that is the
// whole data model: no join table, no side state, no ordering column of its
// own. `program-builder/06`'s day duplication copies the column with the
// row and gets a working group for free, which is exactly why it stays that
// way.

const { minSupersetMembers, maxSupersetGroupsPerDay } = programsSchemas.PROGRAM_BOUNDS;
const { SUPERSET_LETTERS } = programsSchemas;

export const SUPERSET_BOUNDS = {
  minMembers: minSupersetMembers,
  maxGroupsPerDay: maxSupersetGroupsPerDay,
} as const;

/**
 * The two fields every helper here reads — narrowed from the inferred row
 * rather than redeclared, so a column rename reaches this file
 * (`code-conventions` §3). Blocks carry far more; none of it matters here.
 */
export type GroupableBlock = Pick<ProgramDayExercise, 'id' | 'supersetGroup'>;

/**
 * `'A' | … | 'Z'`, taken from the schema's own tuple rather than widened to
 * `string`: `setSupersetGroup` takes exactly these, so a letter that came
 * from anywhere else fails to compile at the call site instead of at the
 * database's regex.
 */
export type SupersetLetter = (typeof SUPERSET_LETTERS)[number];

/**
 * One block's place in its superset, or `null` for a standalone block.
 *
 * `position` counts across the whole DAY, not across the visual run: a
 * group that has somehow been split still reads `A1 … A2` rather than
 * restarting at `A1` twice, so the contradiction is visible instead of
 * being papered over. `isFirst`/`isLast` are about the RUN, because they
 * decide where the rail starts and stops.
 */
export interface SupersetSlot {
  group: string;
  position: number;
  memberCount: number;
  isFirst: boolean;
  isLast: boolean;
}

/** One block-for-block map of the day: a slot per grouped block, `null` per standalone one. */
export function supersetSlots(blocks: readonly GroupableBlock[]): (SupersetSlot | null)[] {
  const memberCounts = new Map<string, number>();
  for (const block of blocks) {
    if (block.supersetGroup === null) continue;
    memberCounts.set(block.supersetGroup, (memberCounts.get(block.supersetGroup) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return blocks.map((block, index) => {
    const group = block.supersetGroup;
    if (group === null) return null;
    const position = (seen.get(group) ?? 0) + 1;
    seen.set(group, position);
    return {
      group,
      position,
      memberCount: memberCounts.get(group) ?? 1,
      isFirst: blocks[index - 1]?.supersetGroup !== group,
      isLast: blocks[index + 1]?.supersetGroup !== group,
    };
  });
}

/** Every block carrying `group`, in the day's own order — what "Ungroup A" sends. */
export function supersetMemberIds(blocks: readonly GroupableBlock[], group: string): string[] {
  return blocks.filter((block) => block.supersetGroup === group).map((block) => block.id);
}

/**
 * The letter a new group would take: the first of the 26 this day is not
 * already using.
 *
 * **`null` is the ceiling, and it is not a silent no-op.** `superset_group`
 * holds one uppercase letter, so a day tops out at 26 groups; the commit
 * button goes inert and says so rather than sending a call that cannot
 * succeed. It is a generous ceiling that will not bind in practice — which
 * is the reason to define it, not a reason to leave it undefined.
 */
export function nextSupersetLetter(blocks: readonly GroupableBlock[]): SupersetLetter | null {
  const used = new Set(blocks.map((block) => block.supersetGroup));
  return SUPERSET_LETTERS.find((letter) => !used.has(letter)) ?? null;
}

/**
 * Whether a selection is a legal superset: at least two blocks, all of them
 * currently ungrouped, and consecutive in the day's order.
 *
 * Consecutiveness is checked here as well as at reorder time because a
 * superset means back-to-back execution (`CLAUDE.md` §26) — grouping blocks
 * with something between them would author the contradiction the reorder
 * constraint exists to prevent.
 */
export function isGroupableSelection(
  blocks: readonly GroupableBlock[],
  selectedIds: ReadonlySet<string>,
): boolean {
  const positions: number[] = [];
  blocks.forEach((block, index) => {
    if (selectedIds.has(block.id)) positions.push(index);
  });
  if (positions.length !== selectedIds.size) return false;
  if (positions.length < SUPERSET_BOUNDS.minMembers) return false;
  if (positions.some((index) => blocks[index]?.supersetGroup !== null)) return false;
  const lowest = positions[0] ?? 0;
  const highest = positions[positions.length - 1] ?? 0;
  return highest - lowest === positions.length - 1;
}
