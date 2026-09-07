import {
  Badge,
  createThemedStyles,
  density,
  EmptyState,
  ForbiddenState,
  IconButton,
  LoadingState,
  NotFoundState,
  Pressable,
  radius,
  spacing,
  Text,
  useTheme,
  useUndoToast,
} from '@coachos/ui';
import { ChevronLeft, Dumbbell, Plus, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getErrorCode, getErrorDetails } from '../../../lib/error-code.ts';
import {
  ExercisePickerSheet,
  type PickerExercise,
} from '../../workouts/components/library/ExercisePickerSheet.tsx';
import type { ProgramDayExercise } from '../api/programs.ts';
import { DraggableExerciseList } from '../components/DraggableExerciseList.tsx';
import { ExerciseTargetForm } from '../components/ExerciseTargetForm.tsx';
import { ReorderHintBar } from '../components/ReorderHintBar.tsx';
import { newTargetDraft, TARGET_BOUNDS, targetDraftFrom } from '../exercise-targets.ts';
import { useProgramDayBuilder } from '../hooks/useProgramDayBuilder.ts';
import { dayFullLabel, dayPillLabel } from '../program-days.ts';

// `(coach)/program/[id]/day/[dayId]` — frame 1b (`program-builder/02`).
//
// **The picker-then-target flow has no intermediate screen**: "Add
// exercise" opens `exercise-library/05`'s picker, the tap on a row IS the
// selection, and the target sheet takes its place with that exercise
// already named in its header. Two sheets, one gesture each, no page in
// between.
//
// One query, no waterfall (`UI-UX.md` §UX3): `programs.days.get` returns the
// day, its week, its sibling slots and every block in one round trip.
//
// `program-builder/03` replaces the list below with a draggable one. It is
// rendered from an `order_index`-sorted array of self-contained rows for
// exactly that reason — the container changes, the row does not.

const GUTTER = density.coach.gutter;

export interface ProgramDayScreenProps {
  programDayId: string;
  onBack: () => void;
  /** Opening a sibling slot — the day strip across the top of frame 1b. */
  onOpenDay: (programDayId: string) => void;
}

type Editing =
  { kind: 'create'; exercise: PickerExercise } | { kind: 'edit'; block: ProgramDayExercise };

