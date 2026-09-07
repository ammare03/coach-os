import {
  createThemedStyles,
  Input,
  Pressable,
  radius,
  SegmentedControl,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  Text,
} from '@coachos/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProgramDay } from '../api/programs.ts';
import { DAY_SLOTS, dayFullLabel, dayPillLabel } from '../program-days.ts';

// "Add day" (`program-builder/01`, frame 1a) with frame 1g's slot rule:
// **collision is prevented, not reported.** A taken slot is dashed, inert,
// and names its occupant, so the coach cannot select the failure in the
// first place — `PROGRAM_DAY_TAKEN` then only ever fires on a stale client
// or two devices racing, which is where a server-side refusal belongs.

const REST_DAY_NAME = 'Rest';

type DayKind = 'training' | 'rest';

export interface AddDaySheetProps {
  isOpen: boolean;
  weekNumber: number;
  /** The week's existing days — what makes a slot inert, and what it is named after. */
  takenDays: readonly ProgramDay[];
  isSaving?: boolean;
  onDismiss: () => void;
  onAdd: (values: { dayNumber: number; name: string; isRestDay: boolean }) => void;
}

export function AddDaySheet({
  isOpen,
  weekNumber,
  takenDays,
  isSaving = false,
  onDismiss,
  onAdd,
}: AddDaySheetProps) {
  const themed = useThemedStyles();
  // No reset effect: the screen mounts this sheet only while a week is
  // chosen, so every open is a fresh mount and the draft starts empty by
  // construction rather than by an effect racing the first render.
  const [kind, setKind] = useState<DayKind>('training');
  const [dayNumber, setDayNumber] = useState<number | null>(null);
  const [name, setName] = useState('');

  const occupantOf = new Map(takenDays.map((day) => [day.dayNumber, day.name]));
  const isRestDay = kind === 'rest';
  const resolvedName = isRestDay ? REST_DAY_NAME : name.trim();
  const canAdd = dayNumber !== null && resolvedName.length > 0 && !isSaving;

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="add-day-sheet">
      <SheetHeader
        title="Add a day"
        subtitle={`Week ${weekNumber}`}
        onClose={onDismiss}
        density="coach"
      />
      <View style={styles.body}>
        <SegmentedControl
          options={[
            { value: 'training', label: 'Training day' },
            { value: 'rest', label: 'Rest day' },
          ]}
          value={kind}
          onChange={setKind}
          testID="day-kind"
        />

        <View style={styles.field}>
          <Text size="eyebrow" tone="warm-muted">
            On which day
          </Text>
          <View style={styles.slots}>
            {DAY_SLOTS.map((slot) => {
              const occupant = occupantOf.get(slot);
              const isTaken = occupant !== undefined;
              const isSelected = dayNumber === slot;
              return (
                <Pressable
                  key={slot}
                  disabled={isTaken}
                  onPress={() => {
                    setDayNumber(slot);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={dayFullLabel(slot)}
                  // The reason it cannot be picked, spoken — a slot that is
                  // merely dimmed is silent to a screen reader
                  // (`accessibility` §2).
                  accessibilityHint={isTaken ? `Already used by ${occupant}` : 'Free'}
                  accessibilityState={{ disabled: isTaken, selected: isSelected }}
                  style={[
                    styles.slot,
                    isTaken ? themed.slotTaken : themed.slotFree,
                    isSelected ? themed.slotSelected : null,
                  ]}
                  testID={`day-slot-${slot}`}
                >
                  {/* Seven slots share one row's width, so neither label
                      can wrap. Capped rather than clipped — the slot's
                      `accessibilityLabel` and hint carry the full day name
                      and its occupant at any text size. */}
                  <Text
                    size="micro"
                    tone={isTaken ? 'faint' : 'default'}
                    maxFontSizeMultiplier={1.3}
                  >
                    {dayPillLabel(slot)}
                  </Text>
                  <Text
                    size="micro"
                    tone={isTaken ? 'faint' : 'warm'}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                  >
                    {occupant ?? 'free'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {isRestDay ? null : (
          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              Name
            </Text>
            <Input
              value={name}
              onChangeText={setName}
              placeholder="Upper — press focus"
              accessibilityLabel="Day name"
              density="coach"
              testID="day-name"
            />
          </View>
        )}
      </View>
      <SheetFooter
        actionLabel={isRestDay ? 'Add rest day' : 'Add day'}
        onAction={() => {
          if (dayNumber === null) return;
          onAdd({ dayNumber, name: resolvedName, isRestDay });
        }}
        isActionDisabled={!canAdd}
        isActionLoading={isSaving}
        density="coach"
      />
    </Sheet>
  );
}

const SLOT_HEIGHT = 54;

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(14), paddingTop: spacing(12), gap: spacing(14) },
  field: { gap: spacing(8) },
  slots: { flexDirection: 'row', gap: spacing(5) },
  slot: {
    flex: 1,
    minHeight: SLOT_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(3),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  slotFree: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  // Dashed and transparent, exactly as frame 1g: the slot still renders and
  // still names its occupant, it just cannot be chosen.
  slotTaken: {
    backgroundColor: 'transparent',
    borderColor: t.colors.border.soft,
    borderStyle: 'dashed',
  },
  slotSelected: { borderColor: t.colors.brand.DEFAULT, backgroundColor: t.colors.bg.raised },
}));
