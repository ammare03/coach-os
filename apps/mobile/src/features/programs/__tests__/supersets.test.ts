import {
  isGroupableSelection,
  nextSupersetLetter,
  SUPERSET_BOUNDS,
  supersetMemberIds,
  supersetSlots,
  type GroupableBlock,
} from '../supersets.ts';

// The two decisions `program-builder/04` had to make, and the arithmetic
// under them: which letter a new group takes (and what happens when there
// is none left), and what counts as a groupable selection.

function day(...groups: (string | null)[]): GroupableBlock[] {
  return groups.map((supersetGroup, index) => ({ id: `block-${index}`, supersetGroup }));
}

describe('nextSupersetLetter', () => {
  it('takes A on a day with no groups', () => {
    expect(nextSupersetLetter(day(null, null, null))).toBe('A');
  });

  it('takes the first free letter, not one past the highest', () => {
    // B was ungrouped; the next group refills it rather than jumping to D.
    expect(nextSupersetLetter(day('A', 'A', 'C', 'C', null, null))).toBe('B');
  });

  // The ceiling. `superset_group` is one uppercase letter (DB§5.2), so a
  // day tops out at 26 groups — a generous limit that will not bind in
  // practice, and undefined behaviour if it is not decided.
  it('runs out of letters at 26 groups, and says so with null rather than repeating one', () => {
    const full = day(...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)));
    expect(full).toHaveLength(SUPERSET_BOUNDS.maxGroupsPerDay);
    expect(nextSupersetLetter(full)).toBeNull();
  });

  it('offers Z, and only Z, with 25 letters in use', () => {
    const nearlyFull = day(
      ...Array.from({ length: 25 }, (_, index) => String.fromCharCode(65 + index)),
    );
    expect(nextSupersetLetter(nearlyFull)).toBe('Z');
  });
});

describe('supersetSlots', () => {
  it('numbers members across the group and marks the run’s ends', () => {
    const slots = supersetSlots(day(null, 'A', 'A', 'A', null));

    expect(slots[0]).toBeNull();
    expect(slots[1]).toEqual({
      group: 'A',
      position: 1,
      memberCount: 3,
      isFirst: true,
      isLast: false,
    });
    expect(slots[2]?.position).toBe(2);
    expect(slots[3]).toEqual({
      group: 'A',
      position: 3,
      memberCount: 3,
      isFirst: false,
      isLast: true,
    });
  });

  // A day that already holds a split group — authored before this rule, or
  // by a client that predates it — must still render honestly rather than
  // restarting the numbering and pretending there are two group As.
  it('keeps one numbering across a group that has been split', () => {
    const slots = supersetSlots(day('A', null, 'A'));

    expect(slots[0]).toMatchObject({ position: 1, memberCount: 2, isFirst: true, isLast: true });
    expect(slots[2]).toMatchObject({ position: 2, memberCount: 2, isFirst: true, isLast: true });
  });
});

describe('supersetMemberIds', () => {
  it('names every member of the group, in the day’s order — what Ungroup A sends', () => {
    expect(supersetMemberIds(day('A', 'B', 'A'), 'A')).toEqual(['block-0', 'block-2']);
  });
});

describe('isGroupableSelection', () => {
  const blocks = day(null, null, null, 'B');

  it('refuses one block — a superset of one is not a superset', () => {
    expect(isGroupableSelection(blocks, new Set(['block-0']))).toBe(false);
  });

  it('accepts two blocks standing next to each other', () => {
    expect(isGroupableSelection(blocks, new Set(['block-0', 'block-1']))).toBe(true);
  });

  it('refuses two blocks with something between them', () => {
    expect(isGroupableSelection(blocks, new Set(['block-0', 'block-2']))).toBe(false);
  });

  it('refuses a block that is already in a group', () => {
    expect(isGroupableSelection(blocks, new Set(['block-2', 'block-3']))).toBe(false);
  });

  it('refuses a selection naming a block the day does not hold', () => {
    expect(isGroupableSelection(blocks, new Set(['block-0', 'block-1', 'gone']))).toBe(false);
  });
});
