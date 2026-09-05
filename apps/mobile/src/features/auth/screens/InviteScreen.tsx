import { Button, createThemedStyles } from '@coachos/ui';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AuthScreenShell } from '../components/AuthScreenShell.tsx';

/**
 * `(auth)/invite/[code]` — a composition point, deliberately incomplete.
 *
 * `phase-05-app-shell/router-skeleton/02`'s own Risks section says so in as
 * many words: this route exists so the deep link resolves and the code is
 * extracted correctly, and `phase-06-onboarding/client-onboarding/01`
 * builds the screen that redeems it against
 * `phase-03-identity-and-auth/invites/04`'s procedure. **No invite
 * acceptance logic belongs here** — not a query, not a mutation, not a
 * validity check, because any of the three would have to be deleted and
 * re-decided by P06.
 *
 * The code is shown rather than hidden because a client who lands here has
 * nothing else to give their coach, and it is their own single-use code
 * out of their own link — not a secret this screen is leaking. It is never
 * logged (`security-and-privacy` skill).
 */
export interface InviteScreenProps {
  code: string;
  onSignIn: () => void;
}

export function InviteScreen({ code, onSignIn }: InviteScreenProps) {
  const themed = useThemedStyles();

  return (
    <AuthScreenShell>
      <View style={styles.block}>
        <Text style={[styles.heading, themed.heading]}>Invite link opened</Text>
        <Text style={[styles.body, themed.body]}>
          Accepting an invite is not available in this build yet. Your coach can tell you when it
          is.
        </Text>

        {/* `DESIGN.md` §1.2 and §9's media-placeholder convention: a 9–11px
            mono caption naming what belongs in a surface that is not built
            yet. Nothing here pretends to be the finished screen. */}
        <Text style={[styles.code, themed.code]} accessibilityLabel={`Invite code ${code}`}>
          invite code · {code}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button variant="secondary" size="lg" fullWidth onPress={onSignIn}>
          Go to sign in
        </Button>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 12,
    paddingTop: 8,
  },
  heading: {
    fontWeight: '700',
    fontSize: 24,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 280,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 32,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  heading: { color: theme.colors.fg.DEFAULT },
  body: { color: theme.colors.fg.muted },
  // 11px, so `fg.subtle` (§13: ≥14px only) is out; `fg.muted` at 5.6:1 is
  // the floor this line can legally use.
  code: { color: theme.colors.fg.muted },
}));
