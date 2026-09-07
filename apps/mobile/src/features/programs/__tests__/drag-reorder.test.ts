import {
  applyOrder,
  constrainedDropIndexFor,
  dropIndexFor,
  keepsSupersetsTogether,
  moveItem,
  nextLegalIndex,
  ROW_GAP,
  rowShift,
  rowTop,
  slotTop,
} from '../drag-reorder.ts';

// The drop resolution, tested as arithmetic rather than through synthesised
// touches — which is the reason it lives outside the gesture handler at all
// (`program-builder/03`; `program-builder/04` constrains these same
// functions for supersets).
//
// The heights are deliberately UNEQUAL. A list of identical rows lets a
// wrong implementation — one that divides the translation by a single row
// height — pass every case, and a day's blocks are genuinely different
// heights: a five-set block is taller than a three-set one, and a block
// with coach notes is taller again.

const GAP = 8;
/** Tops, with GAP = 8: 0, 108, 188, 316, 404. */
const HEIGHTS = [100, 72, 120, 80, 60];

describe('rowTop', () => {
  it('accumulates heights and gaps', () => {
    expect([0, 1, 2, 3, 4].map((index) => rowTop(HEIGHTS, GAP, index))).toEqual([
      0, 108, 188, 316, 404,
    ]);
  });
});

describe('slotTop', () => {
  it('is the row’s own top when nothing moves', () => {
    expect(slotTop(HEIGHTS, GAP, 2, 2)).toBe(rowTop(HEIGHTS, GAP, 2));
  });

  it('lands on the target’s old top when moving up', () => {
    // Row 3 dropped at 1: rows 1 and 2 slide down, and the gap opens exactly
    // where row 1 used to start.
    expect(slotTop(HEIGHTS, GAP, 3, 1)).toBe(108);
  });

  // The asymmetry the equal-height version of this gets wrong: moving down,
  // the gap opens at the END of the target row, so the dragged row's own
  // height is what decides where its top lands.
  it('lands so the row ends where the target ended when moving down', () => {
    const activeIndex = 0;
    const dropIndex = 3;
    const top = slotTop(HEIGHTS, GAP, activeIndex, dropIndex);

    expect(top + (HEIGHTS[activeIndex] ?? 0)).toBe(
      rowTop(HEIGHTS, GAP, dropIndex) + (HEIGHTS[dropIndex] ?? 0),
    );
    expect(top).toBe(316 + 80 - 100);
  });
});

describe('dropIndexFor', () => {
  it('holds its own index while the drag has barely moved', () => {
    expect(dropIndexFor(HEIGHTS, GAP, 2, 0)).toBe(2);
    expect(dropIndexFor(HEIGHTS, GAP, 2, 6)).toBe(2);
    expect(dropIndexFor(HEIGHTS, GAP, 2, -6)).toBe(2);
  });

  it('resolves to the slot whose landing position is nearest', () => {
    // Row 0 dragged down by exactly the distance to slot 3's landing spot.
    expect(dropIndexFor(HEIGHTS, GAP, 0, slotTop(HEIGHTS, GAP, 0, 3))).toBe(3);
    // …and to slot 1 for the distance to slot 1's.
    expect(dropIndexFor(HEIGHTS, GAP, 0, slotTop(HEIGHTS, GAP, 0, 1))).toBe(1);
  });

  it('clamps at both ends rather than resolving off the list', () => {
    expect(dropIndexFor(HEIGHTS, GAP, 2, -5000)).toBe(0);
    expect(dropIndexFor(HEIGHTS, GAP, 2, 5000)).toBe(HEIGHTS.length - 1);
  });

  it('is self-consistent with the placeholder for every from/to pair', () => {
    for (let from = 0; from < HEIGHTS.length; from += 1) {
      for (let to = 0; to < HEIGHTS.length; to += 1) {
        const translation = slotTop(HEIGHTS, GAP, from, to) - rowTop(HEIGHTS, GAP, from);
        expect(dropIndexFor(HEIGHTS, GAP, from, translation)).toBe(to);
      }
    }
  });

  it('survives a list whose heights have not all been measured yet', () => {
    expect(dropIndexFor([], GAP, 0, 40)).toBe(0);
  });
});

