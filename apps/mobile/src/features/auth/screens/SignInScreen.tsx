import { createThemedStyles } from '@coachos/ui';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppleSignInButton } from '../components/AppleSignInButton.tsx';
import { AuthScreenShell } from '../components/AuthScreenShell.tsx';
import { GoogleSignInButton } from '../components/GoogleSignInButton.tsx';
import { SignInForm } from '../components/SignInForm.tsx';
import { useAppleSignIn } from '../hooks/useAppleSignIn.ts';
import { useGoogleSignIn } from '../hooks/useGoogleSignIn.ts';

// The finalised auth-screen content — "2 — Conservative" from `/design`
// round 2. Unchanged from the version that shipped in
// `src/app/(auth)/sign-in.tsx`; it moved here because `CLAUDE.md` §9.2
// keeps `app/**` to route composition only, and the social-sign-in outcome
// branching below is not composition. The chrome it used to draw inline is
// now `AuthScreenShell`.
export function SignInScreen() {
  const router = useRouter();
  const themed = useThemedStyles();
  const { signInWithApple, isSubmitting: isApplePending } = useAppleSignIn();
  const { signInWithGoogle, isSubmitting: isGooglePending } = useGoogleSignIn();
  const [socialError, setSocialError] = useState<string | null>(null);
  const socialBusy = isApplePending || isGooglePending;

  // Shared by both providers — `social-sign-in/03`'s three outcomes are
  // identical regardless of which one produced them. A brand-new identity
  // routes to the date-of-birth screen (`auth-server/07` requires it at
  // signup; neither provider supplies it) — approved via `/design`.
  function handleOutcome(result: {
    status: string;
    pendingSignupToken?: string;
    email?: string;
    error?: { formMessage: string };
  }) {
    if (result.status === 'signedIn') {
      // Role-based home routing is `phase-05-app-shell/providers-and-
      // gates/03`'s job; `/` is still the temporary placeholder, and it now
      // redirects back into this group (`src/app/index.tsx`). Left as-is
      // deliberately — picking a destination here would be inventing the
      // session/role decision that task owns.
      router.replace('/');
      return;
    }
    if (result.status === 'needsDateOfBirth' && result.pendingSignupToken) {
      router.push({
        pathname: '/complete-social-signup',
        params: { pendingSignupToken: result.pendingSignupToken, email: result.email ?? '' },
      });
      return;
    }
    if (result.status === 'error' && result.error) {
      setSocialError(result.error.formMessage);
    }
  }

  return (
    <AuthScreenShell>
      <Text style={[styles.heading, themed.heading]}>Sign in</Text>

      <SignInForm />

      <View style={styles.divider}>
        <View style={[styles.dividerLine, themed.dividerLine]} />
        <Text style={[styles.dividerText, themed.dividerText]}>or continue with</Text>
        <View style={[styles.dividerLine, themed.dividerLine]} />
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
        <Text style={[styles.socialErrorText, themed.socialErrorText]} accessibilityRole="alert">
          {socialError}
        </Text>
      )}

      <View style={styles.footer}>
        <Text style={[styles.footerText, themed.footerText]}>
          New coach?{' '}
          <Link href="/sign-up" style={[styles.footerLink, themed.footerLink]}>
            Create an account
          </Link>
        </Text>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontWeight: '700',
    fontSize: 24,
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
  },
  dividerText: {
    fontSize: 12,
  },
  socialGroup: {
    gap: 10,
  },
  socialErrorText: {
    marginTop: 12,
    fontSize: 14,
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
  },
  footerLink: {
    fontWeight: '500',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  heading: { color: theme.colors.fg.DEFAULT },
  dividerLine: { backgroundColor: theme.colors.border.soft },
  dividerText: { color: theme.colors.fg.subtle },
  socialErrorText: { color: theme.colors.fg.DEFAULT },
  footerText: { color: theme.colors.fg.muted },
  footerLink: { color: theme.colors.brand.DEFAULT },
}));
