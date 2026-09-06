import { client as clientSchemas, heightCm as heightCmSchema } from '@coachos/schemas';
import { Chip, FormField, Input, SegmentedControl, spacing, Text } from '@coachos/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { parseDateOfBirthInput } from '../../auth/date-of-birth.ts';
import { useClientOnboardingStore } from '../client-store.ts';
import { OptionCard } from '../components/OptionCard.tsx';
import { cmToFeetInches, parseHeightInput, type HeightUnit } from '../height.ts';

// `phase-06-onboarding/client-onboarding/03` — the flow's densest step and
// its most sensitive one. Four fields, all written to the local draft store
// and none to the server (the accumulate-then-submit-once decision recorded
// in `GoalsStep.tsx`).
//
// Every bound here comes from the shared schema rather than a number typed
// into this file: `heightCm` is `packages/schemas`' own primitive, which
// mirrors `client_profiles_height_cm_check` (50–260). A client-side bound
// that did not match the `CHECK` exactly would let a value pass here and
// fail at step 05's write, which is the failure this task's Risks section
// names.

/** Deliberately in the row with the rest, never behind a link (`client-onboarding/03`, Approach step 2). */
const SEX_LABEL: Record<clientSchemas.SexAtBirth, string> = {
  female: 'Female',
  male: 'Male',
  intersex: 'Intersex',
  prefer_not_to_say: 'Prefer not to say',
};

const EXPERIENCE_COPY: Record<
  clientSchemas.ExperienceLevel,
  { label: string; description: string }
> = {
  beginner: {
    label: 'New to this',
    description: 'Under a year, or coming back after a long break',
  },
  intermediate: { label: 'A year or two', description: 'Comfortable with the main lifts' },
  advanced: {
    label: 'Several years',
    description: 'Training consistently and know my numbers',
  },
};

const HEIGHT_UNITS = [
  { value: 'cm' as const, label: 'cm' },
  { value: 'ft' as const, label: 'ft / in' },
] as const;

