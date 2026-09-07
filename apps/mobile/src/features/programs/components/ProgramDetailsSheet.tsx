import { programs as programsSchemas } from '@coachos/schemas';
import {
  Divider,
  Input,
  NumberStepper,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  Text,
} from '@coachos/ui';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

// Frame 1h — the same sheet creates a program and edits one.
//
// **Name, notes and length live here, not at the top of the builder.** They
// are edited once and read never; spending a third of the builder's first
// screen on them would push the actual week/day structure below the fold
// (`program-builder/01`, decision (b)).
//
// Length is a STEPPER, never a free-text field, and its DB§5.2 bound is
// printed as a sub-label before the coach can reach it — a constraint read
// in advance is guidance, the same constraint delivered as a rejection is a
// wall (decision (c)).

const { minDurationWeeks, maxDurationWeeks } = programsSchemas.PROGRAM_BOUNDS;

export interface ProgramDetailsValues {
  name: string;
  description: string;
  durationWeeks: number;
  /**
   * `program-templates/01`. Only shown, and only meaningful, once a program
   * already exists (`mode === 'edit'`) — a freshly created program is
   * already a template by DB§5.2's own default, and `programs.create` takes
   * no `isTemplate` of its own (`program-templates/02`'s duplicate is the
   * same: it inherits the source's).
   */
  isTemplate: boolean;
}

export interface ProgramDetailsSheetProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialValues?: ProgramDetailsValues | undefined;
  isSaving?: boolean;
  /** `PROGRAM_DURATION_TOO_SHORT`, rendered under the stepper it belongs to. */
  lengthError?: string | undefined;
  onDismiss: () => void;
  onSave: (values: ProgramDetailsValues) => void;
}

const EMPTY: ProgramDetailsValues = {
  name: '',
  description: '',
  durationWeeks: 1,
  isTemplate: true,
};

export function ProgramDetailsSheet({
  isOpen,
  mode,
  initialValues,
  isSaving = false,
  lengthError,
  onDismiss,
  onSave,
}: ProgramDetailsSheetProps) {
  // Seeded once, on mount. The screen mounts this sheet only while it is
  // open, so "on mount" and "on open" are the same moment — which is what
  // keeps the draft fresh without an effect that fights the first render.
  const [values, setValues] = useState<ProgramDetailsValues>(initialValues ?? EMPTY);

  const trimmedName = values.name.trim();

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="program-details-sheet">
      <SheetHeader
        title="Program details"
        subtitle="Only you see the notes"
        onClose={onDismiss}
        density="coach"
      />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.field}>
          <Text size="eyebrow" tone="warm-muted">
            Name
          </Text>
          <Input
            value={values.name}
            onChangeText={(name) => {
              setValues((current) => ({ ...current, name }));
            }}
            placeholder="Hypertrophy block 2"
            accessibilityLabel="Program name"
            density="coach"
            returnKeyType="next"
            testID="program-name"
          />
        </View>

        <View style={styles.field}>
          <Text size="eyebrow" tone="warm-muted">
            Notes
          </Text>
          <Input
            value={values.description}
            onChangeText={(description) => {
              setValues((current) => ({ ...current, description }));
            }}
            placeholder="What this block is for"
            accessibilityLabel="Program notes"
            accessibilityHint="Only you see this"
            density="coach"
            multiline
            testID="program-notes"
          />
        </View>

        <Divider />

        <View style={styles.lengthRow}>
          <View style={styles.lengthLabel}>
            <Text size="eyebrow" tone="warm-muted">
              Length
            </Text>
            <Text size="caption" tone="subtle">
              {`${minDurationWeeks}–${maxDurationWeeks} weeks`}
            </Text>
          </View>
          <NumberStepper
            value={values.durationWeeks}
            onChange={(durationWeeks) => {
              setValues((current) => ({ ...current, durationWeeks }));
            }}
            step={1}
            min={minDurationWeeks}
            max={maxDurationWeeks}
            precision={0}
            density="coach"
            accessibilityLabel="length in weeks"
            testID="program-length"
          />
        </View>

        {lengthError ? (
          <Text size="body-sm" tone="urgent" testID="program-length-error">
            {lengthError}
          </Text>
        ) : null}

        {mode === 'edit' ? (
          <>
            <Divider />
            <View style={styles.templateRow}>
              <View style={styles.templateCopy}>
                <Text size="label">Reusable template</Text>
                {/* States the live-reference consequence as fact, never a
                    warning (`program-templates/04`'s resolution) — a
                    template edit reaches every client already assigned to
                    it, it does not fork a copy. Turning this off is not
                    destructive: nothing is lost, the program simply stops
                    offering itself for assignment, so it gets no confirm. */}
                <Text size="micro" tone="muted" style={styles.templateHint}>
                  Shows in Programs, ready to assign to any client. Edits you make here reach
                  everyone currently on it.
                </Text>
              </View>
              <Switch
                value={values.isTemplate}
                onValueChange={(isTemplate) => {
                  setValues((current) => ({ ...current, isTemplate }));
                }}
                accessibilityLabel="Reusable template"
                testID="program-is-template"
              />
            </View>
          </>
        ) : null}
      </ScrollView>
      <SheetFooter
        actionLabel={mode === 'create' ? 'Create program' : 'Save'}
        onAction={() => {
          onSave({ ...values, name: trimmedName, description: values.description.trim() });
        }}
        isActionDisabled={trimmedName.length === 0 || isSaving}
        isActionLoading={isSaving}
        density="coach"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(14), paddingTop: spacing(12), gap: spacing(14) },
  field: { gap: spacing(6) },
  lengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(12),
  },
  lengthLabel: { gap: spacing(3) },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(14),
  },
  templateCopy: { flex: 1, minWidth: 0, gap: spacing(4) },
  templateHint: { flexShrink: 1 },
});
