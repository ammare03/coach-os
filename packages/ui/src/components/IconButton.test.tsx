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
