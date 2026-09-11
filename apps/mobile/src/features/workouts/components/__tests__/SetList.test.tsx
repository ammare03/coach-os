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
