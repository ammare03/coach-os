import { spacing } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useClientOnboardingStore } from '../client-store.ts';
import { OpenChipSet } from '../components/OpenChipSet.tsx';

// `phase-06-onboarding/client-onboarding/04` — two open sets, both written
// to the local draft store and neither to the server (the
// accumulate-then-submit-once decision recorded in `GoalsStep.tsx`).
//
// Both lists below are STARTER lists, not enums. `equipment_access` and
// `dietary_restrictions` are `text[]` with no `CHECK`, so widening either
// list is a copy change with no migration behind it — and a client can add
// a value neither list has (`OpenChipSet`).
//
// The values are stored as the label, not as a slug, precisely because
// there is no enum to key a slug against: a slug would need a mapping table
// that the column itself does not enforce, and the first free-text addition
// would break its own rule.

const EQUIPMENT = [
  'Full gym',
  'Home gym',
  'Dumbbells',
  'Barbell & rack',
  'Kettlebells',
  'Resistance bands',
  'Pull-up bar',
  'Cardio machines',
  'Bodyweight only',
] as const;

// India is a primary market (`CLAUDE.md` §2), so eggetarian and Jain are in
// the starter list rather than left to free text.
const DIETARY = [
  'Vegetarian',
  'Vegan',
  'Eggetarian',
  'Halal',
  'Kosher',
  'Jain',
  'Lactose-free',
  'Gluten-free',
  'Nut allergy',
] as const;

export function EquipmentAndDietStep() {
  const equipmentAccess = useClientOnboardingStore((state) => state.fields.equipmentAccess);
  const dietaryRestrictions = useClientOnboardingStore((state) => state.fields.dietaryRestrictions);
  const updateField = useClientOnboardingStore((state) => state.updateField);

  return (
    <View style={styles.block}>
      <OpenChipSet
        label="Equipment"
        options={EQUIPMENT}
        selected={equipmentAccess}
        onChange={(next) => updateField('equipmentAccess', next)}
        addPlaceholder="Sled, sandbag, rings…"
      />

      <OpenChipSet
        label="Dietary needs"
        hint="Optional. Leave it empty if nothing applies."
        options={DIETARY}
        selected={dietaryRestrictions}
        onChange={(next) => updateField('dietaryRestrictions', next)}
        addPlaceholder="Shellfish, soy…"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(26) },
});
