import {
  Button,
  Divider,
  LoadingState,
  SegmentedControl,
  spacing,
  Text,
  type SegmentedOptions,
} from '@coachos/ui';
import { StyleSheet, Switch, View } from 'react-native';

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

export type HistorySharing = 'nothing' | 'twelve_weeks' | 'everything';

const HISTORY_OPTIONS: SegmentedOptions<HistorySharing> = [
  { value: 'nothing', label: 'Nothing' },
  { value: 'twelve_weeks', label: '12 weeks' },
  { value: 'everything', label: 'Everything' },
];

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

        <View style={styles.field}>
          <Text size="label">Training history</Text>
          <SegmentedControl
            options={HISTORY_OPTIONS}
            value={historySharing}
            onChange={onHistorySharingChange}
          />
          <Text size="body-sm" tone="subtle">
            Workouts and logged sets from before you joined them.
          </Text>
        </View>

        <Divider />

        <ShareRow
          label="Body metrics"
          hint="Weight, measurements, progress photos."
          value={shareMetrics}
          onChange={onShareMetricsChange}
        />
        <ShareRow
          label="Nutrition"
          hint="Your food diary and macro history."
          value={shareNutrition}
          onChange={onShareNutritionChange}
        />

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

function ShareRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text size="label">{label}</Text>
        <Text size="body-sm" tone="subtle">
          {hint}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
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
  field: { gap: spacing(8) },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(14) },
  rowText: { flex: 1, gap: spacing(3) },
  signOut: { gap: spacing(8), marginTop: spacing(12) },
});
