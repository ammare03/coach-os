import { Button, LoadingState, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import {
  coachFirstName,
  NeverSharedNote,
  SharingControls,
  type HistorySharing,
} from '../../onboarding/components/SharingControls.tsx';
import { AuthScreenShell } from '../components/AuthScreenShell.tsx';

// `client-onboarding/01`, case 2 — a client who has left a coach and been
// invited by another.
//
// This is the only surface in the product where a client decides what a
// NEW coach may see of their PREVIOUS life here. All three decisions are
// on screen, none is pre-decided, and none is behind a "more options"
// disclosure: `historySharingInput` is a `strictObject` with no defaults
// precisely so there is no such thing as accepting without deciding.
//
// History is a three-way choice rather than a toggle because "some of it"
// is a real answer — `historySharedFrom` stores a timestamp, and the three
// options are the three timestamps that mean something (account creation,
// twelve weeks back, now).
//
// **The control itself is no longer here** (`relationship-controls/03`).
// Settings has to offer the same three options and the same two toggles,
// and a copy of them would be a second control that drifts — a different
// shape reads as a different permission. Everything between *Training
// history* and the accept button now comes from
// `features/onboarding/components/SharingControls.tsx`, which both surfaces
// render, and the extraction fixed three defects this screen shipped with:
// a system-green `Switch` in a palette with no green, a 51×31 tap target
// under `accessibility` §1's 48 floor, and a "Body metrics" hint that
// claimed progress photos the server never shares.
//
// It also gained the never-shared block, which `account-lifecycle/07` step
// 2 required here and this screen never rendered.

/** Re-exported: `InviteArrival` holds this decision in state. */
export type { HistorySharing };

export interface ReturningClientInviteScreenProps {
  /** Absent while `invites.preview` is still in flight. */
  coachName: string | undefined;
  isLoadingCoach: boolean;
  /** A preview that failed — a bad code, or one addressed to a different email. Never distinguished. */
  previewError?: string | undefined;
  historySharing: HistorySharing;
  onHistorySharingChange: (value: HistorySharing) => void;
  shareMetrics: boolean;
  onShareMetricsChange: (value: boolean) => void;
  shareNutrition: boolean;
  onShareNutritionChange: (value: boolean) => void;
  onAccept: () => void;
  isAccepting: boolean;
  acceptError?: string | undefined;
  onSignOut: () => void;
  isSigningOut?: boolean;
}

export function ReturningClientInviteScreen({
  coachName,
  isLoadingCoach,
  previewError,
  historySharing,
  onHistorySharingChange,
  shareMetrics,
  onShareMetricsChange,
  shareNutrition,
  onShareNutritionChange,
  onAccept,
  isAccepting,
  acceptError,
  onSignOut,
  isSigningOut = false,
}: ReturningClientInviteScreenProps) {
  if (isLoadingCoach) {
    return (
      <AuthScreenShell>
        <LoadingState accessibilityLabel="Loading your invite" shape="detail" />
      </AuthScreenShell>
    );
  }

  if (previewError !== undefined) {
    return (
      <AuthScreenShell>
        <View style={styles.block}>
          <Text size="h1-client" accessibilityRole="header">
            We couldn’t open that invite
          </Text>
          <Text size="body" tone="muted" accessibilityRole="alert">
            {previewError}
          </Text>
          <SignOutBlock onSignOut={onSignOut} isSigningOut={isSigningOut} />
        </View>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell>
      <View style={styles.block}>
        <Text size="h1-client" accessibilityRole="header">
          {coachName === undefined ? 'You’ve been invited' : `${coachName} invited you`}
        </Text>
        <Text size="body" tone="muted">
          Choose what they can see from before today. You can change all three later in Settings.
        </Text>

        <SharingControls
          // The invite preview may still be resolving the name; the control
          // reads better addressing "them" than a blank.
          coachFirstName={coachName === undefined ? 'them' : coachFirstName(coachName)}
          historySharing={historySharing}
          onHistorySharingChange={onHistorySharingChange}
          shareMetrics={shareMetrics}
          onShareMetricsChange={onShareMetricsChange}
          shareNutrition={shareNutrition}
          onShareNutritionChange={onShareNutritionChange}
        />

        {/* `account-lifecycle/07` step 2's standing line, above the accept
            button rather than pinned to the floor: on this screen the
            button is the floor. */}
        <NeverSharedNote />

        {acceptError === undefined ? null : (
          <Text size="body-sm" tone="urgent" accessibilityRole="alert">
            {acceptError}
          </Text>
        )}

        <Button size="lg" fullWidth loading={isAccepting} onPress={onAccept}>
          {coachName === undefined ? 'Accept invite' : `Join ${coachName}`}
        </Button>

        <SignOutBlock onSignOut={onSignOut} isSigningOut={isSigningOut} />
      </View>
    </AuthScreenShell>
  );
}

function SignOutBlock({
  onSignOut,
  isSigningOut,
}: {
  onSignOut: () => void;
  isSigningOut: boolean;
}) {
  return (
    <View style={styles.signOut}>
      <Text size="body-sm" tone="subtle">
        Not your account?
      </Text>
      <Button variant="secondary" size="lg" fullWidth loading={isSigningOut} onPress={onSignOut}>
        Sign out
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(18), paddingTop: spacing(8) },
  signOut: { gap: spacing(8), marginTop: spacing(12) },
});
