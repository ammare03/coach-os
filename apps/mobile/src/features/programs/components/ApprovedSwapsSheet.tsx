import type { exercises as exercisesSchemas } from '@coachos/schemas';
import { Chip, createThemedStyles, radius, spacing, Text, useTheme } from '@coachos/ui';
import { Info } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ExercisePickerSheet,
  type PickerExercise,
} from '../../workouts/components/library/ExercisePickerSheet.tsx';
import {
  ALTERNATIVES_LIMIT_HINT,
  ALTERNATIVE_BOUNDS,
  approveActionLabel,
  hasPendingChange,
  toggleAlternative,
  type ApprovedAlternative,
} from '../alternatives.ts';

// Frame 1f (`program-builder/05`) — the swap list a client may reach
// mid-session, and nothing outside it
// (`phase-09-workout-logger/session-modifications/02`).
//
// Four decisions from the approved design, each load-bearing:
//
// 1. **This is `exercise-library/05`'s picker in multi-select, not a second
//    search.** The design's own note says so in as many words: same rows,
//    same badges, same three-tier ranking, same filters. This component
//    supplies the header, the counting label and the pending selection; it
//    owns no search of its own and never will.
// 2. **The current answer stays on screen while the coach edits it.** The
//    approved swaps sit above the picker as chips a tap removes, so
//    "what is approved" and "what am I approving" are visible together
//    rather than one replacing the other.
// 3. **The pattern filter opens on the block's own movement pattern**, with
//    `All` beside it. A squat's substitutes are almost always squats, and
//    the one tap out of that assumption is right there — pre-filtering is
//    a default, never a fence.
// 4. **The commit counts** — "Approve 3 swaps" (`DESIGN.md` §10.8), and it
//    is inert with nothing to save rather than offering a write that
//    changes nothing.
//
// The origin exercise itself appears in the list, dimmed and badged "This
// one", and is not selectable — the server refuses it too
// (`PROGRAM_ALTERNATIVE_IS_ORIGIN`), but a coach should never be able to
// tap their way to that refusal.
//
// **`onCreate` is deliberately not passed.** The picker's own contract says
// a consumer that would dead-end should not offer the create row, and this
// one would: authoring an exercise leaves this sheet, and the pending
// selection the coach has built goes with it. Choosing between "lose your
// selection" and "no create row" is not a close call.

type MovementPattern = exercisesSchemas.MovementPatternValue;

export interface ApprovedSwapsSheetProps {
  isOpen: boolean;
  /** The block's own exercise — named in the copy, and inert in the list. */
  originExerciseId: string;
  originExerciseName: string;
  /** What the pattern filter opens on. */
  originMovementPattern: MovementPattern;
  /** What is saved today, in the coach's own order. */
  approved: readonly ApprovedAlternative[];
  isSaving?: boolean;
  /** A refusal the server made anyway — rendered above the picker, never swallowed. */
  saveError?: string | undefined;
  onSave: (alternativeExerciseIds: string[]) => void;
  onDismiss: () => void;
}

