import { GlassSurface } from '@coachos/ui';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PulseRingBackground } from '../../features/auth/components/PulseRingBackground.tsx';
import { SignUpForm } from '../../features/auth/components/SignUpForm.tsx';

// Same finalised chrome as `sign-in.tsx` — see that file's comment. The
// "Coach" badge and "Clients join by invite, not here." copy live inside
// `SignUpForm` itself, not here, since they're part of the sign-up-
// specific content, not generic screen chrome.
export default function SignUpScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <PulseRingBackground />

      <GlassSurface
        tier="tier1"
        style={[styles.navBar, { paddingTop: insets.top, height: 64 + insets.top }]}
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
          <SignUpForm />

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Already have an account?{' '}
              <Link href="/sign-in" style={styles.footerLink}>
                Sign in
              </Link>
            </Text>
          </View>
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
  footer: {
    alignItems: 'center',
    paddingTop: 20,
  },
  footerText: {
    fontSize: 14,
    color: '#97A2B4',
  },
  footerLink: {
    fontWeight: '500',
    color: '#868CF8',
  },
});
