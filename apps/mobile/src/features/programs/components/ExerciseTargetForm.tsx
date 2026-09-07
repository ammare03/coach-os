import type { exercises as exercisesSchemas } from '@coachos/schemas';
import {
  Button,
  Chip,
  createThemedStyles,
  Divider,
  FormField,
  Input,
  NumberStepper,
  Pressable,
  radius,
  SegmentedControl,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  Text,
  useTheme,
  type SegmentedOptions,
} from '@coachos/ui';
import { Repeat2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import {
  approvedAccessibilityLabel,
  approvedSummary,
  type ApprovedAlternative,
} from '../alternatives.ts';
import {
  INTENSITY_CLEAR_HINT,
  intensityControl,
  intensityValueOf,
  newTargetDraft,
  REST_PRESETS_SECONDS,
  sanitiseRepsInput,
  sanitiseTempoInput,
  TARGET_BOUNDS,
  TEMPO_CAPTIONS,
  targetDraftToInput,
  validateTargetDraft,
  withIntensityValue,
  type IntensitySegment,
  type TargetDraft,
} from '../exercise-targets.ts';

import { ApprovedSwapsSheet } from './ApprovedSwapsSheet.tsx';

// The target sheet, frame 1c (`program-builder/02`). Six decisions from the
// approved design, each load-bearing:
//
// 1. **Every DB§5.2 bound prints as a sub-label before it is hit** — "1–20"
//    under Sets, "1–10, half steps" under the intensity stepper. A
//    constraint a coach reads in advance is guidance; the same constraint
//    delivered as a rejection is a wall.
// 2. **Cross-field rep validation is live.** The max field takes the urgent
//    border the moment it drops below the min, and the message says what is
//    wrong in the same words the server would have used
//    (`REP_RANGE_ORDER_MESSAGE`, shared).
// 3. **The commit button degrades to an inert state that says what is
//    wrong** — "Fix the rep range to continue", never a silently greyed-out
//    button the coach has to reverse-engineer.
// 4. **Tempo is four single-character fields with plain-English captions**
//    (down / pause / up / pause), never one free-text box whose format the
//    coach has to guess.
// 5. **Intensity is a segmented control, then one stepper** — RPE, RIR,
//    % 1RM or an absolute Weight. One of them, which is why the schema
//    refuses two: an absolute load and a relative one prescribe the same
//    set twice and can disagree. Weight replaced the design's fourth
//    segment, `None`, because a load a coach writes out is a real
//    prescription rather than the absence of one — and no intensity at all
//    is reached by tapping the highlighted segment again, which is what
//    `INTENSITY_CLEAR_HINT` says out loud under the control.
//
//    The weight is entered in whatever `users.weight_unit` says and stored
//    in kilograms, converted once, here, through `packages/utils`
//    (`CLAUDE.md` §0). The step is the unit's own plate increment, never a
//    converted one.
// 6. **Defaults arrive pre-filled** (4 × 6–8 @ RPE 8, 90s), so the common
//    case is a confirm rather than a form.
//
// Server-side validation is still the backstop, never the first line of
// defence: everything above is what stops a coach *reaching* a rejection.
//
// Composable on purpose, and `program-builder/05` took that up: the
// approved-swaps section sits below Notes, added without restructuring
// anything above it. It is `alternatives`-prop-gated and therefore EDIT
// ONLY — a swap list is attached to a `program_exercises` row, and in
// create mode there is no row yet to attach one to. Exactly the shape
// `onRemove` already had, for exactly the same reason.

// `SegmentedControl` types its options as a 2-4 tuple on purpose — four is
// the ceiling, and this is exactly four. `'none'` is deliberately not among
// them: it is this control with nothing selected.
const INTENSITY_OPTIONS: SegmentedOptions<IntensitySegment> = [
  { value: 'rpe', label: 'RPE' },
  { value: 'rir', label: 'RIR' },
  { value: 'percent', label: '% 1RM' },
  { value: 'weight', label: 'Weight' },
];

/** Stable keys for the four fixed tempo positions — "pause" appears twice. */
const TEMPO_FIELD_KEYS = ['eccentric', 'bottom-pause', 'concentric', 'top-pause'] as const;

const NUMFIELD_HEIGHT = 52;
const TEMPO_MAX_SCALE = 1.6;

/**
 * Everything the approved-swaps section needs, in one prop rather than six
 * loose ones — "does this block have swaps" and "what are they" are one
 * fact, and the section is either wired or absent, never half of each.
 */
export interface AlternativesSection {
  /** The block's own exercise — inert in the picker, and named in the copy. */
  originExerciseId: string;
  /** Opens the picker's pattern filter on the movement being replaced. */
  originMovementPattern: exercisesSchemas.MovementPatternValue;
  /** What is saved today, in the coach's own order. */
  approved: readonly ApprovedAlternative[];
  isSaving?: boolean | undefined;
  saveError?: string | undefined;
  onSave: (alternativeExerciseIds: string[]) => void;
}

export interface ExerciseTargetFormProps {
  isOpen: boolean;
  /** The exercise this block is for — the sheet is titled after it. */
  exerciseName: string;
  /** "Quadriceps · Barbell", straight from the library row. */
  exerciseMeta?: string | undefined;
  mode: 'create' | 'edit';
  initialDraft?: TargetDraft | undefined;
  isSaving?: boolean;
  /** A refusal the server made anyway — rendered above the commit, never swallowed. */
  saveError?: string | undefined;
  /**
   * Edit mode only. Removing a block performs immediately and offers a
   * five-second undo — it does not ask first (`ui-conventions` §5), which
   * is why the caller owns both the optimistic removal and the toast.
   * Absent in create mode: there is nothing yet to remove.
   */
  onRemove?: (() => void) | undefined;
  /**
   * Edit mode only, and for the same reason `onRemove` is: the swap list
   * lives on a `program_exercises` row, and create mode has none yet
   * (`program-builder/05`). Absent, the section is not rendered at all —
   * an inert "you can set these once you save" row would be a promise the
   * sheet has no way to keep.
   *
   * Saved on its own procedure (`programs.exercises.setAlternatives`),
   * never folded into this sheet's commit: approving swaps is a separate
   * write with a separate integrity check, and a coach who dismisses the
   * target sheet without saving must not silently lose swaps they already
   * approved.
   */
  alternatives?: AlternativesSection | undefined;
  onDismiss: () => void;
  onSubmit: (targets: NonNullable<ReturnType<typeof targetDraftToInput>>) => void;
}

export function ExerciseTargetForm({
  isOpen,
  exerciseName,
  exerciseMeta,
  mode,
  initialDraft,
  isSaving = false,
  saveError,
  onRemove,
  alternatives,
  onDismiss,
  onSubmit,
}: ExerciseTargetFormProps) {
  // Seeded once, on mount — the screen mounts this sheet only while it is
  // open, so "on mount" and "on open" are the same moment and no effect has
  // to race the first render (`ecc:react-patterns`).
  const [draft, setDraft] = useState<TargetDraft>(initialDraft ?? newTargetDraft());
  const [isSwapsOpen, setSwapsOpen] = useState(false);
  // Display only. It decides what the stepper below shows and what one
  // press moves by; the draft holds kilograms either way.
  const unit = useWeightUnit();

  const issues = validateTargetDraft(draft);
  const intensity = intensityControl(draft.intensity.mode, unit);
  const isCustomRest =
    draft.targetRestSeconds !== null &&
    !REST_PRESETS_SECONDS.some((preset) => preset === draft.targetRestSeconds);

  const actionLabel =
    issues.blockingActionLabel ?? (mode === 'create' ? 'Add exercise' : 'Save targets');

  return (
    <>
      <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="full" testID="exercise-target-sheet">
        <SheetHeader
          title={exerciseName}
          {...(exerciseMeta === undefined ? {} : { subtitle: exerciseMeta })}
          onClose={onDismiss}
          density="coach"
        />
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.splitRow}>
            <View style={styles.labelStack}>
              <Text size="eyebrow" tone="warm-muted">
                Sets
              </Text>
              <Text size="caption" tone="subtle">
                {`${TARGET_BOUNDS.minTargetSets}–${TARGET_BOUNDS.maxTargetSets}`}
              </Text>
            </View>
            <NumberStepper
              value={draft.targetSets}
              onChange={(targetSets) => {
                setDraft((current) => ({ ...current, targetSets }));
              }}
              step={1}
              min={TARGET_BOUNDS.minTargetSets}
              max={TARGET_BOUNDS.maxTargetSets}
              precision={0}
              density="coach"
              accessibilityLabel="sets"
              testID="target-sets"
            />
          </View>

          <Divider />

          {/* `FormField` owns the label / message anatomy, the reserved
            message slot that stops an appearing error shifting the control
            above it, and the error glyph — it is the design system's answer
            to a validated field, and the only sanctioned consumer of the
            urgent ramp outside `packages/ui` (`eslint.react-native.js`'s
            own allowlist). The message it renders is the same sentence the
            server would have returned. */}
          <FormField label="Rep range" error={issues.repRange ?? undefined} density="coach">
            <View style={styles.repRow}>
              <NumberField
                value={draft.targetRepsMin}
                onChangeText={(text) => {
                  setDraft((current) => ({ ...current, targetRepsMin: sanitiseRepsInput(text) }));
                }}
                isInvalid={issues.repsMinInvalid}
                accessibilityLabel="Lowest rep"
                {...(issues.repRange === null ? {} : { accessibilityHint: issues.repRange })}
                testID="target-reps-min"
              />
              <Text size="caption" tone="subtle">
                to
              </Text>
              <NumberField
                value={draft.targetRepsMax}
                onChangeText={(text) => {
                  setDraft((current) => ({ ...current, targetRepsMax: sanitiseRepsInput(text) }));
                }}
                isInvalid={issues.repsMaxInvalid}
                accessibilityLabel="Highest rep"
                {...(issues.repRange === null ? {} : { accessibilityHint: issues.repRange })}
                testID="target-reps-max"
              />
            </View>
          </FormField>

          <Divider />

          <View style={styles.section}>
            <Text size="eyebrow" tone="warm-muted">
              Intensity
            </Text>
            <SegmentedControl
              options={INTENSITY_OPTIONS}
              // Nothing selected is a real state here, not a missing one.
              value={draft.intensity.mode === 'none' ? null : draft.intensity.mode}
              onChange={(mode) => {
                setDraft((current) => ({
                  ...current,
                  // Pressing the segment that is already on clears it. A
                  // coach still has to be able to prescribe no intensity at
                  // all, and this is the gesture that says so without a
                  // fifth segment pretending "nothing" is a kind of
                  // instruction.
                  intensity: {
                    ...current.intensity,
                    mode: current.intensity.mode === mode ? 'none' : mode,
                  },
                }));
              }}
              density="coach"
              testID="intensity-mode"
            />
            {intensity === null ? (
              <Text size="caption" tone="subtle">
                The client trains this to the rep range alone.
              </Text>
            ) : (
              <>
                <View style={styles.splitRow}>
                  <Text size="caption" tone="subtle">
                    {intensity.boundLabel}
                  </Text>
                  <NumberStepper
                    value={intensityValueOf(draft.intensity, unit)}
                    onChange={(value) => {
                      setDraft((current) => ({
                        ...current,
                        intensity: withIntensityValue(current.intensity, value, unit),
                      }));
                    }}
                    step={intensity.step}
                    min={intensity.min}
                    max={intensity.max}
                    precision={intensity.precision}
                    {...(intensity.unit === undefined ? {} : { unit: intensity.unit })}
                    {...(intensity.unitLabel === undefined
                      ? {}
                      : { unitLabel: intensity.unitLabel })}
                    density="coach"
                    accessibilityLabel={intensity.accessibilityLabel}
                    testID="target-intensity"
                  />
                </View>
                <Text size="micro" tone="subtle">
                  {INTENSITY_CLEAR_HINT}
                </Text>
              </>
            )}
          </View>

          <Divider />

          {/* Four single-character fields with plain-English captions,
            never one free-text box: `^[0-9X]{4}$` is a format a coach
            should be shown, not asked to guess. */}
          <FormField
            label="Tempo"
            hint="Optional. Seconds per phase, or X for as fast as possible."
            error={issues.tempo ?? undefined}
            density="coach"
          >
            <View style={styles.section}>
              <View style={styles.tempoRow}>
                {draft.tempo.map((position, index) => (
                  <NumberField
                    // Fixed four positions in a fixed order — the index IS
                    // the identity, and there is nothing else to key on.
                    key={TEMPO_FIELD_KEYS[index]}
                    value={position}
                    onChangeText={(text) => {
                      setDraft((current) => {
                        const next: [string, string, string, string] = [...current.tempo] as [
                          string,
                          string,
                          string,
                          string,
                        ];
                        next[index] = sanitiseTempoInput(text);
                        return { ...current, tempo: next };
                      });
                    }}
                    isInvalid={issues.tempo !== null && position === ''}
                    accessibilityLabel={`Tempo, ${TEMPO_CAPTIONS[index] ?? ''}`}
                    accessibilityHint="One number, or X for as fast as possible"
                    maxLength={1}
                    testID={`target-tempo-${index}`}
                  />
                ))}
              </View>
              <View style={styles.tempoRow}>
                {TEMPO_CAPTIONS.map((caption, index) => (
                  <Text
                    key={TEMPO_FIELD_KEYS[index]}
                    size="micro"
                    tone="subtle"
                    style={styles.tempoCaption}
                    maxFontSizeMultiplier={TEMPO_MAX_SCALE}
                    // Each field already says which phase it is; repeating
                    // the caption would announce every position twice.
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {caption}
                  </Text>
                ))}
              </View>
            </View>
          </FormField>

          <Divider />

          <View style={styles.section}>
            <Text size="eyebrow" tone="warm-muted">
              Rest between sets
            </Text>
            <View style={styles.chipRow}>
              {REST_PRESETS_SECONDS.map((preset) => (
                <Chip
                  key={preset}
                  label={restPresetLabel(preset)}
                  selected={draft.targetRestSeconds === preset}
                  onPress={() => {
                    setDraft((current) => ({ ...current, targetRestSeconds: preset }));
                  }}
                  testID={`rest-${preset}`}
                />
              ))}
              <Chip
                label="Custom"
                selected={isCustomRest}
                onPress={() => {
                  setDraft((current) => ({
                    ...current,
                    // Opens on the last preset's value rather than empty, so
                    // "custom" starts from something a coach can nudge.
                    targetRestSeconds: current.targetRestSeconds ?? 90,
                  }));
                }}
                testID="rest-custom"
              />
            </View>
            {isCustomRest ? (
              <View style={styles.splitRow}>
                <Text size="caption" tone="subtle">
                  seconds
                </Text>
                <NumberStepper
                  value={draft.targetRestSeconds ?? 0}
                  onChange={(targetRestSeconds) => {
                    setDraft((current) => ({ ...current, targetRestSeconds }));
                  }}
                  step={5}
                  min={0}
                  max={TARGET_BOUNDS.maxRestSeconds}
                  precision={0}
                  density="coach"
                  accessibilityLabel="rest in seconds"
                  testID="target-rest-custom"
                />
              </View>
            ) : null}
          </View>

          <Divider />

          <View style={styles.section}>
            <Text size="eyebrow" tone="warm-muted">
              Notes
            </Text>
            <Input
              value={draft.coachNotes}
              onChangeText={(coachNotes) => {
                setDraft((current) => ({ ...current, coachNotes }));
              }}
              placeholder="Top set first, then two back-offs"
              accessibilityLabel="Notes on this exercise"
              accessibilityHint="Your client sees this with the exercise"
              density="coach"
              multiline
              testID="target-notes"
            />
          </View>

          {alternatives === undefined ? null : (
            <>
              <Divider />
              <ApprovedSwapsRow
                approved={alternatives.approved}
                onOpen={() => {
                  setSwapsOpen(true);
                }}
              />
            </>
          )}

          {onRemove === undefined ? null : (
            <Button
              variant="ghost"
              size="md"
              fullWidth
              onPress={onRemove}
              accessibilityLabel="Remove this exercise from the day"
              testID="target-remove"
            >
              Remove from this day
            </Button>
          )}

          {/* A refusal the server made anyway, in the sheet the coach is
            standing in — same treatment `ProgramDetailsSheet` gives
            `PROGRAM_DURATION_TOO_SHORT` (`program-builder/01`). */}
          {saveError === undefined ? null : (
            <Text size="body-sm" tone="urgent" accessibilityRole="alert" testID="target-save-error">
              {saveError}
            </Text>
          )}
        </ScrollView>
        <SheetFooter
          actionLabel={actionLabel}
          onAction={() => {
            const targets = targetDraftToInput(draft);
            if (targets === null) return;
            onSubmit(targets);
          }}
          isActionDisabled={issues.blockingActionLabel !== null || isSaving}
          isActionLoading={isSaving}
          density="coach"
        />
      </Sheet>

      {/* A SIBLING of the target sheet, never a child: `@gorhom/bottom-sheet`
        positions its content absolutely, so a second sheet nested inside
        the first would be clipped by it. Rendered after it, so it stands on
        top — and Android's hardware back closes the topmost surface first
        (`packages/ui`' `Sheet`). */}
      {alternatives === undefined || !isSwapsOpen ? null : (
        <ApprovedSwapsSheet
          isOpen
          originExerciseId={alternatives.originExerciseId}
          originExerciseName={exerciseName}
          originMovementPattern={alternatives.originMovementPattern}
          approved={alternatives.approved}
          isSaving={alternatives.isSaving ?? false}
          saveError={alternatives.saveError}
          onSave={(alternativeExerciseIds) => {
            alternatives.onSave(alternativeExerciseIds);
          }}
          onDismiss={() => {
            setSwapsOpen(false);
          }}
        />
      )}
    </>
  );
}

