import { Input, Pressable, Sheet, SheetFooter, SheetHeader, Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing, tapTarget, withAlpha } from '@coachos/ui/theme';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  SKIP_REASONS,
  SKIP_REASON_LABEL,
  type SkipReason,
} from '../store/skipped-exercises-store.ts';

// `session-modifications/03` — the reason capture, and the only thing between
// the tap and the next exercise. Design: `skip-exercise.html` in the P09
// design project, frames A and B.
//
// Five decisions, in the order they matter:
//
// (a) **This sheet IS the confirmation.** Task 03's criterion is explicit
//     that a skip gets no confirmation dialog beyond the reason capture
//     itself, which rules out the native `Alert` (`ui-conventions` §5) and
//     also rules out a second "are you sure?" inside the sheet. What makes
//     that safe is the undo on the skipped page: a mis-tap costs two taps to
//     reverse, where a confirm would cost every honest skip an extra one.
//
// (b) **Four full-width rows, not a chip wrap.** `Chip`'s own contract calls
//     it "zero-or-more from an open set"; this is exactly one from a fixed
//     set of four, which is `SegmentedControl`'s shape — and a segmented
//     control cannot hold "Equipment unavailable" on a phone, let alone at
//     200% text. A 52pt full-width row is the mid-set tap floor (§13), reads
//     top-to-bottom at arm's length, and grows rather than reflowing into an
//     unpredictable grid.
//
// (c) **`radio` roles, not buttons.** The rows are one choice from a group
//     and announce as such, so a screen-reader client hears the position and
//     the selection rather than four unrelated buttons (`accessibility` §2).
//
// (d) **The reason is required; the note is not.** A skip without a reason
//     is the thing this task exists to prevent — the coach reading the
//     session needs to know the machine was occupied rather than that the
//     knee hurt. It is one tap, and `SheetFooter` defaults its action to
//     disabled, so the footer fails safe.
//
// (e) **Nothing here judges, and nothing is counted against the client.**
//     "Pain or discomfort" is the client's own report of their own body
//     (`COPY.md` §CO2); none of the four reasons is worded as a failure, and
//     the helper line states where the words go rather than what the client
//     should have done (§CO3).

/**
 * Every word this sheet says, and the only place it says them — the same
 * shape `SET_FLAG_COPY` uses, so the sheet and anything that reads a skip
 * back can never word one reason two ways.
 */
export const SKIP_SHEET_COPY = {
  title: 'Skip this exercise',
  /** Sentence case on a control (`product-copy` §6). */
  action: 'Skip exercise',
  notePlaceholder: 'Add a note (optional)',
  /** The spoken name of a field whose visible label is its placeholder. */
  noteLabel: 'Note about this skip, optional',
  /** Where the words end up. A fact, not an instruction — decision (e). */
  helper: 'Your coach sees this with your session notes.',
  reasonGroupLabel: 'Reason for skipping',
} as const;

/** Free text is a sentence in a coach's notes, not an essay. */
const NOTE_MAX_LENGTH = 120;

const RADIO_SIZE = 20;
const RADIO_DOT = 10;

export interface SkipExerciseSheetProps {
  isOpen: boolean;
  /** The name the page is showing, so the sheet names what is being skipped. */
  exerciseName: string;
  /** Leaves the exercise exactly as it was. Nothing has been written yet. */
  onDismiss: () => void;
  onConfirm: (reason: SkipReason, note: string) => void;
}

export function SkipExerciseSheet({
  isOpen,
  exerciseName,
  onDismiss,
  onConfirm,
}: SkipExerciseSheetProps) {
  const themed = useThemedStyles();
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState('');

  // A sheet opened for a second exercise must not arrive carrying the first
  // one's answer. Cleared on the way OUT rather than in an effect on the way
  // in: the sheet stays mounted between openings, and both exits — the
  // footer and every dismissal the `Sheet` itself offers — come through
  // here, so there is no path that leaves an answer behind.
  const clear = useCallback(() => {
    setReason(null);
    setNote('');
  }, []);

  const handleDismiss = useCallback(() => {
    clear();
    onDismiss();
  }, [clear, onDismiss]);

  const handleConfirm = useCallback(() => {
    if (reason === null) return;
    onConfirm(reason, note);
    clear();
  }, [clear, note, onConfirm, reason]);

  return (
    <Sheet isOpen={isOpen} onDismiss={handleDismiss} snap="auto" testID="skip-exercise-sheet">
      <SheetHeader title={SKIP_SHEET_COPY.title} subtitle={exerciseName} onClose={handleDismiss} />

      <View style={styles.body}>
        <View
          style={styles.reasons}
          accessibilityRole="radiogroup"
          accessibilityLabel={SKIP_SHEET_COPY.reasonGroupLabel}
        >
          {SKIP_REASONS.map((candidate) => {
            const isSelected = candidate === reason;
            return (
              <Pressable
                key={candidate}
                onPress={() => {
                  setReason(candidate);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={SKIP_REASON_LABEL[candidate]}
                style={[styles.reason, themed.reason, isSelected && themed.reasonSelected]}
                testID={`skip-reason-${candidate}`}
              >
                {/* Decorative: the row's own label already names it, and the
                    `checked` state is what carries the selection to a screen
                    reader. Drawn because §8 forbids meaning in hue alone —
                    the disc is the shape channel. */}
                <View
                  style={[styles.radio, themed.radio, isSelected && themed.radioSelected]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {isSelected ? <View style={[styles.radioDot, themed.radioDot]} /> : null}
                </View>
                {/* The client-app body floor, and no `numberOfLines`: at 200%
                    text the label wraps and the row deepens (`accessibility` §3). */}
                <Text size="body-lg" tone={isSelected ? 'default' : 'muted'} style={styles.label}>
                  {SKIP_REASON_LABEL[candidate]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Input
          value={note}
          onChangeText={setNote}
          placeholder={SKIP_SHEET_COPY.notePlaceholder}
          density="client"
          maxLength={NOTE_MAX_LENGTH}
          accessibilityLabel={SKIP_SHEET_COPY.noteLabel}
          returnKeyType="done"
          testID="skip-note-input"
        />

        <Text size="body-sm" tone="subtle">
          {SKIP_SHEET_COPY.helper}
        </Text>
      </View>

      <SheetFooter
        actionLabel={SKIP_SHEET_COPY.action}
        onAction={handleConfirm}
        // Decision (d).
        isActionDisabled={reason === null}
        density="client"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing(20),
    paddingTop: spacing(4),
    paddingBottom: spacing(16),
    gap: spacing(10),
  },
  reasons: {
    gap: spacing(8),
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    // `minHeight`, never `height`: §13's mid-set floor is the floor, and at
    // 200% text the row grows past it rather than clipping its label.
    minHeight: tapTarget.MID_SET,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(12),
    borderRadius: radius.control,
    borderWidth: 1,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  radio: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: RADIO_DOT,
    height: RADIO_DOT,
    borderRadius: radius.full,
  },
});

const useThemedStyles = createThemedStyles(({ colors, control }) => ({
  reason: {
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
  reasonSelected: {
    // The maroon tint under a dimmed brand edge — the same pairing the rail's
    // superset bracket and the pager's badge use, deliberately NOT the solid
    // `deep`-under-`brand.DEFAULT` treatment §8 reserves for a record.
    backgroundColor: withAlpha(colors.deep, '0.3'),
    borderColor: colors.brand.shade,
  },
  radio: {
    borderColor: colors.fg.faint,
  },
  radioSelected: {
    borderColor: colors.brand.DEFAULT,
  },
  radioDot: {
    backgroundColor: colors.brand.DEFAULT,
  },
}));
