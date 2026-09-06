import { Button, Chip, Input, spacing, Text } from '@coachos/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

// `client-onboarding/04` — a wrapping multi-select over a starter list,
// plus a way to add a value the list does not have.
//
// The "plus" is the point, not a convenience. `equipment_access` and
// `dietary_restrictions` are `text[]` with **no** `CHECK` (DB§4's "likely
// to grow" pattern), deliberately, because equipment and dietary needs are
// genuinely open-ended. Limiting selection to the starter list would work
// against the columns' own design — a client with a Jain diet or a
// shellfish allergy has to be able to say so.
//
// Chips wrap onto a second line rather than scrolling sideways: a client
// has to see every option to answer accurately, which is exactly the case
// `Chip`'s own contract calls out.

export interface OpenChipSetProps {
  label: string;
  hint?: string | undefined;
  /** The starter list. A UI convenience — never a constraint on the column. */
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  /** Placeholder for the free-text field, e.g. "Shellfish". */
  addPlaceholder: string;
}

export function OpenChipSet({
  label,
  hint,
  options,
  selected,
  onChange,
  addPlaceholder,
}: OpenChipSetProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // The starter list first, in its own order, then anything the client
  // added — so the set they typed does not reshuffle as they add to it.
  const custom = selected.filter((value) => !options.includes(value));

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  function commitDraft() {
    const value = draft.trim();
    setDraft('');
    setIsAdding(false);
    if (value.length === 0 || selected.includes(value)) return;
    onChange([...selected, value]);
  }

  return (
    <View>
      <Text size="label">{label}</Text>
      {hint === undefined ? null : (
        <Text size="body-sm" tone="subtle" style={styles.hint}>
          {hint}
        </Text>
      )}

      <View style={styles.chips}>
        {options.map((value) => (
          <Chip
            key={value}
            label={value}
            selected={selected.includes(value)}
            onPress={() => toggle(value)}
          />
        ))}
        {custom.map((value) => (
          <Chip key={value} label={value} selected onRemove={() => toggle(value)} />
        ))}
        {/* Both sets render an identically-worded add chip, so each
            carries the field it belongs to as its test id — the visible
            label is the same three words on purpose. */}
        <Chip
          label="+ Add your own"
          onPress={() => setIsAdding(true)}
          testID={`add-to-${slug(label)}`}
        />
      </View>

      {isAdding ? (
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder={addPlaceholder}
              autoCapitalize="sentences"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={commitDraft}
              accessibilityLabel={`Add to ${label.toLowerCase()}`}
            />
          </View>
          <Button variant="secondary" onPress={commitDraft} disabled={draft.trim().length === 0}>
            Add
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** `Dietary needs` → `dietary-needs`. */
function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { marginTop: spacing(4) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(8), marginTop: spacing(12) },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(8), marginTop: spacing(12) },
});