describe('rowShift', () => {
  it('moves nothing when the drop index is the origin', () => {
    expect([0, 1, 2, 3, 4].map((row) => rowShift(HEIGHTS, GAP, 2, 2, row))).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it('pulls the rows the drag passed on the way down up by the dragged row’s height', () => {
    // Row 0 (100 tall) hovering over 3: rows 1..3 come up by 108, 4 stays.
    expect([0, 1, 2, 3, 4].map((row) => rowShift(HEIGHTS, GAP, 0, 3, row))).toEqual([
      0, -108, -108, -108, 0,
    ]);
  });

  it('pushes the rows the drag passed on the way up down by the dragged row’s height', () => {
    // Row 3 (80 tall) hovering over 1: rows 1 and 2 go down by 88.
    expect([0, 1, 2, 3, 4].map((row) => rowShift(HEIGHTS, GAP, 3, 1, row))).toEqual([
      0, 88, 88, 0, 0,
    ]);
  });
});

describe('moveItem', () => {
  const ITEMS = ['a', 'b', 'c', 'd'];

  it('moves an item down and up', () => {
    expect(moveItem(ITEMS, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(ITEMS, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(ITEMS, 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  // Identity, not a copy: the caller uses it to decide whether to send a
  // mutation at all, so a no-op drop has to be recognisable by reference.
  it('returns the same array for a move that changes nothing', () => {
    expect(moveItem(ITEMS, 2, 2)).toBe(ITEMS);
    expect(moveItem(ITEMS, 0, 9)).toBe(ITEMS);
    expect(moveItem(ITEMS, -1, 0)).toBe(ITEMS);
  });
});

describe('applyOrder', () => {
  const BLOCKS = [
    { id: 'a', orderIndex: 1 },
    { id: 'b', orderIndex: 2 },
    { id: 'c', orderIndex: 5 },
  ];

  it('re-sorts and renumbers to a gapless 1..N, exactly as the server settles', () => {
    expect(applyOrder(BLOCKS, ['c', 'a', 'b'])).toEqual([
      { id: 'c', orderIndex: 1 },
      { id: 'a', orderIndex: 2 },
      { id: 'b', orderIndex: 3 },
    ]);
  });

  it('does not mutate its input', () => {
    applyOrder(BLOCKS, ['c', 'b', 'a']);

    expect(BLOCKS.map((block) => block.id)).toEqual(['a', 'b', 'c']);
    expect(BLOCKS[2]?.orderIndex).toBe(5);
  });

  it('keeps a block the order does not name rather than dropping it', () => {
    expect(applyOrder(BLOCKS, ['b', 'a']).map((block) => block.id)).toEqual(['b', 'a', 'c']);
  });
});

// `program-builder/04`'s adjacency decision: a drop that would pull a
// superset member out from between its partners is not offered at all. The
// placeholder is drawn from `slotTop` at the same index this returns, so a
// slot that cannot be reached also cannot be shown.

describe('keepsSupersetsTogether', () => {
  const groups = [null, 'A', 'A', null, null];

  it('allows a move that leaves the group intact', () => {
    // The last block to the front: A is still 2-3 in the new order.
    expect(keepsSupersetsTogether(groups, 4, 3)).toBe(true);
  });

  it('refuses moving an outsider into the middle of a group', () => {
    expect(keepsSupersetsTogether(groups, 4, 2)).toBe(false);
  });

  it('refuses pulling a member out of its group', () => {
    expect(keepsSupersetsTogether(groups, 1, 4)).toBe(false);
  });

  it('allows swapping two members inside their own group', () => {
    expect(keepsSupersetsTogether(groups, 1, 2)).toBe(true);
  });

  it('allows the whole group to be walked past — the pair still lands together', () => {
    expect(keepsSupersetsTogether([null, 'A', 'A'], 0, 2)).toBe(true);
  });

  // A day that somehow already holds a split group has to stay reorderable,
  // or one bad row freezes it forever. Only a group that holds together NOW
  // and would not afterwards is refused.
  it('does not freeze a day whose group is already split', () => {
    expect(keepsSupersetsTogether(['A', null, 'A'], 1, 0)).toBe(true);
  });
});

describe('constrainedDropIndexFor', () => {
  const heights = [100, 100, 100, 100, 100];
  const groups = [null, 'A', 'A', null, null];

  it('returns the slot under the finger when it is legal', () => {
    // The last row dragged up by three rows lands at index 1... which would
    // split A, so the nearest legal slot is offered instead. A drag of one
    // row up is legal outright.
    expect(constrainedDropIndexFor(heights, ROW_GAP, groups, 4, -108)).toBe(3);
  });

  it('falls to the nearest legal slot rather than splitting a superset', () => {
    // Dead over index 2 — inside the group. The nearest legal landing is
    // index 3 (just after it) or 1 (just before it); either keeps A whole.
    const landed = constrainedDropIndexFor(heights, ROW_GAP, groups, 4, -216);
    expect([1, 3]).toContain(landed);
    expect(keepsSupersetsTogether(groups, 4, landed)).toBe(true);
  });

  it('never returns a slot that would split a superset, wherever the finger is', () => {
    for (let active = 0; active < heights.length; active += 1) {
      for (let translation = -500; translation <= 500; translation += 25) {
        const landed = constrainedDropIndexFor(heights, ROW_GAP, groups, active, translation);
        expect(keepsSupersetsTogether(groups, active, landed)).toBe(true);
      }
    }
  });
});

// The button path — the one a VoiceOver or TalkBack user takes — has to
// reach every position the drag reaches, or the equivalence
// `accessibility` §7 asks for is only half true.
describe('nextLegalIndex', () => {
  const groups = [null, 'A', 'A', null];

  it('takes the ordinary next position on a day with no groups at all', () => {
    expect(nextLegalIndex([null, null, null], 2, -1)).toBe(1);
  });

  it('jumps a group the block would otherwise land inside', () => {
    // Index 3 stepping up lands at 2 — between A's two members — so it
    // goes to 1 instead, past the group entirely.
    expect(nextLegalIndex(groups, 3, -1)).toBe(1);
  });

  it('jumps the whole group rather than refusing to step into it', () => {
    // Block 0 stepping down would land at 1, inside A. It goes to 2 — the
    // far side — so the group stays whole and the block still moves.
    expect(nextLegalIndex(groups, 0, 1)).toBe(2);
  });

  it('returns the block’s own index when there is nowhere legal that way', () => {
    expect(nextLegalIndex(groups, 0, -1)).toBe(0);
  });

  it('jumps the group upwards too', () => {
    expect(nextLegalIndex(['A', 'A', null], 2, -1)).toBe(0);
  });

  it('lets a member step inside its own group', () => {
    expect(nextLegalIndex(groups, 1, 1)).toBe(2);
  });
});
