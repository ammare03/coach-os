import { fireEvent, render, screen } from '@testing-library/react-native';

import { EDITING_BAR_MIN_HEIGHT, EditingBar } from '../EditingBar.tsx';

// `set-entry/05` — what the pinned composer becomes while a set is being
// corrected. Small on purpose: the editor is in the list, and the list needs
// the height back.

describe('EditingBar', () => {
  it('names the set being corrected, in the same words the card uses', () => {
    render(<EditingBar setNumber={2} isWarmup={false} onCancel={jest.fn()} />);

    expect(screen.getByText('Editing set 2')).toBeTruthy();
  });

  it('names a warm-up rather than numbering it', () => {
    // Set 1 is the first *working* set, so a warm-up has no number.
    render(<EditingBar setNumber={1} isWarmup onCancel={jest.fn()} />);

    expect(screen.getByText('Editing warm-up')).toBeTruthy();
    expect(screen.queryByText('Editing set 1')).toBeNull();
  });

  it('carries Cancel and nothing else — a set cannot be logged mid-edit', () => {
    const onCancel = jest.fn();
    render(<EditingBar setNumber={2} isWarmup={false} onCancel={onCancel} testID="bar" />);

    fireEvent.press(screen.getByTestId('editing-bar-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Cancel editing set 2')).toBeTruthy();
  });

  it('is 44px, and by minHeight so 200% text grows it instead of clipping', () => {
    render(<EditingBar setNumber={2} isWarmup={false} onCancel={jest.fn()} testID="bar" />);

    const rules = flattenStyle(screen.getByTestId('bar').props.style);
    expect(rules.some((rule) => rule.minHeight === EDITING_BAR_MIN_HEIGHT)).toBe(true);
    expect(rules.some((rule) => rule.height !== undefined)).toBe(false);
  });

  it('is a container, not an accessible element — its two children are', () => {
    // Merging them would make the button's name the whole bar.
    render(<EditingBar setNumber={2} isWarmup={false} onCancel={jest.fn()} testID="bar" />);

    expect(screen.getByTestId('bar').props.accessible).toBe(false);
  });
});

/** A style prop is an object, an array, or nested arrays — normalise before asserting. */
function flattenStyle(style: unknown): Record<string, unknown>[] {
  if (style === null || style === undefined) return [];
  if (Array.isArray(style)) return style.flatMap((entry) => flattenStyle(entry));
  if (typeof style !== 'object') return [];
  return [style as Record<string, unknown>];
}
