import { exercises as exercisesSchemas } from '@coachos/schemas';
import {
  Button,
  Card,
  Chip,
  createThemedStyles,
  density,
  FormField,
  Input,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ChevronLeft, TriangleAlert } from 'lucide-react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDebounced } from '../../../../hooks/useDebounced.ts';
import { useExerciseNameCheck } from '../../api/exercises.ts';

import { CueListEditor } from './CueListEditor.tsx';

// The coach-facing create/edit form (`exercise-library/03`). One component
// for both modes: the fields are identical, and two components would drift.
//
// **The resolver is the tRPC procedure's own input schema.** `createExercise
// Input` is imported here and on the server; a name-length rule that exists
// in only one of the two is the bug CLAUDE.md §6.4 exists to prevent.
//
// **Three name collisions, three treatments** (Approach step 1). Only the
// first is a refusal; the other two are legal under DB§5.2's partial unique
// index and are surfaced because silently allowing either is how a library
// ends up with four spellings of one movement.

type FormValues = exercisesSchemas.CreateExerciseInput;

export interface ExerciseFormProps {
  mode: 'create' | 'edit';
  /** Prefilled from the picker's "create '<query>'" row, or from the row being edited. */
  initialValues?: Partial<FormValues> | undefined;
  /** Edit mode only — suppresses the collision check against the exercise's own name. */
  editingExerciseId?: string | undefined;
  isSubmitting?: boolean | undefined;
  /** Server-side `EXERCISE_NAME_TAKEN`, rendered on the name field rather than in a toast. */
  nameError?: string | undefined;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  /** Edit mode only. Archive, never delete — the word is load-bearing. */
  onArchive?: (() => void) | undefined;
  /** Offered when the typed name matches an exercise the coach already has. */
  onOpenExisting?: ((exerciseId: string) => void) | undefined;
  /** Offered when the typed name matches one the coach archived. */
  onUnarchiveExisting?: ((exerciseId: string) => void) | undefined;
}

const GUTTER = density.coach.gutter;

/** DB§5.2's own default. The chips are the four real barbell/machine steps a gym actually offers. */
const INCREMENT_CHIPS = [1.25, 2.5, 5, 10] as const;

const MOVEMENT_PATTERNS = exercisesSchemas.movementPatternValue.options;

const PATTERN_LABEL: Record<(typeof MOVEMENT_PATTERNS)[number], string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  push: 'Push',
  pull: 'Pull',
  carry: 'Carry',
  core: 'Core',
  isolation: 'Isolation',
  other: 'Other',
};

const EMPTY_VALUES: FormValues = {
  name: '',
  primaryMuscle: '',
  equipment: '',
  movementPattern: 'other',
  cues: [],
  defaultIncrementKg: 2.5,
  isUnilateral: false,
  isBodyweight: false,
};

/**
 * Long enough that the coach has stopped typing a word, short enough that
 * the warning lands before they reach for Create. The check is advisory —
 * being late is a worse failure than being chatty.
 */
const NAME_CHECK_DEBOUNCE_MS = 350;

