import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { ProgramDayExercise } from '../../api/programs.ts';
import { DraggableExerciseList } from '../DraggableExerciseList.tsx';

// The rows this list carries read the coach's display unit from `me.get`
// (`ExerciseBlock`); this file is about the drag, not about tRPC.
jest.mock('../../../../hooks/useWeightUnit.ts', () => ({ useWeightUnit: () => 'kg' }));

// What this file holds: **a drag-and-drop list has to be operable without
// dragging** (`accessibility` §7 — never a gesture with no button
// equivalent). The pan itself runs on the UI thread through Reanimated
// worklets and is verified on hardware; what is asserted here is the path a
// VoiceOver or TalkBack user takes, the announcement they get, and the fact
// that a move sends the day's COMPLETE new order rather than a diff.

function block(
  id: string,
  name: string,
  orderIndex: number,
  supersetGroup: string | null = null,
): ProgramDayExercise {
  return {
    id,
    exerciseId: `exercise-${id}`,
    orderIndex,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: 7,
    targetRir: null,
    targetPercent1rm: null,
    targetWeightKg: null,
    targetRestSeconds: 90,
    tempo: null,
    supersetGroup,
    coachNotes: null,
    exerciseName: name,
    exercisePrimaryMuscle: 'quads',
    exerciseEquipment: 'barbell',
    exerciseMovementPattern: 'squat',
    alternatives: [],
  };
}

const BLOCKS = [
  block('a', 'Barbell Back Squat', 1),
  block('b', 'Romanian Deadlift', 2),
  block('c', 'Walking Lunge', 3),
];

function renderList(blocks: ProgramDayExercise[] = BLOCKS) {
  const onReorder = jest.fn();
  const onOpenBlock = jest.fn();
  const onDragActiveChange = jest.fn();
  render(
    <DraggableExerciseList
      blocks={blocks}
      onReorder={onReorder}
      onOpenBlock={onOpenBlock}
      onDragActiveChange={onDragActiveChange}
    />,
  );
  return { onReorder, onOpenBlock, onDragActiveChange };
}

/** The same list in selection mode, with the selection driven from outside. */
function renderSelecting(blocks: ProgramDayExercise[], selectedIds: string[] = []) {
  const onToggle = jest.fn();
  const onUngroup = jest.fn();
  const onOpenBlock = jest.fn();
  render(
    <DraggableExerciseList
      blocks={blocks}
      onReorder={jest.fn()}
      onOpenBlock={onOpenBlock}
      onUngroup={onUngroup}
      selection={{ selectedIds: new Set(selectedIds), onToggle }}
    />,
  );
  return { onToggle, onUngroup, onOpenBlock };
}

function move(id: string, actionName: 'increment' | 'decrement') {
  fireEvent(screen.getByTestId(`reorder-handle-${id}`), 'accessibilityAction', {
    nativeEvent: { actionName },
  });
}

describe('DraggableExerciseList', () => {
  it('gives every row a handle that announces its position in the day', () => {
    renderList();

    expect(screen.getByTestId('reorder-handle-a').props.accessibilityRole).toBe('adjustable');
    expect(screen.getByTestId('reorder-handle-a').props.accessibilityLabel).toBe(
      'Position of Barbell Back Squat',
    );
    expect(screen.getByTestId('reorder-handle-b').props.accessibilityValue).toEqual({
      min: 1,
      max: 3,
      now: 2,
      text: '2 of 3',
    });
  });

  it('offers only the moves that exist at each end of the list', () => {
    renderList();

    const names = (id: string) =>
      (
        screen.getByTestId(`reorder-handle-${id}`).props.accessibilityActions as {
          name: string;
        }[]
      ).map((action) => action.name);

    expect(names('a')).toEqual(['increment']);
    expect(names('b')).toEqual(['decrement', 'increment']);
    expect(names('c')).toEqual(['decrement']);
  });

  it('offers no move at all on a one-block day', () => {
    renderList([block('a', 'Barbell Back Squat', 1)]);

    expect(screen.getByTestId('reorder-handle-a').props.accessibilityActions).toEqual([]);
  });

  // The whole non-gesture path, and the tap target it needs.
  it('moves a block down and up without a drag, sending the complete new order', () => {
    const { onReorder } = renderList();

    move('a', 'increment');
    expect(onReorder).toHaveBeenLastCalledWith(['b', 'a', 'c']);

    move('c', 'decrement');
    expect(onReorder).toHaveBeenLastCalledWith(['a', 'c', 'b']);
  });

  it('sends nothing when the move would fall off either end', () => {
    const { onReorder } = renderList();

    move('a', 'decrement');
    move('c', 'increment');

    expect(onReorder).not.toHaveBeenCalled();
  });

  // An optimistic reorder is silent, and silence is invisible to a screen
  // reader (`accessibility` §2).
  it('announces where the block landed', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    renderList();

    move('a', 'increment');

    expect(announce).toHaveBeenCalledWith('Barbell Back Squat moved to 2 of 3');
  });

  it('keeps the row itself openable — the handle takes the drag, not the tap', () => {
    const { onOpenBlock } = renderList();

    fireEvent.press(screen.getByTestId('exercise-block-b-open'));

    expect(onOpenBlock).toHaveBeenCalledWith(BLOCKS[1]);
  });

  it('has a 44pt handle at the minimum tap floor', () => {
    renderList();

    expect(screen.getByTestId('reorder-handle-a').props.style).toEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
  });
});

