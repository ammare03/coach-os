import {
  Button,
  Card,
  createThemedStyles,
  FormField,
  IconButton,
  Input,
  Metric,
  NumberStepper,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExercisePickerSheet } from '../components/ExercisePickerSheet.tsx';
import { useProgramDraft } from '../hooks/useProgramDraft.ts';

// `phase-06-onboarding/coach-onboarding/03` — a deliberately minimal
// program builder, and NOT a preview of P07's.
//
// What makes it acceptable to ship a simplified builder is that it is only
// the UI that is simplified: `programs.create` writes ordinary
// `training.programs` rows, so this program opens in P07's real builder and
// extends to twelve weeks with supersets without a migration.
//
// **"Import a template" is deliberately absent rather than disabled.**
// Program templates are `phase-07-exercise-and-program-authoring/
// program-templates/`, so at this point in the build order there is nothing
// to import — and a visibly dead control on the first program a coach ever
// makes is worse than an option that arrives later.

/** `program_exercises_target_sets_check` — `BETWEEN 1 AND 20`. */
const MAX_TARGET_SETS = 20;

export interface ProgramStepProps {
  error?: string | undefined;
}

export function ProgramStep({ error }: ProgramStepProps) {
  const draft = useProgramDraft();
  const [pickerDayIndex, setPickerDayIndex] = useState<number | null>(null);
  const theme = useTheme();
  const themed = useThemedStyles();

  const pickerDay = pickerDayIndex === null ? null : draft.days[pickerDayIndex];

  return (
    <View style={styles.block}>
      <FormField label="Program name">
        <Input
          value={draft.programName}
          onChangeText={draft.setProgramName}
          placeholder="Program name"
          autoCapitalize="sentences"
          returnKeyType="next"
        />
      </FormField>

      <View style={styles.days}>
        {draft.days.map((day, dayIndex) => (
          <Card key={dayIndex} elevation="raised">
            <FormField label={`Day ${dayIndex + 1}`}>
              <Input
                value={day.name}
                onChangeText={(name) => draft.renameDay(dayIndex, name)}
                placeholder={`Day ${dayIndex + 1}`}
                autoCapitalize="sentences"
              />
            </FormField>

            {day.exercises.length === 0 ? (
              // Not an `EmptyState`: this is a row inside a card, not a
              // screen, and a day with nothing on it is a valid choice
              // rather than a state to recover from.
              <Text size="body-sm" tone="subtle" style={styles.dayEmpty}>
                You can leave a day empty and fill it in later.
              </Text>
            ) : (
              <View style={styles.exercises}>
                {day.exercises.map((exercise) => (
                  <View key={exercise.exerciseId} style={[styles.exerciseRow, themed.exerciseRow]}>
                    <View style={styles.exerciseText}>
                      <Text size="label">{exercise.exerciseName}</Text>
                      <Metric
                        size="numeral"
                        tone="warm"
                        value={`${exercise.targetSets} × ${exercise.targetRepsMin}–${exercise.targetRepsMax}`}
                      />
                    </View>
                    <NumberStepper
                      value={exercise.targetSets}
                      onChange={(sets) => draft.setTargetSets(dayIndex, exercise.exerciseId, sets)}
                      step={1}
                      min={1}
                      max={MAX_TARGET_SETS}
                      accessibilityLabel={`sets for ${exercise.exerciseName}`}
                    />
                    <IconButton
                      icon={<X size={18} color={theme.colors.fg.muted} />}
                      variant="ghost"
                      size="sm"
                      onPress={() => draft.removeExercise(dayIndex, exercise.exerciseId)}
                      accessibilityLabel={`Remove ${exercise.exerciseName}`}
                    />
                  </View>
                ))}
              </View>
            )}

            <View style={styles.add}>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                onPress={() => setPickerDayIndex(dayIndex)}
                iconLeft={<Plus size={16} color={theme.colors.brand.DEFAULT} />}
                accessibilityLabel={`Add exercise to ${day.name}`}
              >
                Add exercise
              </Button>
            </View>
          </Card>
        ))}
      </View>

      {error !== undefined ? (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <ExercisePickerSheet
        isOpen={pickerDay !== null}
        dayName={pickerDay?.name ?? ''}
        alreadyAdded={pickerDay?.exercises.map((e) => e.exerciseId) ?? []}
        onAdd={(added) => {
          if (pickerDayIndex !== null) draft.addExercises(pickerDayIndex, added);
        }}
        onDismiss={() => setPickerDayIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(22) },
  days: { gap: spacing(12) },
  dayEmpty: { marginTop: spacing(10) },
  exercises: { marginTop: spacing(6) },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    paddingVertical: spacing(11),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  exerciseText: { flex: 1, gap: spacing(3) },
  add: { marginTop: spacing(12) },
});

const useThemedStyles = createThemedStyles((theme) => ({
  exerciseRow: { borderBottomColor: theme.colors.border.soft },
}));
