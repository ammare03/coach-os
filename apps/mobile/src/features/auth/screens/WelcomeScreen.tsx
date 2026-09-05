import { Button, createThemedStyles } from '@coachos/ui';
import { Link, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreenShell } from '../components/AuthScreenShell.tsx';

// ⚠️ DERIVED, NOT DRAWN. `welcome` is not one of `DESIGN.md` §11's thirteen
// screens and appears in no prototype. The design gate (`design-gate`
// skill) was raised with Ammar for this screen and `ForgotPasswordScreen`,
// and his decision was to build to the existing system rather than wait
// for a `/design` pass. Every value below traces to something already
// decided; nothing here invents a treatment:
//
//   · chrome, palette, scroll geometry  → `AuthScreenShell`
//   · headline 26/700, -0.5 tracking    → `DESIGN.md` §1.2 `h1-client`
//     (700 26/30, -.02em); this is the client-density front door
//   · explanation 16/24, 280px measure  → §1.2 `body-lg` + §9's "Empty
//     state" row ("15px explanation (≤280px)"), taken at the client body
//     floor of 16 (`ui-conventions` §3) rather than 15
//   · exactly ONE primary action        → §9's "Empty state" row and
//     `ui-conventions` §4; `size="lg"` is what the two approved screens
//     already use for "Sign in" and "Create account"
//   · sign-in as a footer text link     → the identical footer
//     `SignInScreen`/`SignUpScreen` already use to cross-link, so the
//     secondary route never competes with the primary action
//   · NO isometric art                  → §6 allows it in five places and
//     this is not one of them
export function WelcomeScreen() {
  const router = useRouter();
  const themed = useThemedStyles();

  return (
    <AuthScreenShell>
      <View style={styles.intro}>
        <Text style={[styles.headline, themed.headline]}>
          Everything your clients do, in one place.
        </Text>
        <Text style={[styles.body, themed.body]}>
          Programs, workout logs, food, video, and feedback — for you and your clients, in one app.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button size="lg" fullWidth onPress={() => router.push('/sign-up')}>
          Create account
        </Button>

        <Text style={[styles.footerText, themed.footerText]}>
          Already have an account?{' '}
          <Link href="/sign-in" style={[styles.footerLink, themed.footerLink]}>
            Sign in
          </Link>
        </Text>

        {/* The same fact `SignUpForm` states on the next screen, said one
            screen earlier so a client who taps through does not have to
            find out after filling a form in. */}
        <Text style={[styles.note, themed.note]}>
          Clients join with an invite from their coach.
        </Text>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: 12,
    paddingTop: 8,
  },
  headline: {
    fontWeight: '700',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 280,
  },
  actions: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 16,
    paddingTop: 32,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontWeight: '500',
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  headline: { color: theme.colors.fg.DEFAULT },
  body: { color: theme.colors.fg.muted },
  footerText: { color: theme.colors.fg.muted },
  footerLink: { color: theme.colors.brand.DEFAULT },
  // `fg.subtle` is `DESIGN.md` §13's ≥14px-only token; this line is 13px,
  // so it uses `fg.muted` (5.6:1) rather than dropping to 3.1:1.
  note: { color: theme.colors.fg.muted },
}));
