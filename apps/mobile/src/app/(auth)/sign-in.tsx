import { GlassSurface } from '@coachos/ui';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppleSignInButton } from '../../features/auth/components/AppleSignInButton.tsx';
import { GoogleSignInButton } from '../../features/auth/components/GoogleSignInButton.tsx';
import { PulseRingBackground } from '../../features/auth/components/PulseRingBackground.tsx';
import { SignInForm } from '../../features/auth/components/SignInForm.tsx';
import { useAppleSignIn } from '../../features/auth/hooks/useAppleSignIn.ts';
import { useGoogleSignIn } from '../../features/auth/hooks/useGoogleSignIn.ts';

// The finalised auth-screen chrome — "2 — Conservative" from `/design`
// round 2: glass on the nav bar only (DS§12.1's already-approved
// nav-bar use, zero extension of the rule), fully opaque form below, and
// the pulse-ring background from "1 — Maximal" swapped in for the
// original drifting trend line. Social buttons are real, separate
// controls per the design canvas's comment #1 — now wired to
// `phase-03-identity-and-auth/social-sign-in/`, same spot and styling the
// canvas approved.
export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithApple, isSubmitting: isApplePending } = useAppleSignIn();
  const { signInWithGoogle, isSubmitting: isGooglePending } = useGoogleSignIn();
  const [socialError, setSocialError] = useState<string | null>(null);
  // Held, not yet consumed — `social-sign-in/03`'s `newIdentity` outcome
  // needs a date-of-birth screen before an account exists at all
  // (`auth-server/07` requires it at signup; neither provider supplies it).
  // That screen is gated behind `/design` per `CLAUDE.md` rule 7a — see the
  // `design-gate` alert this feature raised. The server has already
  // verified the identity and issued a short-lived token by this point;
  // nothing here invents a screen or navigates to one that doesn't exist
  // yet. Once it does, this is what it reads.
  const [pendingSocialSignupToken, setPendingSocialSignupToken] = useState<string | null>(null);
  const socialBusy = isApplePending || isGooglePending;

  // Shared by both providers — `social-sign-in/03`'s three outcomes are
  // identical regardless of which one produced them.
  function handleOutcome(result: {
    status: string;
    pendingSignupToken?: string;
    error?: { formMessage: string };
  }) {
    if (result.status === 'signedIn') {
      router.replace('/');
      return;
    }
    if (result.status === 'needsDateOfBirth' && result.pendingSignupToken) {
      setPendingSocialSignupToken(result.pendingSignupToken);
      return;
    }
    if (result.status === 'error' && result.error) {
      setSocialError(result.error.formMessage);
    }
  }
  void pendingSocialSignupToken; // read by the date-of-birth screen once it exists

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
            <AppleSignInButton
              disabled={socialBusy}
              onPress={() => {
                setSocialError(null);
                void signInWithApple().then(handleOutcome);
              }}
            />
            <GoogleSignInButton
              disabled={socialBusy}
              onPress={() => {
                setSocialError(null);
                void signInWithGoogle().then(handleOutcome);
              }}
            />
          </View>

          {socialError !== null && (
            <Text style={styles.socialErrorText} accessibilityRole="alert">
              {socialError}
            </Text>
          )}

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
  socialErrorText: {
    marginTop: 12,
    fontSize: 14,
    color: '#F2F5F9',
    textAlign: 'center',
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
