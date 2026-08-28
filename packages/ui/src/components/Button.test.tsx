import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from './Button.tsx';

describe('Button', () => {
  it('calls onPress when enabled', () => {
    const onPress = jest.fn();
    render(<Button onPress={onPress}>Sign in</Button>);
    fireEvent.press(screen.getByText('Sign in'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks onPress when disabled', () => {
    const onPress = jest.fn();
    render(
      <Button onPress={onPress} disabled>
        Sign in
      </Button>,
    );
    fireEvent.press(screen.getByText('Sign in'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('blocks onPress when loading', () => {
    const onPress = jest.fn();
    render(
      <Button onPress={onPress} loading>
        Sign in
      </Button>,
    );
    fireEvent.press(screen.getByText('Sign in'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
