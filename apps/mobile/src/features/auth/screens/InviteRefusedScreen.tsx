import { Button, Card, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { AuthScreenShell } from '../components/AuthScreenShell.tsx';

// `client-onboarding/01`, cases 1 and 3 — one component, two copy
// variants: a client who already has a coach, and a coach or assistant.
//
// **There is no switch-coach control here, and that is the decision, not an
// omission** (the task's "Decisions this task is built against", Ammar,
// 2026-09-05). Leaving a coach stays one deliberate, audited path reached
// from Settings, because a switch button on a screen you arrive at from a
// link puts coach-poaching one tap away. The server already refuses —
// `attachClient` throws `CLIENT_ALREADY_HAS_COACH` — and this screen gives
// that refusal an honest surface. It adds no rule and performs no action.

export type InviteRefusedReason = 'client-has-coach' | 'signed-in-as-coach';

export interface InviteRefusedScreenProps {
  reason: InviteRefusedReason;
  /** The current coach's name, when there is one. Absent on the coach variant. */
  coachName?: string | undefined;
  /** Shown so a person signed in as the wrong account can see which one it is. */
  email: string;
  /** Case 1 only — Settings is where leaving actually happens. */
  onOpenSettings?: (() => void) | undefined;
  onSignOut: () => void;
  isSigningOut?: boolean;
}

export function InviteRefusedScreen({
  reason,
  coachName,
  email,
  onOpenSettings,
  onSignOut,
  isSigningOut = false,
}: InviteRefusedScreenProps) {
  const isCoach = reason === 'signed-in-as-coach';

  return (
    <AuthScreenShell>
      <View style={styles.block}>
        <Text size="h1-client" accessibilityRole="header">
          {isCoach ? 'This invite is for a client' : 'You already have a coach'}
        </Text>
        <Text size="body" tone="muted">
          {isCoach
            ? 'You’re signed in as a coach, so there’s nothing here for you to accept.'
            : coachName === undefined
              ? 'An invite can only be accepted by someone who isn’t currently coached.'
              : `You’re working with ${coachName}. An invite can only be accepted by someone who isn’t currently coached.`}
        </Text>

        {isCoach ? null : (
          <Card>
            <Text size="label">If you want to move</Text>
            <Text size="body" tone="muted" style={styles.cardBody}>
              Leave your current coach in Settings first. Your training history, photos and messages
              stay yours either way — nothing is deleted when a coaching relationship ends.
            </Text>
          </Card>
        )}

        {onOpenSettings === undefined ? null : (
          <Button variant="secondary" size="lg" fullWidth onPress={onOpenSettings}>
            Go to Settings
          </Button>
        )}

        {/* Approach step 6 — the only recovery for someone signed in as one
            account holding an invite addressed to another. Signing yourself
            out leaks nothing. */}
        <View style={styles.signOut}>
          <Text size="label">Not your account?</Text>
          <Text size="body-sm" tone="subtle">
            Signed in as {email}
          </Text>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={isSigningOut}
            onPress={onSignOut}
          >
            Sign out
          </Button>
        </View>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(20), paddingTop: spacing(8) },
  cardBody: { marginTop: spacing(8) },
  signOut: { gap: spacing(8), marginTop: spacing(12) },
});