export function ApprovedSwapsSheet({
  isOpen,
  originExerciseId,
  originExerciseName,
  originMovementPattern,
  approved,
  isSaving = false,
  saveError,
  onSave,
  onDismiss,
}: ApprovedSwapsSheetProps) {
  // Seeded from what is saved, so the sheet opens on the current answer and
  // a coach who changes nothing has nothing to save.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    approved.map((exercise) => exercise.id),
  );
  // Names for ids the coach has added in this sitting — the saved list only
  // knows the ones the server has already resolved, and a chip without a
  // name is a chip that says nothing.
  const [addedNames, setAddedNames] = useState<ReadonlyMap<string, string>>(() => new Map());

  // A fresh sheet every time it opens, adjusted during render against the
  // previous `isOpen` rather than in an effect — React's own documented
  // pattern for "reset state when a prop changes", and the one the
  // `react-hooks` rules here require. Without it a selection abandoned on
  // one block would arrive pre-filled on the next.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSelectedIds(approved.map((exercise) => exercise.id));
      setAddedNames(new Map());
    }
  }

  const savedNames = new Map(approved.map((exercise) => [exercise.id, exercise.name]));
  const nameOf = (exerciseId: string): string =>
    addedNames.get(exerciseId) ?? savedNames.get(exerciseId) ?? 'This exercise';

  // Stable identity, so the picker's results do not re-render on every
  // keystroke in the search field above them.
  const originIds = useMemo(() => [originExerciseId], [originExerciseId]);
  const isAtLimit = selectedIds.length >= ALTERNATIVE_BOUNDS.maxApproved;
  const isDirty = hasPendingChange(approved, selectedIds);

  function toggle(exercise: PickerExercise) {
    setAddedNames((current) => {
      if (current.has(exercise.id)) return current;
      return new Map(current).set(exercise.id, exercise.name);
    });
    setSelectedIds((current) => toggleAlternative(current, exercise.id));
  }

  function remove(exerciseId: string) {
    setSelectedIds((current) => current.filter((id) => id !== exerciseId));
  }

  return (
    <ExercisePickerSheet
      isOpen={isOpen}
      title="Approved swaps"
      subtitle={`What your client may switch ${originExerciseName} for`}
      initialMovementPattern={originMovementPattern}
      // The block's own exercise: present, dimmed, badged, not selectable.
      alreadyAdded={originIds}
      alreadyAddedLabel="This one"
      header={
        <SwapsHeader
          selectedIds={selectedIds}
          nameOf={nameOf}
          isAtLimit={isAtLimit}
          saveError={saveError}
          onRemove={remove}
        />
      }
      selection={{
        selectedIds,
        onToggle: toggle,
        actionLabel: approveActionLabel(selectedIds.length),
        onCommit: () => {
          onSave([...selectedIds]);
        },
        isCommitDisabled: !isDirty || isSaving,
        isCommitting: isSaving,
      }}
      onDismiss={onDismiss}
    />
  );
}

interface SwapsHeaderProps {
  selectedIds: readonly string[];
  nameOf: (exerciseId: string) => string;
  isAtLimit: boolean;
  saveError: string | undefined;
  onRemove: (exerciseId: string) => void;
}

/**
 * The note, the chips and the ceiling — everything frame 1f stands between
 * the sheet header and the search field.
 *
 * The copy states what the feature does and attributes the choice to the
 * coach; it never tells them what to approve (`COPY.md` §CO1 — the product
 * reports facts and relays the coach's judgement, it has none of its own).
 */
function SwapsHeader({ selectedIds, nameOf, isAtLimit, saveError, onRemove }: SwapsHeaderProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={styles.header}>
      <View style={[styles.note, themed.note]}>
        <Info size={15} color={theme.colors.fg.muted} style={styles.noteIcon} />
        <Text size="caption" tone="muted" style={styles.noteText}>
          If the equipment is taken, your client can pick one of these mid-session. They cannot pick
          anything else.
        </Text>
      </View>

      {saveError === undefined ? null : (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert" testID="swaps-save-error">
          {saveError}
        </Text>
      )}

      {selectedIds.length === 0 ? (
        <Text size="caption" tone="subtle" testID="swaps-none">
          No approved swaps yet. Pick one below.
        </Text>
      ) : (
        <>
          <Text size="eyebrow" tone="warm-muted">
            {`Approved · ${selectedIds.length}`}
          </Text>
          <View
            style={styles.chips}
            accessibilityRole="list"
            accessibilityLabel="Approved swaps"
            testID="swaps-chips"
          >
            {selectedIds.map((exerciseId) => (
              // `onRemove` and no `onPress`: the chip is a read-only tag
              // naming an approved swap, and `Chip` renders the removal as
              // its OWN separate 44px target labelled "Remove {name}"
              // (`ui-primitives-core/05`). Hanging removal off the chip
              // body instead would make the whole label a destructive tap
              // with nothing announcing that it is one.
              <Chip
                key={exerciseId}
                label={nameOf(exerciseId)}
                selected
                onRemove={() => {
                  onRemove(exerciseId);
                }}
                testID={`swaps-chip-${exerciseId}`}
              />
            ))}
          </View>
        </>
      )}

      {/* Said once the ceiling is actually in reach, not permanently: a
          bound printed before it can bind is guidance, and a bound printed
          at all times is noise (`program-builder/01`'s sub-label rule). */}
      {isAtLimit ? (
        <Text size="caption" tone="subtle" testID="swaps-limit">
          {ALTERNATIVES_LIMIT_HINT}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(9) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(7) },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(9),
    paddingHorizontal: spacing(12),
    paddingVertical: spacing(10),
    borderRadius: radius.control,
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, minWidth: 0 },
});

const useThemedStyles = createThemedStyles((t) => ({
  note: { backgroundColor: t.control.surface },
}));