export function ExerciseForm({
  mode,
  initialValues,
  editingExerciseId,
  isSubmitting = false,
  nameError,
  onSubmit,
  onCancel,
  onArchive,
  onOpenExisting,
  onUnarchiveExisting,
}: ExerciseFormProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();

  const form = useForm<FormValues>({
    resolver: zodResolver(exercisesSchemas.createExerciseInput),
    defaultValues: { ...EMPTY_VALUES, ...initialValues },
    mode: 'onBlur',
  });

  // `useWatch`, not `form.watch()`: the latter returns a function the React
  // Compiler cannot memoize safely, so it bails out of optimising this whole
  // component (the `react-hooks/incompatible-library` warning).
  const name = useWatch({ control: form.control, name: 'name' });
  const isBodyweight = useWatch({ control: form.control, name: 'isBodyweight' });
  const isUnilateral = useWatch({ control: form.control, name: 'isUnilateral' });
  const debouncedName = useDebounced(name.trim(), NAME_CHECK_DEBOUNCE_MS);

  // Never checked against the row being edited: a coach who opens their own
  // exercise and changes nothing but a cue must not be told their name is
  // taken by themselves.
  const nameCheck = useExerciseNameCheck(debouncedName, debouncedName.length > 0);
  const conflict =
    nameCheck.data &&
    'exerciseId' in nameCheck.data &&
    nameCheck.data.exerciseId === editingExerciseId
      ? { kind: 'none' as const }
      : nameCheck.data;

  const fieldError = form.formState.errors;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing(6) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backTarget}
            testID="exercise-form-back"
          >
            <ChevronLeft size={20} color={theme.colors.fg.muted} />
          </Pressable>
          <Text size="h2">{mode === 'create' ? 'New exercise' : 'Edit exercise'}</Text>
        </View>

        <Controller
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormField
              label="Name"
              error={nameError ?? fieldError.name?.message}
              isRequired
              density="coach"
            >
              <Input
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="Reverse Nordic"
                accessibilityLabel="Exercise name"
                autoCapitalize="words"
                autoCorrect={false}
                density="coach"
                testID="exercise-name"
              />
            </FormField>
          )}
        />

        {conflict?.kind === 'yours' && onOpenExisting ? (
          <Button
            variant="secondary"
            size="sm"
            density="coach"
            onPress={() => {
              onOpenExisting(conflict.exerciseId);
            }}
            testID="open-existing-exercise"
          >
            Open the one you have
          </Button>
        ) : null}

        {conflict?.kind === 'global' ? (
          <Card elevation="tinted" testID="global-name-notice">
            <View style={[styles.notice, styles.noticeRow]}>
              <TriangleAlert
                size={16}
                color={theme.colors.brand.DEFAULT}
                style={styles.noticeIcon}
              />
              <Text size="body-sm" tone="warm" style={styles.flex}>
                There is already a global exercise with this name. Using it keeps every
                client&apos;s history in one place.
              </Text>
            </View>
          </Card>
        ) : null}

        {conflict?.kind === 'archived' ? (
          <Card elevation="tinted" testID="archived-name-notice">
            <View style={[styles.notice, styles.noticeRow]}>
              <Archive size={16} color={theme.colors.brand.DEFAULT} style={styles.noticeIcon} />
              <View style={styles.flex}>
                <Text size="body-sm" tone="warm">
                  You archived an exercise with this name. Bringing it back keeps its history — a
                  new one starts from nothing.
                </Text>
                {onUnarchiveExisting ? (
                  <View style={styles.noticeAction}>
                    <Button
                      size="sm"
                      density="coach"
                      onPress={() => {
                        onUnarchiveExisting(conflict.exerciseId);
                      }}
                      testID="unarchive-existing-exercise"
                    >
                      Bring it back
                    </Button>
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        ) : null}

        <View style={styles.pair}>
          <View style={styles.flex}>
            <Controller
              control={form.control}
              name="primaryMuscle"
              render={({ field }) => (
                <FormField
                  label="Primary muscle"
                  error={fieldError.primaryMuscle?.message}
                  isRequired
                  density="coach"
                >
                  <Input
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Quadriceps"
                    accessibilityLabel="Primary muscle"
                    density="coach"
                    testID="exercise-primary-muscle"
                  />
                </FormField>
              )}
            />
          </View>
          <View style={styles.flex}>
            <Controller
              control={form.control}
              name="equipment"
              render={({ field }) => (
                <FormField
                  label="Equipment"
                  error={fieldError.equipment?.message}
                  isRequired
                  density="coach"
                >
                  <Input
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Bodyweight"
                    accessibilityLabel="Equipment"
                    density="coach"
                    testID="exercise-equipment"
                  />
                </FormField>
              )}
            />
          </View>
        </View>

        <Text size="label" tone="warm" style={styles.groupLabel}>
          Movement pattern
        </Text>
        <Controller
          control={form.control}
          name="movementPattern"
          render={({ field }) => (
            <View style={styles.chips}>
              {MOVEMENT_PATTERNS.map((pattern) => (
                <Chip
                  key={pattern}
                  label={PATTERN_LABEL[pattern]}
                  selected={field.value === pattern}
                  onPress={() => {
                    field.onChange(pattern);
                  }}
                  testID={`pattern-${pattern}`}
                />
              ))}
            </View>
          )}
        />

        <Text size="label" tone="warm" style={styles.groupLabel}>
          Cues
        </Text>
        <Text size="caption" tone="subtle" style={styles.groupHint}>
          What you would say standing next to them.
        </Text>
        <Controller
          control={form.control}
          name="cues"
          render={({ field }) => (
            <CueListEditor cues={field.value} onChange={field.onChange} testID="exercise-cues" />
          )}
        />

        <View style={styles.toggles}>
          <Card elevation="raised">
            <ToggleRow
              label="One side at a time"
              hint="Logged per side"
              value={isUnilateral}
              onChange={(next) => {
                form.setValue('isUnilateral', next, { shouldDirty: true });
              }}
              testID="toggle-unilateral"
            />
            <ToggleRow
              label="Bodyweight"
              hint="No weight jump needed"
              value={isBodyweight}
              onChange={(next) => {
                form.setValue('isBodyweight', next, { shouldDirty: true });
                // A bodyweight movement has no plate math, so it has no
                // smallest jump — zeroing it here is what stops the client's
                // stepper offering a load that does not exist (Approach
                // step 4).
                if (next) form.setValue('defaultIncrementKg', 0, { shouldDirty: true });
              }}
              testID="toggle-bodyweight"
            />
          </Card>
        </View>

        {isBodyweight ? null : (
          <>
            <Text size="label" tone="warm" style={styles.groupLabel}>
              Smallest weight jump
            </Text>
            <Controller
              control={form.control}
              name="defaultIncrementKg"
              render={({ field }) => (
                <View style={styles.chips}>
                  {INCREMENT_CHIPS.map((step) => (
                    <Chip
                      key={step}
                      label={`${String(step)} kg`}
                      selected={field.value === step}
                      onPress={() => {
                        field.onChange(step);
                      }}
                      testID={`increment-${String(step)}`}
                    />
                  ))}
                </View>
              )}
            />
            <Text size="caption" tone="subtle" style={styles.groupHint}>
              The smallest step this movement can actually take. Your client&apos;s weight stepper
              uses it.
            </Text>
          </>
        )}

        {mode === 'edit' && onArchive ? (
          <View style={styles.archive}>
            <Button
              variant="secondary"
              density="coach"
              onPress={onArchive}
              iconLeft={<Archive size={16} color={theme.colors.fg.glass} />}
              testID="archive-exercise"
            >
              Archive
            </Button>
            <Text size="caption" tone="subtle" style={styles.archiveHint}>
              It stays on every program and set log that already used it.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, themed.footer, { paddingBottom: insets.bottom + spacing(12) }]}>
        <Button variant="secondary" density="coach" onPress={onCancel} testID="cancel-exercise">
          Cancel
        </Button>
        <View style={styles.flex}>
          <Button
            density="coach"
            fullWidth
            loading={isSubmitting}
            onPress={() => {
              // Wrapped rather than passed straight through: `handleSubmit`
              // hands its callback a second argument (the originating
              // event), and `onSubmit`'s contract takes one.
              void form.handleSubmit((values) => {
                onSubmit(values);
              })();
            }}
            testID="submit-exercise"
          >
            {mode === 'create' ? 'Create exercise' : 'Save changes'}
          </Button>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testID: string;
}

function ToggleRow({ label, hint, value, onChange, testID }: ToggleRowProps) {
  const themed = useThemedStyles();
  return (
    <Pressable
      onPress={() => {
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={[styles.toggleRow, themed.divider]}
      testID={testID}
    >
      <View style={styles.flex}>
        <Text size="label">{label}</Text>
        <Text size="caption" tone="subtle">
          {hint}
        </Text>
      </View>
      <View style={[styles.track, value ? themed.trackOn : themed.trackOff]}>
        <View style={[styles.knob, value ? themed.knobOn : themed.knobOff]} />
      </View>
    </Pressable>
  );
}

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const KNOB = 22;
const BACK_TARGET = 44;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: GUTTER, paddingBottom: spacing(24), gap: spacing(12) },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(6) },
  backTarget: {
    width: BACK_TARGET,
    height: BACK_TARGET,
    marginLeft: -spacing(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pair: { flexDirection: 'row', gap: spacing(10) },
  groupLabel: { marginTop: spacing(4) },
  groupHint: { marginTop: -spacing(6) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(7) },
  notice: { padding: spacing(13) },
  noticeRow: { flexDirection: 'row', gap: spacing(11) },
  noticeIcon: { marginTop: spacing(3) },
  noticeAction: { marginTop: spacing(11), alignSelf: 'flex-start' },
  toggles: { marginTop: spacing(4) },
  toggleRow: {
    minHeight: 54,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: spacing(3),
    justifyContent: 'center',
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
  archive: { marginTop: spacing(12), gap: spacing(6), alignItems: 'flex-start' },
  archiveHint: { maxWidth: 280 },
  footer: {
    flexDirection: 'row',
    gap: spacing(10),
    paddingHorizontal: GUTTER,
    paddingTop: spacing(12),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  footer: { backgroundColor: t.colors.bg.DEFAULT, borderTopColor: t.colors.border.soft },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border.soft },
  trackOn: { backgroundColor: t.colors.primary.to, alignItems: 'flex-end' },
  trackOff: {
    backgroundColor: t.colors.bg.inset,
    borderWidth: 1,
    borderColor: t.colors.border.strong,
    alignItems: 'flex-start',
  },
  knobOn: { backgroundColor: t.colors.fg.onBrand },
  knobOff: { backgroundColor: t.colors.fg.faint },
}));
