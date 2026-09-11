import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SetList } from '../SetList.tsx';
import type { LoggedSetView } from '../SetRow.tsx';

/** The default row's one accessible label. */
const LABEL = 'Set 1, 82.5 kilograms for 8 reps, logged.';

// The receipt list and the row it renders. The seams tasks 03 and 04 plug
// into are asserted here, so neither has to restructure this file.

function set(overrides: Partial<LoggedSetView> = {}): LoggedSetView {
  return {
    localId: 'set-1',
    setNumber: 1,
    reps: 8,
    weightKg: 82.5,
    loggedAt: new Date('2026-09-11T10:00:00Z'),
    isWarmup: false,
    ...overrides,
  };
}

describe('SetList', () => {
  it('reads each row as one item, not as five fragments', () => {
    render(<SetList sets={[set({ setNumber: 3 })]} unit="kg" />);

    // `accessibility` §2 — one label carrying the whole set, with the glyphs
    // spelled out.
    expect(screen.getByLabelText('Set 3, 82.5 kilograms for 8 reps, logged.')).toBeTruthy();
  });

  it('prints the load with the unit from packages/utils, never a literal', () => {
    render(<SetList sets={[set()]} unit="lb" />);

    // 82.5kg is 182lb, printed whole — a client on pounds never reads a
    // number in kilograms.
    expect(screen.getByText('182lb × 8')).toBeTruthy();
  });

  it('renders a bodyweight set as reps alone rather than as zero', () => {
    render(<SetList sets={[set({ weightKg: null, reps: 12 })]} unit="kg" />);

    expect(screen.getByText('12 reps')).toBeTruthy();
  });

  it('gives each row one trailing occupant — the seam tasks 03 and 04 fill', () => {
    render(
      <SetList
        sets={[set()]}
        unit="kg"
        renderTrailing={(row) => <Text>{`tag-${row.localId}`}</Text>}
      />,
    );

    expect(screen.getByText('tag-set-1')).toBeTruthy();
  });

  it('is a button offering to edit only once a caller can handle the tap', () => {
    const onEditSet = jest.fn();
    const { rerender } = render(<SetList sets={[set()]} unit="kg" />);

    // Nothing to do to it: claiming it is a button would be a lie.
    expect(screen.getByLabelText(LABEL).props.accessibilityRole).toBeUndefined();

    rerender(<SetList sets={[set()]} unit="kg" onEditSet={onEditSet} />);
    const row = screen.getByLabelText(LABEL);
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityHint).toBe('Double tap to edit');

    fireEvent.press(row);
    expect(onEditSet).toHaveBeenCalledWith(expect.objectContaining({ localId: 'set-1' }));
  });

  it('puts the editor where the row was, and takes the row off screen', () => {
    // `set-entry/05` — in place, so the client can still see which set they
    // are changing. That is the whole reason the editor is not in the
    // pinned card.
    render(
      <SetList
        sets={[set()]}
        unit="kg"
        editingLocalId="set-1"
        renderEditor={(row) => <Text>{`editor-${row.localId}`}</Text>}
        onEditSet={jest.fn()}
      />,
    );

    expect(screen.getByText('editor-set-1')).toBeTruthy();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it('renders nothing at all for a set the client has not logged yet', () => {
    render(<SetList sets={[]} unit="kg" testID="set-list" />);

    // No dash, no placeholder, no empty state: the composer is the content
    // (`COPY.md` §CO2).
    expect(screen.getByTestId('set-list')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });
});

describe('SetList — hiding a set being deleted (`set-entry/06`)', () => {
  const SET_2 = 'Set 2, 82.5 kilograms for 8 reps, logged.';

  it('takes a hidden row off screen while the caller still holds it', () => {
    // The distinction the whole task turns on: `sets` is unchanged — the
    // set has not been deleted, only hidden — so putting it back is this
    // prop changing and nothing else.
    const sets = [set({ localId: 'set-1', setNumber: 1 }), set({ localId: 'set-2', setNumber: 2 })];
    const { rerender } = render(
      <SetList sets={sets} unit="kg" hiddenLocalIds={new Set(['set-2'])} />,
    );

    expect(screen.getByLabelText(LABEL)).toBeTruthy();
    expect(screen.queryByLabelText(SET_2)).toBeNull();

    rerender(<SetList sets={sets} unit="kg" hiddenLocalIds={new Set()} />);
    expect(screen.getByLabelText(SET_2)).toBeTruthy();
  });

  it('leaves the surviving rows with the numbers they were given', () => {
    // Hiding set 2 of 3 leaves 1 and 3. A list that renumbered here would
    // re-point next week's "last time" at a different set.
    render(
      <SetList
        sets={[
          set({ localId: 'set-1', setNumber: 1 }),
          set({ localId: 'set-2', setNumber: 2 }),
          set({ localId: 'set-3', setNumber: 3 }),
        ]}
        unit="kg"
        hiddenLocalIds={new Set(['set-2'])}
      />,
    );

    expect(screen.getByLabelText(LABEL)).toBeTruthy();
    expect(screen.getByLabelText('Set 3, 82.5 kilograms for 8 reps, logged.')).toBeTruthy();
    expect(screen.queryByLabelText(SET_2)).toBeNull();
  });

  it('offers the delete action only once a caller can handle it', () => {
    const onDeleteSet = jest.fn();
    const { rerender } = render(<SetList sets={[set()]} unit="kg" />);

    // Nothing can withdraw it, so nothing claims it can.
    expect(screen.getByLabelText(LABEL).props.accessibilityActions).toBeUndefined();

    rerender(<SetList sets={[set()]} unit="kg" onDeleteSet={onDeleteSet} />);
    const row = screen.getByLabelText(LABEL);
    // `accessibility` §7 — the equivalent the swipe owes, on the row itself.
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete set' }]);

    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(onDeleteSet).toHaveBeenCalledWith(expect.objectContaining({ localId: 'set-1' }));
  });

  it('drops the delete action from every other row while one is being edited', () => {
    // Same rule as the edit hint (design frame F): the open editor carries
    // its own `Delete set`, so a stray swipe cannot withdraw a different set
    // than the one on screen.
    render(
      <SetList
        sets={[set({ localId: 'set-1', setNumber: 1 }), set({ localId: 'set-2', setNumber: 2 })]}
        unit="kg"
        editingLocalId="set-2"
        renderEditor={() => <Text>editor</Text>}
        onEditSet={jest.fn()}
        onDeleteSet={jest.fn()}
      />,
    );

    expect(screen.getByLabelText(LABEL).props.accessibilityActions).toBeUndefined();
  });
  // `personal-records/03` — the mark the celebration leaves behind. The pill
  // is gone in 2.6 seconds; this is what a client who was re-racking a bar
  // finds when they look back.
  describe('the record mark', () => {
    it('marks the row that took a record, and only that row', () => {
      render(
        <SetList
          sets={[set({ localId: 'set-1', setNumber: 1 }), set({ localId: 'set-2', setNumber: 2 })]}
          unit="kg"
          recordLocalIds={new Set(['set-2'])}
        />,
      );

      expect(
        screen.getAllByTestId('set-row-record-mark', { includeHiddenElements: true }),
      ).toHaveLength(1);
    });

    it("says so, in the row's one spoken label", () => {
      render(<SetList sets={[set()]} unit="kg" recordLocalIds={new Set(['set-1'])} />);

      expect(
        screen.getByLabelText('Set 1, 82.5 kilograms for 8 reps, logged. Personal record.'),
      ).toBeTruthy();
    });

    it('leaves every other row exactly as it was', () => {
      render(<SetList sets={[set()]} unit="kg" recordLocalIds={new Set(['someone-else'])} />);

      expect(screen.getByLabelText(LABEL)).toBeTruthy();
      expect(
        screen.queryByTestId('set-row-record-mark', { includeHiddenElements: true }),
      ).toBeNull();
    });

    it('draws a shape, not only a hue — it has to survive greyscale', () => {
      render(<SetList sets={[set()]} unit="kg" recordLocalIds={new Set(['set-1'])} />);

      expect(
        screen.getByTestId('set-row-record-mark', { includeHiddenElements: true }),
      ).toBeTruthy();
    });
  });
});
