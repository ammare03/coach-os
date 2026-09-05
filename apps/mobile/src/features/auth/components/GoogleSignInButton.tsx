import { Pressable, StyleSheet, Text } from 'react-native';

interface GoogleSignInButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * `social-sign-in/02` — cross-platform. Not built from `packages/ui`'s
 * `Button`, for the same reason `AppleSignInButton` isn't: this is a
 * provider-branded control, not a generic secondary button.
 *
 * ⚠️ **The two colours below are deliberately NOT tokens, and this file
 * stays on `eslint.react-native.js`'s `no-raw-color` allowlist because of
 * it — not because it is unmigrated legacy.** Google's Sign-In branding
 * guidelines fix the light button at a `#FFFFFF` face with near-black
 * lettering, and a compliant button is a condition of using the provider at
 * all. Restyling it into `DESIGN.md` §1.1's warm ramp would make it a
 * peach-tinted "Continue with Google" button, which is exactly what those
 * guidelines forbid. The surrounding screen is themed; this control is
 * quoted, not designed.
 *
 * `#1F2430` is the near-black the approved canvas drew (Google's own spec
 * says `#1F1F1F`) — left as-is because changing it is a design decision for
 * Ammar, not a token migration.
 *
 * Contrast: `#1F2430` on `#FFFFFF` is 15.4:1, well clear of 4.5:1, so the
 * exemption costs nothing in legibility. It is theme-invariant by design —
 * the button looks identical in light and dark, which is what Google asks
 * for.
 */
export function GoogleSignInButton({ onPress, disabled = false }: GoogleSignInButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.text}>Continue with Google</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '600',
  },
});