interface ApprovedSwapsRowProps {
  approved: readonly ApprovedAlternative[];
  onOpen: () => void;
}

/**
 * The entry point, and the current answer beside it — the coach reads what
 * is approved without opening anything, and opens the sheet only to change
 * it (`program-builder/05`, frame 1f).
 *
 * The whole row is one accessible button carrying the count, the names and
 * the action, rather than a label a screen reader reads and then a separate
 * control it has to associate with it (`accessibility` §2's grouping rule).
 */
function ApprovedSwapsRow({ approved, onOpen }: ApprovedSwapsRowProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const summary = approvedSummary(approved);

  return (
    <View style={styles.section}>
      <Text size="eyebrow" tone="warm-muted">
        Approved swaps
      </Text>
      <Text size="caption" tone="subtle">
        What your client may switch this for mid-session, if the equipment is taken.
      </Text>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Approved swaps. ${approvedAccessibilityLabel(approved)}`}
        accessibilityHint="Opens the exercise picker to change them"
        style={[styles.swapsRow, themed.swapsRow]}
        testID="target-alternatives"
      >
        <Repeat2 size={16} color={theme.colors.brand.DEFAULT} />
        <Text size="body-sm" tone={summary === null ? 'warm' : 'default'} style={styles.grow}>
          {summary ?? 'Add approved swaps'}
        </Text>
      </Pressable>
    </View>
  );
}

function restPresetLabel(seconds: number): string {
  return seconds < 120 ? `${seconds}s` : `${seconds / 60}m`;
}

interface NumberFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  isInvalid: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
  maxLength?: number;
  testID: string;
}

/**
 * The design's `.numfld` — a centred numeral well, wider than the 44px tap
 * floor in both dimensions. Not `Input`: this is a single centred figure in
 * a 52px square, and `Input`'s left-aligned 44px row is a different shape
 * for a different job.
 */
function NumberField({
  value,
  onChangeText,
  isInvalid,
  accessibilityLabel,
  accessibilityHint,
  maxLength,
  testID,
}: NumberFieldProps) {
  const themed = useThemedStyles();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      autoCapitalize="characters"
      autoCorrect={false}
      selectTextOnFocus
      {...(maxLength === undefined ? {} : { maxLength })}
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      style={[
        styles.numberField,
        themed.numberField,
        // `Input`'s own error treatment, restated for this shape: the
        // border steps up to `border.strong` and the field NEVER becomes a
        // red fill. The urgent ramp belongs to the message `FormField`
        // renders, not to the control (`FormField`'s own docblock).
        isInvalid ? themed.numberFieldInvalid : null,
      ]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(14), paddingTop: spacing(12), gap: spacing(14) },
  section: { gap: spacing(8) },
  grow: { flex: 1 },
  labelStack: { gap: spacing(3) },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(12),
    flexWrap: 'wrap',
  },
  repRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(12) },
  tempoRow: { flexDirection: 'row', gap: spacing(8) },
  tempoCaption: { flex: 1, textAlign: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(8) },
  swapsRow: {
    // Min-height, never height — the summary wraps to two lines at 200%
    // text and a fixed 48 would cut it (`accessibility` §3).
    minHeight: 48,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(9),
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
  },
  numberField: {
    flex: 1,
    minHeight: NUMFIELD_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 20,
    paddingHorizontal: spacing(8),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  numberField: {
    backgroundColor: t.colors.bg.inset,
    borderColor: t.colors.border.DEFAULT,
    color: t.colors.fg.DEFAULT,
  },
  numberFieldInvalid: { borderColor: t.colors.border.strong, borderWidth: 2 },
  // The same dashed ghost affordance the day screen's "Add exercise" and
  // "Group as superset" rows carry — this is the third of the same thing,
  // not a new one.
  swapsRow: { borderColor: t.colors.border.strong },
}));
