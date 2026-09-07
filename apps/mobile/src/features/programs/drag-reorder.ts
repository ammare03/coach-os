// The order model and the drop-resolution arithmetic behind
// `components/DraggableExerciseList.tsx` (`program-builder/03`, frame 1d).
//
// **Kept out of the gesture handler on purpose.** `program-builder/04` has
// to constrain where a block may land (a superset must stay contiguous), and
// a rule fused into a pan callback is a rule that can only be tested by
// synthesising touches. Everything here is a pure function of a list of row
// heights and one translation, so 04 can wrap `dropIndexFor` — or replace it
// — without reopening the gesture at all.
//
// Every geometry function carries the `'worklet'` directive: they run on the
// UI thread, inside the pan handler, once per frame. They are ordinary
// functions everywhere else, which is what makes them unit-testable.

/**
 * The gap between two rows, in points. The list renders rows in normal flow
 * with this much space between them; the arithmetic below needs the same
 * number, so it is stated once and imported by the component.
 */
export const ROW_GAP = 8;

/** The flow-order top edge of `index`, measured from the list's own top. */
export function rowTop(heights: readonly number[], gap: number, index: number): number {
  'worklet';
  let top = 0;
  for (let i = 0; i < index; i += 1) {
    top += (heights[i] ?? 0) + gap;
  }
  return top;
}

/**
 * Where the dragged row's top edge lands if it is released at `dropIndex`.
 *
 * Dropping ABOVE the origin pushes rows `dropIndex … activeIndex - 1` down,
 * so the vacated slot opens exactly where `dropIndex` used to start.
 * Dropping BELOW pulls rows `activeIndex + 1 … dropIndex` up by the dragged
 * row's own height, so the vacated slot ends where `dropIndex` used to end —
 * which is why the two branches are not symmetric when the rows have
 * different heights, and they do (a five-set block is taller than a
 * three-set one).
 */
export function slotTop(
  heights: readonly number[],
  gap: number,
  activeIndex: number,
  dropIndex: number,
): number {
  'worklet';
  if (dropIndex <= activeIndex) return rowTop(heights, gap, dropIndex);
  return rowTop(heights, gap, dropIndex) + (heights[dropIndex] ?? 0) - (heights[activeIndex] ?? 0);
}

/**
 * The index the dragged row would take if it were released now.
 *
 * Resolved by asking, for every candidate slot, where the row would end up
 * ({@link slotTop}) and picking the nearest — rather than by dividing the
 * translation by a row height, which is only correct when every row is the
 * same height. A list of at most 30 blocks makes this a 30-iteration loop
 * per frame on the UI thread, which is free, and it cannot disagree with the
 * placeholder the coach is looking at, because the placeholder is drawn from
 * the same function.
 */
export function dropIndexFor(
  heights: readonly number[],
  gap: number,
  activeIndex: number,
  translationY: number,
): number {
  'worklet';
  const draggedTop = rowTop(heights, gap, activeIndex) + translationY;
  let best = activeIndex;
  let bestDistance = -1;
  for (let index = 0; index < heights.length; index += 1) {
    const distance = Math.abs(slotTop(heights, gap, activeIndex, index) - draggedTop);
    if (bestDistance < 0 || distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * How far a row that is NOT being dragged has to move out of the way while
 * the dragged row hovers over `dropIndex`. Zero for every row the drag has
 * not passed, which is most of them.
 */
export function rowShift(
  heights: readonly number[],
  gap: number,
  activeIndex: number,
  dropIndex: number,
  rowIndex: number,
): number {
  'worklet';
  if (rowIndex === activeIndex) return 0;
  const displaced = (heights[activeIndex] ?? 0) + gap;
  if (dropIndex > activeIndex && rowIndex > activeIndex && rowIndex <= dropIndex) {
    return -displaced;
  }
  if (dropIndex < activeIndex && rowIndex >= dropIndex && rowIndex < activeIndex) {
    return displaced;
  }
  return 0;
}

/**
 * The list with one item moved. Returns the SAME array when the move is a
 * no-op, so a drop that lands where it started sends no mutation.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Re-sorts a day's blocks into `orderedIds` and renumbers `orderIndex` to
 * match — the optimistic cache write, and the same shape the server settles
 * on (`apps/api/src/features/programs/reorder-program-exercises.ts` assigns
 * `1 … N` with no gaps).
 *
 * Any block `orderedIds` does not name keeps its place at the end rather
 * than disappearing: a partial list is refused by the server, and a client
 * that silently dropped rows while waiting to be told so would flash them
 * out and back in.
 */
export function applyOrder<T extends { id: string; orderIndex: number }>(
  blocks: readonly T[],
  orderedIds: readonly string[],
): T[] {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  return [...blocks]
    .sort(
      (a, b) =>
        (position.get(a.id) ?? orderedIds.length) - (position.get(b.id) ?? orderedIds.length),
    )
    .map((block, index) => ({ ...block, orderIndex: index + 1 }));
}

// ── Superset adjacency (`program-builder/04`) ──────────────────────────────
//
// **The decision: adjacency is ENFORCED at drop time, not warned about
// afterwards.** A superset means back-to-back execution (`CLAUDE.md` §26),
// so an order that puts something between two members leaves
// `superset_group` asserting something the list contradicts. Of the four
// options the task weighs — block, warn, auto-ungroup, or auto-move the
// whole group — only blocking keeps the data and the picture in agreement
// at every instant. A warning ships the contradiction and then asks the
// coach to accept it; auto-ungrouping destroys authored intent as a side
// effect of a move that was probably a mis-drop.
//
// It is enforced by *constraining where the card may land*, so the dashed
// placeholder never appears in an illegal slot — the coach sees the rule
// instead of being told about it (frame 1's decision (e), "prevented, not
// reported"). The server carries the same rule as a floor under a stale or
// patched client
// (`apps/api/src/features/programs/reorder-program-exercises.ts`).

/** Whether `letter` occupies one unbroken run of `groups`. */
function isRunContiguous(groups: readonly (string | null)[], letter: string): boolean {
  'worklet';
  let first = -1;
  let last = -1;
  let count = 0;
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index] !== letter) continue;
    if (first < 0) first = index;
    last = index;
    count += 1;
  }
  return count === 0 || last - first + 1 === count;
}

