import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { ProgramDayExercise } from '../../api/programs.ts';
import { DraggableExerciseList } from '../DraggableExerciseList.tsx';

// What this file holds: **a drag-and-drop list has to be operable without
// dragging** (`accessibility` §7 — never a gesture with no button
// equivalent). The pan itself runs on the UI thread through Reanimated
// worklets and is verified on hardware; what is asserted here is the path a
// VoiceOver or TalkBack user takes, the announcement they get, and the fact
// that a move sends the day's COMPLETE new order rather than a diff.

function block(id: string, name: string, orderIndex: number): ProgramDayExercise {
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
    targetRestSeconds: 90,
    tempo: null,
    supersetGroup: null,
    coachNotes: null,
    exerciseName: name,
    exercisePrimaryMuscle: 'quads',
    exerciseEquipment: 'barbell',
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
