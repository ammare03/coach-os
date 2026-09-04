import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, resolveButtonVariantVisuals, type ButtonVariant } from './Button.tsx';

describe('Button', () => {
  it('calls onPress when enabled', () => {
    const onPress = jest.fn();
    render(<Button onPress={onPress}>Sign in</Button>);
    fireEvent.press(screen.getByText('Sign in'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('blocks onPress when disabled and announces disabled', () => {
    const onPress = jest.fn();
    render(
      <Button onPress={onPress} disabled accessibilityLabel="Sign in">
        Sign in
      </Button>,
    );
    fireEvent.press(screen.getByLabelText('Sign in'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sign in').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('blocks onPress when loading and announces busy', () => {
    const onPress = jest.fn();
    render(
      <Button onPress={onPress} loading accessibilityLabel="Sign in">
        Sign in
      </Button>,
    );
    fireEvent.press(screen.getByLabelText('Sign in'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sign in').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });

  it('renders every variant/size combination without throwing', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
    const sizes = ['sm', 'md', 'lg'] as const;
    for (const variant of variants) {
      for (const size of sizes) {
        expect(() =>
          render(
            <Button variant={variant} size={size} testID={`btn-${variant}-${size}`}>
              Label
            </Button>,
          ),
        ).not.toThrow();
      }
    }
  });
});

describe('resolveButtonVariantVisuals', () => {
  it('never fills danger — it is outlined and lettered in urgent-text, never a red fill', () => {
    const visuals = resolveButtonVariantVisuals('danger', false, false);
    expect(visuals.backgroundColor).toBe('transparent');
    expect(visuals.borderWidth).toBeGreaterThan(0);
  });

  it('renders ghost with a dashed border, never solid', () => {
    const visuals = resolveButtonVariantVisuals('ghost', false, false);
    expect(visuals.borderStyle).toBe('dashed');
  });

  it('resolves primary through the gradient path, not a flat brand fill', () => {
    const visuals = resolveButtonVariantVisuals('primary', false, false);
    expect(visuals.useGradient).toBe(true);
  });

  it('disabled overrides every variant to the same neutral, reduced-contrast treatment', () => {
    const disabledPrimary = resolveButtonVariantVisuals('primary', false, true);
    const disabledDanger = resolveButtonVariantVisuals('danger', false, true);
    expect(disabledPrimary).toEqual(disabledDanger);
  });
});
