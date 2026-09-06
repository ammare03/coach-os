import { client as clientSchemas } from '@coachos/schemas';
import { FormField, Input, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useClientOnboardingStore } from '../client-store.ts';
import { OptionCard } from '../components/OptionCard.tsx';

// `phase-06-onboarding/client-onboarding/02` — the client flow's first real
// content step.
//
// **The accumulate-then-submit-once decision, recorded here once for the
// whole flow** (this task's Approach step 4, so tasks 03 and 04 do not
// re-decide it): steps 02–04 write to the local draft store and nothing
// else. There is exactly one server write in this flow, at step 05, and it
// sends the whole accumulated draft to `client.updateProfile`.
//
// Five partial writes would be five round trips and five ways for a
// mid-flow failure to leave `client_profiles` half-written. The cost is
// that nothing reaches the server until the last step — acceptable,
// because the draft store already survives an app kill
// (`onboarding-infrastructure/01`) and a client who abandons the flow has
// given a coach nothing to act on either way.
//
// The medical disclaimer is NOT surfaced here. It is step 1 of this flow's
// own sequence (`client-steps.ts`), for the reason that file states — the
// same shape the coach flow uses, and a gate the person cannot pass
// without acknowledging.

/**
 * The words this screen says, against the stored enum values. The slugs are
 * the database's business; these are the screen's, so rewording one is a
 * copy change rather than a migration.
 */
const GOAL_COPY: Record<clientSchemas.TrainingGoal, { label: string; description?: string }> = {
  fat_loss: { label: 'Lose fat' },
  muscle_gain: { label: 'Build muscle' },
  performance: { label: 'Get stronger or faster' },
  health: { label: 'Feel healthier day to day' },
  other: { label: 'Something else' },
};

const NOTES_MAX = 1000;

export function GoalsStep() {
  const goal = useClientOnboardingStore((state) => state.fields.goal);
  const goalNotes = useClientOnboardingStore((state) => state.fields.goalNotes);
  const updateField = useClientOnboardingStore((state) => state.updateField);

  return (
    <View style={styles.block}>
      <View style={styles.options}>
        {clientSchemas.TRAINING_GOALS.map((value) => {
          const copy = GOAL_COPY[value];
          return (
            <OptionCard
              key={value}
              label={copy.label}
              description={copy.description}
              selected={goal === value}
              onPress={() => updateField('goal', value)}
            />
          );
        })}
      </View>

      <FormField
        label="Anything your coach should know?"
        hint="Optional. A race you’re training for, a weight you want back, a body part you’re rehabbing."
      >
        <Input
          value={goalNotes}
          onChangeText={(value) => updateField('goalNotes', value)}
          placeholder="Optional"
          multiline
          maxLength={NOTES_MAX}
          autoCapitalize="sentences"
        />
      </FormField>

      <Text size="body-sm" tone="subtle">
        You and your coach can change this together at any time.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(26) },
  options: { gap: spacing(10) },
});