// `program-builder/04`, frame 1e.
describe('DraggableExerciseList — supersets', () => {
  const GROUPED = [
    block('a', 'Barbell Back Squat', 1),
    block('b', 'Dumbbell Bench Press', 2, 'A'),
    block('c', 'Chest-Supported Row', 3, 'A'),
  ];

  // **The claim frame 1 makes, verified rather than assumed**: desaturate
  // the screen and the grouping still reads. Four channels say "these two
  // run together" and only one of them is a colour, so the three asserted
  // here — the letter on the rail, the A1/A2 position badges, and the
  // announcement — survive greyscale, colour blindness, and a screen
  // reader that never sees a pixel (`DESIGN.md` §8).
  it('says which superset a block is in without using colour', () => {
    renderList(GROUPED);

    // `includeHiddenElements` throughout: every one of these is decorative
    // by contract — the row's own label is what a screen reader gets, and a
    // standalone focusable "A" would tell it nothing (`Badge`'s docblock).
    // What is asserted here is what a SIGHTED coach reads in greyscale.
    const visible = { includeHiddenElements: true } as const;

    // The letter, once, on the rail — structure, not hue.
    expect(screen.getByTestId('superset-letter-A', visible)).toBeTruthy();
    expect(screen.getByText('A', visible)).toBeTruthy();
    // The position badges: text on each member.
    expect(screen.getByText('A1', visible)).toBeTruthy();
    expect(screen.getByText('A2', visible)).toBeTruthy();
    // The rail itself, spanning both members and no one else.
    expect(screen.getByTestId('superset-rail-b', visible)).toBeTruthy();
    expect(screen.getByTestId('superset-rail-c', visible)).toBeTruthy();
    expect(screen.queryByTestId('superset-rail-a', visible)).toBeNull();
    // And the sentence, which is the whole of what a non-sighted coach gets.
    expect(screen.getByTestId('exercise-block-c-open').props.accessibilityLabel).toBe(
      'Chest-Supported Row, superset A, 2 of 2',
    );
  });

  it('announces the position, not just the letter — 1 of 2 versus 2 of 2', () => {
    renderList(GROUPED);

    expect(screen.getByTestId('exercise-block-b-open').props.accessibilityLabel).toBe(
      'Dumbbell Bench Press, superset A, 1 of 2',
    );
  });

  it('leaves a standalone block saying nothing about supersets', () => {
    renderList(GROUPED);

    expect(screen.getByTestId('exercise-block-a-open').props.accessibilityLabel).toBe(
      'Barbell Back Squat',
    );
  });

  it('turns every ungrouped row into a checkbox in selection mode', () => {
    renderSelecting(GROUPED);

    const row = screen.getByTestId('exercise-block-a-open');
    expect(row.props.accessibilityRole).toBe('checkbox');
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('superset-check-a', { includeHiddenElements: true })).toBeTruthy();
  });

  it('reports a picked row as checked', () => {
    renderSelecting(GROUPED, ['a']);

    expect(screen.getByTestId('exercise-block-a-open').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('toggles on a press of the row itself, not of a 22px glyph', () => {
    const { onToggle } = renderSelecting(GROUPED);

    fireEvent.press(screen.getByTestId('exercise-block-a-open'));

    expect(onToggle).toHaveBeenCalledWith('a');
  });

  // A block already in a group cannot join a second one — Ungroup is what
  // it has instead, and it is announced as unavailable rather than being a
  // control that silently does nothing.
  it('offers no checkbox on a block that is already grouped', () => {
    const { onToggle } = renderSelecting(GROUPED);

    expect(screen.queryByTestId('superset-check-b', { includeHiddenElements: true })).toBeNull();
    const row = screen.getByTestId('exercise-block-b-open');
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(row);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('attaches an Ungroup chip to the group, once, under its last member', () => {
    const { onUngroup } = renderSelecting(GROUPED);

    const chip = screen.getByTestId('ungroup-A');
    expect(screen.getAllByTestId('ungroup-A')).toHaveLength(1);

    fireEvent.press(chip);
    expect(onUngroup).toHaveBeenCalledWith('A');
  });

  it('stops dragging while the day is being grouped — the row cannot be two controls at once', () => {
    renderSelecting(GROUPED);

    expect(screen.queryByTestId('reorder-handle-a')).toBeNull();
  });

  // The button path enforces the same adjacency rule the drag does. Without
  // this, a VoiceOver user could split a superset that a sighted coach
  // cannot — and would only find out from a server refusal.
  it('offers no step that would split a superset', () => {
    // A is 2-3, so the standalone block at 1 has nowhere legal above it and
    // must jump the whole group to get below it.
    renderList([
      block('a', 'Barbell Back Squat', 1),
      block('b', 'Dumbbell Bench Press', 2, 'A'),
      block('c', 'Chest-Supported Row', 3, 'A'),
    ]);

    const actions = (id: string) =>
      (
        screen.getByTestId(`reorder-handle-${id}`).props.accessibilityActions as { name: string }[]
      ).map((action) => action.name);

    // The first member of A cannot step up on its own — that would leave
    // its partner behind.
    expect(actions('b')).toEqual(['increment']);
    // The last member cannot step down out of the group.
    expect(actions('c')).toEqual(['decrement']);
  });

  it('steps a standalone block past a whole superset in one move', () => {
    const { onReorder } = renderList([
      block('a', 'Barbell Back Squat', 1),
      block('b', 'Dumbbell Bench Press', 2, 'A'),
      block('c', 'Chest-Supported Row', 3, 'A'),
    ]);

    move('a', 'increment');

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('lets the two members swap inside their own group', () => {
    const { onReorder } = renderList([
      block('a', 'Barbell Back Squat', 1),
      block('b', 'Dumbbell Bench Press', 2, 'A'),
      block('c', 'Chest-Supported Row', 3, 'A'),
    ]);

    move('b', 'increment');

    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });
});
