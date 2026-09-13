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

// S45 — a label alone is sometimes ambiguous ("Enter an invite code" does
// not say where it goes). `IconButton` has carried a hint since P04; this
// is the same prop on the same `Pressable`, and its absence was the gap.
describe('Button — accessibilityHint', () => {
  it('carries a hint when the label alone does not say what happens', () => {
    render(
      <Button
        onPress={jest.fn()}
        accessibilityLabel="Enter an invite code"
        accessibilityHint="Opens the screen where you enter a coach's invite code"
      >
        Enter an invite code
      </Button>,
    );

    expect(screen.getByLabelText('Enter an invite code').props.accessibilityHint).toBe(
      "Opens the screen where you enter a coach's invite code",
    );
  });
});
