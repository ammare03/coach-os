import { Pressable, StyleSheet, Text } from 'react-native';

interface GoogleSignInButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * `social-sign-in/02` — cross-platform. Styled to match the already-approved
 * placeholder exactly (`apps/mobile/src/app/(auth)/sign-in.tsx`'s
 * `googleButton`/`googleButtonText` styles, from the finalised design
 * canvas) rather than the shared `packages/ui` `Button` — the same reason
 * `AppleSignInButton` can't use it either: this is a provider-branded
 * control, not a generic secondary button, and Google's own brand
 * guidelines are what this styling answers to, not `DESIGN-SYSTEM.md`.
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
