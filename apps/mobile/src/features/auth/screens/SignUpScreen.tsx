import { createThemedStyles } from '@coachos/ui';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreenShell } from '../components/AuthScreenShell.tsx';
import { SignUpForm } from '../components/SignUpForm.tsx';

// Unchanged from the version that shipped in `src/app/(auth)/sign-up.tsx`,
// moved here for the same §9.2 reason as `SignInScreen` and repalletted for
// the same reason (see `AuthScreenShell`'s header). The "Coach" badge and
// the "Clients join by invite, not here." line live inside `SignUpForm`
// itself — they are sign-up content, not screen chrome.
export function SignUpScreen() {
  const themed = useThemedStyles();

  return (
    <AuthScreenShell>
      <SignUpForm />

      <View style={styles.footer}>
        <Text style={[styles.footerText, themed.footerText]}>
          Already have an account?{' '}
          <Link href="/sign-in" style={[styles.footerLink, themed.footerLink]}>
            Sign in
          </Link>
        </Text>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: 'center',
    paddingTop: 20,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontWeight: '500',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  footerText: { color: theme.colors.fg.muted },
  footerLink: { color: theme.colors.brand.DEFAULT },
}));
