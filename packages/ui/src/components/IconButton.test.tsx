import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { IconButton, type IconButtonProps } from './IconButton.tsx';

describe('IconButton', () => {
  it('calls onPress when enabled', () => {
    const onPress = jest.fn();
    render(<IconButton icon={<Text>×</Text>} onPress={onPress} accessibilityLabel="Close" />);
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks onPress when disabled and announces disabled', () => {
    const onPress = jest.fn();
    render(
      <IconButton icon={<Text>×</Text>} onPress={onPress} disabled accessibilityLabel="Close" />,
    );
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Close').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('renders as a button with a role, reachable by its accessibility label', () => {
    render(<IconButton icon={<Text>×</Text>} onPress={jest.fn()} accessibilityLabel="Clear" />);
    expect(screen.getByLabelText('Clear').props.accessibilityRole).toBe('button');
  });

  it('defaults sm to the slop that centres 32 inside the 44 floor', () => {
    // `centeredHitSlop(32, tapTarget.MIN)`. Pinned so the passthrough below
    // cannot quietly become the default for every call site.
    render(<IconButton icon={<Text>×</Text>} size="sm" accessibilityLabel="Clear" />);
    expect(screen.getByLabelText('Clear').props.hitSlop).toBe(6);
  });

  it('lets a caller name a wider slop when its own geometry sets a higher floor', () => {
    // `session-review/02`'s 32px comment disc needs 48, not 44
    // (`ui-conventions` §5). Reached by slop, never by growing the visible
    // box past the size its design specifies — and per call site, because
    // raising `tapTarget.MIN` product-wide is a design decision.
    render(
      <IconButton icon={<Text>×</Text>} size="sm" hitSlop={8} accessibilityLabel="Add comment" />,
    );
    expect(screen.getByLabelText('Add comment').props.hitSlop).toBe(8);
  });

  it('passes a hint through, so an inert destination can be announced before the tap', () => {
    render(
      <IconButton
        icon={<Text>×</Text>}
        onPress={jest.fn()}
        accessibilityLabel="Add comment"
        accessibilityHint="Opens a comment sheet."
      />,
    );
    expect(screen.getByLabelText('Add comment').props.accessibilityHint).toBe(
      'Opens a comment sheet.',
    );
  });

  // `ui-primitives-core/01`: "TypeScript rejects it" — `accessibilityLabel`
  // is required in `IconButtonProps`, not optional-with-a-warning. This is
  // a type-level assertion: the line below must fail to compile without
  // the `@ts-expect-error`, and `tsc --noEmit` is what actually enforces
  // it (a runtime `it()` cannot check a compile error).
  it('requires accessibilityLabel at the type level (see @ts-expect-error above)', () => {
    // @ts-expect-error — accessibilityLabel is omitted on purpose
    const missingLabel: IconButtonProps = { icon: <Text>×</Text> };
    expect(missingLabel).toBeDefined();
  });
});
