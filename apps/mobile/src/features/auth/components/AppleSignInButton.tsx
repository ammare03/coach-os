import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

interface AppleSignInButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * `social-sign-in/01` — iOS-only, Apple's own native button component (the
 * task's Acceptance Criteria requires it, not a styling preference: Apple's
 * Human Interface Guidelines govern this button's appearance, not
 * `DESIGN-SYSTEM.md`). Renders nothing on Android/web, and nothing on an
 * iOS build where Sign In with Apple isn't actually available (an old OS,
 * or the capability missing from the build), rather than a button that
 * would fail the moment it's pressed.
 *
 * Position, size, and surrounding layout come from the already-approved
 * design canvas (`apps/mobile/src/app/(auth)/sign-in.tsx`'s own comment) —
 * this component only supplies the control itself.
 */
export function AppleSignInButton({ onPress, disabled = false }: AppleSignInButtonProps) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    let cancelled = false;
    AppleAuthentication.isAvailableAsync()
      .then((result) => {
        if (!cancelled) setAvailable(result);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS !== 'ios' || !available) {
    return null;
  }

  return (
    <View style={disabled ? styles.disabled : undefined} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={styles.button}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { height: 48, width: '100%' },
  disabled: { opacity: 0.5 },
});