export function ProgramDayScreen({ programDayId, onBack, onOpenDay }: ProgramDayScreenProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const insets = useSafeAreaInsets();
  const showUndoToast = useUndoToast();

  const { day, addExercise, updateExercise, removeExercise, reorderExercises } =
    useProgramDayBuilder(programDayId);

  const [isPickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  // A drag takes over the screen: the scroll view stops (the gesture and a
  // scroll cannot both own the finger) and the action bar becomes the
  // instruction line (`program-builder/03`, frame 1d).
  const [isReordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | undefined>(undefined);
  // Blocks the coach has removed but whose delete has not been sent yet —
  // the undo window is local, so the row leaves the list immediately and
  // comes back if they take it back (`useUndoToast`'s deferred commit).
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(new Set());

  const screenPadding = { paddingTop: insets.top + spacing(6) };

  if (day.isPending) {
    return (
      <View style={[styles.flex, themed.screen, screenPadding]}>
        <View style={styles.gutter}>
          <LoadingState shape="list" rows={4} accessibilityLabel="Loading this day" />
        </View>
      </View>
    );
  }

  if (day.isError) {
    const code = getErrorCode(day.error);
    // Another coach's day answers NOT_FOUND on purpose — a distinct 403
    // would confirm the row exists (`ERRORS.md` ER§2.1).
    if (code === 'NOT_YOUR_CLIENT') {
      return (
        <View style={[styles.flex, themed.screen, screenPadding]}>
          <NotFoundState onRecover={onBack} density="coach" testID="day-not-found" />
        </View>
      );
    }
    if (code === 'ROLE_REQUIRED' || code === 'FEATURE_NOT_IN_TIER') {
      return (
        <View style={[styles.flex, themed.screen, screenPadding]}>
          <ForbiddenState onRecover={onBack} density="coach" testID="day-forbidden" />
        </View>
      );
    }
    return (
      <View style={[styles.flex, themed.screen, screenPadding]}>
        <View style={styles.gutter}>
          <EmptyState
            icon={<TriangleAlert size={22} color={theme.colors.brand.mid} />}
            title="We couldn't load this day"
            body="Check your connection and try again. Nothing you have built is affected."
            primaryAction={{
              label: 'Try again',
              onPress: () => {
                void day.refetch();
              },
            }}
            density="coach"
            testID="day-error"
          />
        </View>
      </View>
    );
  }

  const data = day.data;
  if (!data) return null;

  const blocks = data.exercises.filter((block) => !pendingRemovalIds.has(block.id));
  const isFull = blocks.length >= TARGET_BOUNDS.maxExercisesPerDay;

  function handleRemove(block: ProgramDayExercise) {
    setEditing(null);
    setPendingRemovalIds((current) => new Set(current).add(block.id));
    showUndoToast({
      message: `${block.exerciseName} removed`,
      onUndo: () => {
        setPendingRemovalIds((current) => {
          const next = new Set(current);
          next.delete(block.id);
          return next;
        });
      },
      onCommit: () => {
        removeExercise.mutate({ programExerciseId: block.id });
      },
    });
  }

  return (
    <View style={[styles.flex, themed.screen]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing(6), paddingBottom: insets.bottom + spacing(40) },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isReordering}
      >
        <View style={styles.topbar}>
          <IconButton
            icon={<ChevronLeft size={17} color={theme.colors.fg.DEFAULT} />}
            variant="secondary"
            size="sm"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="day-back"
          />
          <View style={styles.grow}>
            <Text size="eyebrow" tone="muted" numberOfLines={1}>
              {`Week ${data.weekNumber} · ${dayFullLabel(data.dayNumber)}`}
            </Text>
            <Text size="h2" numberOfLines={2}>
              {data.name}
            </Text>
          </View>
          <Badge
            tone="neutral"
            size="sm"
            label={`${blocks.length} ${blocks.length === 1 ? 'item' : 'items'}`}
          />
        </View>

        <View style={styles.slots}>
          {data.siblingDays.map((slot) => {
            const isCurrent = slot.id === data.id;
            return (
              <Pressable
                key={slot.id}
                disabled={isCurrent}
                onPress={() => {
                  onOpenDay(slot.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${dayFullLabel(slot.dayNumber)}, ${slot.name}`}
                accessibilityState={{ selected: isCurrent, disabled: isCurrent }}
                style={[
                  styles.slot,
                  // A rest day is neutral and dashed, never red — the
                  // absence of training is not a failure (`DESIGN.md` §10.5).
                  slot.isRestDay ? themed.slotRest : themed.slotTraining,
                  isCurrent ? themed.slotCurrent : null,
                ]}
                testID={`day-slot-${slot.dayNumber}`}
              >
                <Text
                  size="micro"
                  tone={slot.isRestDay ? 'faint' : 'muted'}
                  maxFontSizeMultiplier={1.3}
                >
                  {dayPillLabel(slot.dayNumber)}
                </Text>
                <Text
                  size="micro"
                  tone={slot.isRestDay ? 'faint' : 'warm'}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {slot.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {blocks.length === 0 ? (
          <EmptyState
            icon={<Dumbbell size={22} color={theme.colors.brand.DEFAULT} />}
            title={data.isRestDay ? 'This is a rest day' : 'Nothing on this day yet'}
            body={
              data.isRestDay
                ? 'Adding an exercise here still leaves the day marked as rest — change that from the week if you meant to train.'
                : 'Pick a movement, set its targets, and it lands here in the order you add it.'
            }
            primaryAction={{
              label: 'Add exercise',
              onPress: () => {
                setPickerOpen(true);
              },
            }}
            density="coach"
            testID="day-empty"
          />
        ) : (
          <>
            <DraggableExerciseList
              blocks={blocks}
              onOpenBlock={(block) => {
                setSaveError(undefined);
                setEditing({ kind: 'edit', block });
              }}
              onReorder={(orderedExerciseIds) => {
                setReorderError(undefined);
                reorderExercises.mutate(
                  { programDayId, orderedExerciseIds },
                  {
                    onError: (error) => {
                      setReorderError(reorderErrorMessage(error));
                    },
                  },
                );
              }}
              onDragActiveChange={setReordering}
              testID="exercise-list"
            />

            {reorderError === undefined ? null : (
              <Text size="caption" tone="warm" testID="reorder-error">
                {reorderError}
              </Text>
            )}

            {isFull ? (
              // The affordance is replaced by the reason it is gone, rather
              // than left inert — `PROGRAM_EXERCISE_LIMIT_REACHED` is then
              // only ever the server's floor under a stale client.
              <Text size="caption" tone="subtle" testID="day-full">
                {`A day holds up to ${TARGET_BOUNDS.maxExercisesPerDay} exercises.`}
              </Text>
            ) : (
              <Pressable
                onPress={() => {
                  setPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Add exercise"
                style={[styles.addExercise, themed.ghostBorder]}
                testID="add-exercise"
              >
                <Plus size={16} color={theme.colors.brand.DEFAULT} />
                <Text size="body-sm" tone="warm">
                  Add exercise
                </Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {isReordering ? <ReorderHintBar testID="reorder-hint" /> : null}

      {isPickerOpen ? (
        <ExercisePickerSheet
          isOpen
          title={`Add to ${data.name}`}
          alreadyAdded={blocks.map((block) => block.exerciseId)}
          onSelect={(exercise) => {
            // The tap on a picker row IS the commit — the picker closes and
            // the target sheet opens in its place, with no screen between.
            setPickerOpen(false);
            setSaveError(undefined);
            setEditing({ kind: 'create', exercise });
          }}
          onDismiss={() => {
            setPickerOpen(false);
          }}
        />
      ) : null}

      {editing === null ? null : editing.kind === 'create' ? (
        <ExerciseTargetForm
          isOpen
          mode="create"
          exerciseName={editing.exercise.name}
          exerciseMeta={`${editing.exercise.primaryMuscle} · ${editing.exercise.equipment}`}
          initialDraft={newTargetDraft()}
          isSaving={addExercise.isPending}
          saveError={saveError}
          onDismiss={() => {
            setEditing(null);
          }}
          onSubmit={(targets) => {
            const exerciseId = editing.exercise.id;
            setSaveError(undefined);
            addExercise.mutate(
              { programDayId, exerciseId, ...targets },
              {
                onSuccess: () => {
                  setEditing(null);
                },
                onError: (error) => {
                  setSaveError(addExerciseErrorMessage(error));
                },
              },
            );
          }}
        />
      ) : (
        <ExerciseTargetForm
          isOpen
          mode="edit"
          exerciseName={editing.block.exerciseName}
          exerciseMeta={`${editing.block.exercisePrimaryMuscle} · ${editing.block.exerciseEquipment}`}
          initialDraft={targetDraftFrom(editing.block)}
          isSaving={updateExercise.isPending}
          saveError={saveError}
          onRemove={() => {
            handleRemove(editing.block);
          }}
          onDismiss={() => {
            setEditing(null);
          }}
          onSubmit={(targets) => {
            const programExerciseId = editing.block.id;
            setSaveError(undefined);
            updateExercise.mutate(
              { programExerciseId, ...targets },
              {
                onSuccess: () => {
                  setEditing(null);
                },
                onError: (error) => {
                  setSaveError(addExerciseErrorMessage(error));
                },
              },
            );
          }}
        />
      )}
    </View>
  );
}

/**
 * The server's refusals, in the sheet the coach is standing in rather than
 * in a toast they then have to trace back to a field (`ERRORS.md` ER§0.2).
 * Every branch is a state the UI already prevents — this is what is said
 * when a stale client reaches one anyway.
 */
function addExerciseErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code === 'PROGRAM_EXERCISE_LIMIT_REACHED') {
    const details = getErrorDetails(error, code);
    return `A day holds up to ${details?.maxExercises ?? TARGET_BOUNDS.maxExercisesPerDay} exercises.`;
  }
  if (code === 'EXERCISE_NOT_FOUND') {
    return 'That exercise is no longer in your library. Pick another one.';
  }
  if (code === 'VALIDATION_FAILED') {
    return 'Some of these targets are outside what a program can hold. Check the numbers above.';
  }
  return "We couldn't save this. Check your connection and try again.";
}

/**
 * The drop's own refusals, said next to the list rather than in a toast the
 * coach then has to connect back to a card that has already moved back
 * (`ERRORS.md` ER§0.2). The optimistic order is rolled back by the hook, so
 * what this text explains is why the list is where it was.
 */
function reorderErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code === 'PROGRAM_DAY_ORDER_STALE') {
    return 'This day changed on another device, so the move was not saved. We have refreshed it — try again.';
  }
  if (code === 'VALIDATION_FAILED') {
    return "We couldn't read that order. Pull to refresh and try the move again.";
  }
  return "We couldn't save the new order. Check your connection and try again.";
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  gutter: { paddingHorizontal: GUTTER },
  scroll: { paddingHorizontal: GUTTER, gap: spacing(8) },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingBottom: spacing(12),
  },
  slots: { flexDirection: 'row', gap: spacing(5), marginBottom: spacing(6) },
  slot: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(3),
  },
  addExercise: {
    minHeight: 48,
    marginTop: spacing(4),
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
  },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  ghostBorder: { borderColor: t.colors.border.strong },
  slotTraining: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  slotRest: {
    backgroundColor: 'transparent',
    borderColor: t.colors.border.soft,
    borderStyle: 'dashed',
  },
  slotCurrent: { borderColor: t.colors.brand.DEFAULT, backgroundColor: t.colors.bg.raised },
}));
