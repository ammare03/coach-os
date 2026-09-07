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
