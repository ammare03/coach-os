import { GlassSurface } from '@coachos/ui';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PulseRingBackground } from '../../features/auth/components/PulseRingBackground.tsx';
import { SignInForm } from '../../features/auth/components/SignInForm.tsx';

// The finalised auth-screen chrome — "2 — Conservative" from `/design`
// round 2: glass on the nav bar only (DS§12.1's already-approved
// nav-bar use, zero extension of the rule), fully opaque form below, and
// the pulse-ring background from "1 — Maximal" swapped in for the
// original drifting trend line. Social buttons are real, separate
// controls per the design canvas's comment #1, disabled until
// `phase-03-identity-and-auth/social-sign-in/` builds them.
export default function SignInScreen() {
  const insets = useSafeAreaInsets();

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
          <Text style={styles.heading}>Sign in</Text>

          <SignInForm />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialGroup}>
            <View style={[styles.socialButton, styles.appleButton]}>
              <Text style={styles.appleButtonText}>Continue with Apple</Text>
            </View>
            <View style={[styles.socialButton, styles.googleButton]}>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              New coach?{' '}
              <Link href="/sign-up" style={styles.footerLink}>
                Create an account
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
  heading: {
    fontWeight: '700',
    fontSize: 24,
    color: '#F2F5F9',
    marginBottom: 20,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 22,
  },
  dividerLine: {
    flexGrow: 1,
    height: 1,
    backgroundColor: '#1E242E',
  },
  dividerText: {
    fontSize: 12,
    color: '#5F6C7E',
  },
  socialGroup: {
    gap: 10,
  },
  socialButton: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5, // not yet wired — `social-sign-in` builds the real handler
  },
  appleButton: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2A323F',
  },
  appleButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
  },
  googleButtonText: {
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingTop: 24,
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
