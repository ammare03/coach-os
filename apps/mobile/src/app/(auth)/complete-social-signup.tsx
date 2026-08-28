import { GlassSurface } from '@coachos/ui';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompleteSocialSignUpForm } from '../../features/auth/components/CompleteSocialSignUpForm.tsx';
import { PulseRingBackground } from '../../features/auth/components/PulseRingBackground.tsx';

// Same finalised auth-screen chrome as `sign-in.tsx`/`sign-up.tsx` (see
// those files' own comments) — glass on the nav bar only, per Ammar's
// review of the `/design` canvas: "The top bar will be liquid glass since
// that is how we implemented Sign In and Sign Up." The identity row and
// every other surface below it stay opaque, matching `GlassSurface`'s own
// DS§10 fallback rather than an emulated blur.
export default function CompleteSocialSignUpScreen() {
  const insets = useSafeAreaInsets();
  const { pendingSignupToken, email } = useLocalSearchParams<{
    pendingSignupToken: string;
    email: string;
  }>();

  return (
    <View style={styles.screen}>
      <PulseRingBackground />

      <GlassSurface
        style="regular"
        containerStyle={[styles.navBar, { paddingTop: insets.top, height: 64 + insets.top }]}
      >
        <View style={styles.navBarContent}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>C</Text>
          </View>
          <Text style={styles.logoText}>CoachOS</Text>
        </View>
      </GlassSurface>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={64 + insets.top}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: 84 + insets.top, paddingBottom: 28 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <CompleteSocialSignUpForm
            pendingSignupToken={pendingSignupToken ?? ''}
            email={email ?? ''}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: '#0A0D12',
  },
  navBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
  },
  navBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#FFFFFF',
  },
  logoText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#F2F5F9',
  },
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
});