/**
 * Whether moving `from` to `to` leaves every superset that holds together
 * now still holding together.
 *
 * Compared before-and-after rather than demanded outright, and for the same
 * reason the server does it that way: a day that somehow already holds a
 * split group has to stay reorderable, or one bad row freezes the day.
 */
export function keepsSupersetsTogether(
  groups: readonly (string | null)[],
  from: number,
  to: number,
): boolean {
  'worklet';
  if (from === to) return true;

  // The moved list, built without `splice` so the whole function stays a
  // single pass a worklet can run on the UI thread.
  const after: (string | null)[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    if (after.length === to) after.push(groups[from] ?? null);
    if (index !== from) after.push(groups[index] ?? null);
  }
  if (after.length === groups.length - 1) after.push(groups[from] ?? null);

  for (let index = 0; index < groups.length; index += 1) {
    const letter = groups[index];
    if (letter === null || letter === undefined) continue;
    // Each letter is judged once, at its first appearance.
    let alreadySeen = false;
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (groups[earlier] === letter) {
        alreadySeen = true;
        break;
      }
    }
    if (alreadySeen) continue;
    if (isRunContiguous(groups, letter) && !isRunContiguous(after, letter)) return false;
  }
  return true;
}

/**
 * {@link dropIndexFor}, wrapped: the nearest slot that does not split a
 * superset, falling outward from the one the finger is actually over.
 *
 * `activeIndex` is always legal (a move to where you started is no move),
 * so the search always terminates.
 */
export function constrainedDropIndexFor(
  heights: readonly number[],
  gap: number,
  groups: readonly (string | null)[],
  activeIndex: number,
  translationY: number,
): number {
  'worklet';
  const wanted = dropIndexFor(heights, gap, activeIndex, translationY);
  if (keepsSupersetsTogether(groups, activeIndex, wanted)) return wanted;
  for (let step = 1; step < heights.length; step += 1) {
    const below = wanted - step;
    if (below >= 0 && keepsSupersetsTogether(groups, activeIndex, below)) return below;
    const above = wanted + step;
    if (above < heights.length && keepsSupersetsTogether(groups, activeIndex, above)) return above;
  }
  return activeIndex;
}

/**
 * The nearest index in `direction` that a move to would not split a
 * superset — `from` itself when there is none, which is "this block cannot
 * go that way at all".
 *
 * The screen-reader path steps a block one position at a time, and one
 * position is exactly the move that lands inside a group. Rather than
 * refusing it (which would strand a block below a superset it can never
 * get past without a drag), the step JUMPS the whole group. `accessibility`
 * §7's rule is that every gesture has a button equivalent, and an
 * equivalent that cannot reach half the list is not one.
 */
export function nextLegalIndex(
  groups: readonly (string | null)[],
  from: number,
  direction: 1 | -1,
): number {
  for (let index = from + direction; index >= 0 && index < groups.length; index += direction) {
    if (keepsSupersetsTogether(groups, from, index)) return index;
  }
  return from;
}
