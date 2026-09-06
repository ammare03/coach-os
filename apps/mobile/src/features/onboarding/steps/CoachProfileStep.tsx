import { coach as coachSchemas } from '@coachos/schemas';
import { Chip, FormField, Input, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useCoachOnboardingStore } from '../coach-store.ts';

// `phase-06-onboarding/coach-onboarding/02` — the flow's first real fields.
//
// Every keystroke goes to the local draft store and nothing else. The
// server write happens once, when the flow advances past this step (the
// task's Approach step 3) — submitting per keystroke would be write traffic
// bought for resilience the draft store already provides.

/**
 * The display half of `COACH_SPECIALTIES`. The slugs are the stored value
 * and the schema's business; these words are this screen's, so renaming one
 * is a copy change rather than a data migration.
 */
const SPECIALTY_LABEL: Record<coachSchemas.CoachSpecialty, string> = {
  strength: 'Strength',
  hypertrophy: 'Hypertrophy',
  'fat-loss': 'Fat loss',
  powerlifting: 'Powerlifting',
  bodybuilding: 'Bodybuilding',
  'general-fitness': 'General fitness',
  mobility: 'Mobility',
  'sport-specific': 'Sport-specific',
  endurance: 'Endurance',
  'pre-post-natal': 'Pre & post-natal',
};

export interface CoachProfileStepProps {
  /** Present only after a write this step submitted came back failed. */
  error?: string | undefined;
}

export function CoachProfileStep({ error }: CoachProfileStepProps) {
  const businessName = useCoachOnboardingStore((state) => state.fields.businessName);
  const specialties = useCoachOnboardingStore((state) => state.fields.specialties);
  const updateField = useCoachOnboardingStore((state) => state.updateField);

  function toggleSpecialty(slug: coachSchemas.CoachSpecialty) {
    const next = specialties.includes(slug)
      ? specialties.filter((value) => value !== slug)
      : [...specialties, slug];
    updateField('specialties', next);
  }

  return (
    <View style={styles.block}>
      <FormField label="Business name" hint="Your own name works fine.">
        <Input
          value={businessName}
          onChangeText={(value) => updateField('businessName', value)}
          placeholder="Business name"
          autoCapitalize="words"
          autoComplete="organization"
          returnKeyType="next"
        />
      </FormField>

      <View>
        <Text size="label">What you coach</Text>
        <Text size="body-sm" tone="subtle" style={styles.hint}>
          Pick as many as fit. Optional.
        </Text>
        <View style={styles.chips}>
          {coachSchemas.COACH_SPECIALTIES.map((slug) => (
            <Chip
              key={slug}
              label={SPECIALTY_LABEL[slug]}
              selected={specialties.includes(slug)}
              onPress={() => toggleSpecialty(slug)}
            />
          ))}
        </View>
      </View>

      {error !== undefined ? (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(24) },
  hint: { marginTop: spacing(4) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(8), marginTop: spacing(12) },
});