export function MeasurementsStep() {
  const dateOfBirth = useClientOnboardingStore((state) => state.fields.dateOfBirth);
  const sexAtBirth = useClientOnboardingStore((state) => state.fields.sexAtBirth);
  const heightCm = useClientOnboardingStore((state) => state.fields.heightCm);
  const experienceLevel = useClientOnboardingStore((state) => state.fields.experienceLevel);
  const updateField = useClientOnboardingStore((state) => state.updateField);

  // What was TYPED, which is not the same as what is stored: "1" is a
  // half-typed height, not 1cm, and re-deriving the text from the stored
  // number would fight the person's cursor on every keystroke. The unit is
  // display state for the same reason and is deliberately not persisted —
  // it says nothing about the client, only about this screen.
  const [unit, setUnit] = useState<HeightUnit>('cm');
  const [dobText, setDobText] = useState(() => formatStoredDob(dateOfBirth));
  const [cmText, setCmText] = useState(() => (heightCm === null ? '' : String(heightCm)));
  const [feetText, setFeetText] = useState(() =>
    heightCm === null ? '' : String(cmToFeetInches(heightCm).feet),
  );
  const [inchesText, setInchesText] = useState(() =>
    heightCm === null ? '' : String(cmToFeetInches(heightCm).inches),
  );

  const dobError = dobText.length > 0 && parseDateOfBirthInput(dobText) === null;
  const heightError = heightOutOfBounds(unit, { cmText, feetText, inchesText });

  function onDobChange(value: string) {
    setDobText(value);
    const parsed = parseDateOfBirthInput(value);
    updateField('dateOfBirth', parsed ?? '');
  }

  function onHeightChange(next: { cmText?: string; feetText?: string; inchesText?: string }) {
    const cmNext = next.cmText ?? cmText;
    const feetNext = next.feetText ?? feetText;
    const inchesNext = next.inchesText ?? inchesText;
    setCmText(cmNext);
    setFeetText(feetNext);
    setInchesText(inchesNext);

    const parsed = parseHeightInput(unit, { cm: cmNext, feet: feetNext, inches: inchesNext });
    // Only an in-bounds value is stored. Out of bounds is shown as an
    // error and left unstored, so the flow can never carry a draft the
    // final write is guaranteed to reject.
    updateField(
      'heightCm',
      parsed !== null && heightCmSchema.safeParse(parsed).success ? parsed : null,
    );
  }

  function onUnitChange(next: HeightUnit) {
    setUnit(next);
    // Re-render the SAME stored centimetres in the other unit. Nothing is
    // converted in the store, and nothing is lost by switching back.
    if (heightCm === null) return;
    if (next === 'ft') {
      const { feet, inches } = cmToFeetInches(heightCm);
      setFeetText(String(feet));
      setInchesText(String(inches));
    } else {
      setCmText(String(heightCm));
    }
  }

  return (
    <View style={styles.block}>
      <FormField
        label="Date of birth"
        hint={dobError ? undefined : 'DD / MM / YYYY'}
        error={dobError ? 'Enter your date of birth as DD/MM/YYYY.' : undefined}
        isRequired
      >
        <Input
          value={dobText}
          onChangeText={onDobChange}
          placeholder="DD / MM / YYYY"
          keyboardType="number-pad"
          state={dobError ? 'error' : 'default'}
        />
      </FormField>

      <View>
        <Text size="label">Sex at birth</Text>
        <Text size="body-sm" tone="subtle" style={styles.hint}>
          Used for calorie and recovery estimates only.
        </Text>
        <View style={styles.chips}>
          {clientSchemas.SEXES_AT_BIRTH.map((value) => (
            <Chip
              key={value}
              label={SEX_LABEL[value]}
              selected={sexAtBirth === value}
              onPress={() => updateField('sexAtBirth', value)}
            />
          ))}
        </View>
      </View>

      <View>
        <View style={styles.heightHeader}>
          <Text size="label">Height</Text>
          <View style={styles.unitToggle}>
            <SegmentedControl options={HEIGHT_UNITS} value={unit} onChange={onUnitChange} />
          </View>
        </View>

        {unit === 'cm' ? (
          <FormField
            label="Height in centimetres"
            hint={heightError ? undefined : 'Between 50 and 260 cm.'}
            error={heightError ? 'Enter a height between 50 and 260 cm.' : undefined}
            isRequired
          >
            <Input
              value={cmText}
              onChangeText={(value) => onHeightChange({ cmText: value })}
              placeholder="cm"
              keyboardType="numeric"
              state={heightError ? 'error' : 'default'}
            />
          </FormField>
        ) : (
          <View style={styles.feetRow}>
            <View style={styles.flex}>
              <FormField
                label="Feet"
                hint={heightError ? undefined : 'Between 1ʹ8ʺ and 8ʹ6ʺ.'}
                error={heightError ? 'Enter a height between 1ʹ8ʺ and 8ʹ6ʺ.' : undefined}
                isRequired
              >
                <Input
                  value={feetText}
                  onChangeText={(value) => onHeightChange({ feetText: value })}
                  placeholder="ft"
                  keyboardType="numeric"
                  state={heightError ? 'error' : 'default'}
                />
              </FormField>
            </View>
            <View style={styles.flex}>
              <FormField label="Inches" hint=" ">
                <Input
                  value={inchesText}
                  onChangeText={(value) => onHeightChange({ inchesText: value })}
                  placeholder="in"
                  keyboardType="numeric"
                />
              </FormField>
            </View>
          </View>
        )}
      </View>

      <View>
        <Text size="label">How long have you been training?</Text>
        <View style={styles.options}>
          {clientSchemas.EXPERIENCE_LEVELS.map((value) => (
            <OptionCard
              key={value}
              label={EXPERIENCE_COPY[value].label}
              description={EXPERIENCE_COPY[value].description}
              selected={experienceLevel === value}
              onPress={() => updateField('experienceLevel', value)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

/** `"yyyy-MM-dd"` back to what a person types, so a resumed draft opens on their own value. */
function formatStoredDob(stored: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stored);
  const year = match?.[1];
  const month = match?.[2];
  const day = match?.[3];
  if (year === undefined || month === undefined || day === undefined) return '';
  return `${day} / ${month} / ${year}`;
}

/** Typed but not a value `heightCm` accepts — an empty field is not an error, it is unanswered. */
function heightOutOfBounds(
  unit: HeightUnit,
  text: { cmText: string; feetText: string; inchesText: string },
): boolean {
  const typed = unit === 'cm' ? text.cmText : text.feetText;
  if (typed.trim() === '') return false;
  const parsed = parseHeightInput(unit, {
    cm: text.cmText,
    feet: text.feetText,
    inches: text.inchesText,
  });
  return parsed === null || !heightCmSchema.safeParse(parsed).success;
}

const styles = StyleSheet.create({
  block: { gap: spacing(26) },
  flex: { flex: 1 },
  hint: { marginTop: spacing(4) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(8), marginTop: spacing(12) },
  heightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  unitToggle: { width: 160 },
  feetRow: { flexDirection: 'row', gap: spacing(10) },
  options: { gap: spacing(10), marginTop: spacing(12) },
});
