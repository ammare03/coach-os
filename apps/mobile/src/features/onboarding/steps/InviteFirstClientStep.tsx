import { Card, FormField, Input, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useCoachOnboardingStore } from '../coach-store.ts';

// `phase-06-onboarding/coach-onboarding/04` — the flow's last step.
//
// The invite is the primary action and "later" is a real secondary, not a
// dismissal: a coach evaluating the product often has no client email to
// hand, and a hard block there is exactly where they close the app. Both
// paths call `me.completeOnboarding` and land in the coach shell — the
// flow owns that, not this step.
//
// No invite logic lives here. `invites.create` is fully built in
// `phase-03-identity-and-auth/invites/`, including the seat check.

export interface InviteFirstClientStepProps {
  error?: string | undefined;
}

export function InviteFirstClientStep({ error }: InviteFirstClientStepProps) {
  const inviteEmail = useCoachOnboardingStore((state) => state.fields.inviteEmail);
  const updateField = useCoachOnboardingStore((state) => state.updateField);

  return (
    <View style={styles.block}>
      <FormField label="Client email" hint="Clients join by invite. They can’t sign themselves up.">
        <Input
          value={inviteEmail}
          onChangeText={(value) => updateField('inviteEmail', value)}
          placeholder="Client email"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="done"
          state={error === undefined ? 'default' : 'error'}
        />
      </FormField>

      {/* L3 tinted — `DESIGN.md` §2's way to say "this is different"
          without colour-coding it. Never `urgent`: this is a fact about the
          invite, not a failure. */}
      <Card elevation="tinted">
        <Text size="body-sm" tone="warm">
          The invite stays open for 14 days. You can send more, or cancel this one, from Clients.
        </Text>
      </Card>

      {error !== undefined ? (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(20) },
});
