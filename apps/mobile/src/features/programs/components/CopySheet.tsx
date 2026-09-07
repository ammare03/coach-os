import type { AppErrorCode } from '@coachos/schemas';
import {
  createThemedStyles,
  Metric,
  Pressable,
  radius,
  Sheet,
  SheetFooter,
  SheetHeader,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { ProgramDay, ProgramWeek } from '../api/programs.ts';
import {
  COPY_FOOTNOTE,
  copyErrorMessage,
  dayCopyActionLabel,
  dayCopySummary,
  DAY_COPY_INERT_LABEL,
  takenDayOccupants,
  weekCopyActionLabel,
  weekCopySummary,
  WEEK_COPY_CEILING_NOTE,
  WEEK_COPY_INERT_LABEL,
} from '../duplication.ts';
import { DAY_SLOTS, dayFullLabel, dayPillLabel } from '../program-days.ts';

import { useDestructiveInk } from './BuilderActionsMenu.tsx';

// The copy-to sheet (`program-builder/06`, frame 1g), for a day and for a
// whole week.
//
// Two rules it exists to hold:
//
// **Collision is prevented, not reported.** A taken day slot is dashed,
// inert, and names its occupant, so the coach cannot select the failure —
// `PROGRAM_DAY_TAKEN` is then only reachable by a stale client or a second
// device, which is where a server-side refusal belongs. The same rule sends
// the week copy to the next free week rather than asking the coach to pick
// a number that might already be taken.
//
// **The sheet promises exactly what the transaction copies.** The summary
// line at the top and the footnote at the bottom both name targets,
// supersets and approved swaps, because the failure this whole task exists
// to prevent is a partial copy that looks complete.

export type CopySubject =
  { kind: 'day'; day: ProgramDay; sourceWeekNumber: number } | { kind: 'week'; week: ProgramWeek };

export type CopyCommit =
  { kind: 'day'; targetWeekId: string; targetDayNumber: number } | { kind: 'week' };

export interface CopySheetProps {
  isOpen: boolean;
  subject: CopySubject;
  /** Every week of this program — the "Into week" choices for a day copy. */
  weeks: readonly ProgramWeek[];
  /** Where a week copy would land, or `null` at the 104-week ceiling. */
  targetWeekNumber: number | null;
  isSaving?: boolean;
  /** The refusal the server returned, if any — the backstop sentence. */
  errorCode?: AppErrorCode | null;
  onDismiss: () => void;
  onCopy: (commit: CopyCommit) => void;
}

const SLOT_HEIGHT = 54;
// `ui-conventions` §5's floor, met by the visible box rather than by hit
// slop: a week chip sits in a wrapping grid, where an overlapping hit area
// would let a thumb land on the neighbour.
const WEEK_CHIP_HEIGHT = 44;

export function CopySheet({
  isOpen,
  subject,
  weeks,
  targetWeekNumber,
  isSaving = false,
  errorCode = null,
  onDismiss,
  onCopy,
}: CopySheetProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const destructiveInk = useDestructiveInk();

  // No reset effect: the screen mounts this sheet only while a subject is
  // chosen, so every open is a fresh mount and the draft starts from the
  // initialiser rather than from an effect racing the first render.
  const [targetWeekId, setTargetWeekId] = useState<string | null>(
    subject.kind === 'day'
      ? (weeks.find((week) => hasDay(week, subject.day.id))?.id ?? null)
      : null,
  );
  const [targetDayNumber, setTargetDayNumber] = useState<number | null>(null);

  const targetWeek = weeks.find((week) => week.id === targetWeekId) ?? null;
  const occupants = targetWeek ? takenDayOccupants(targetWeek) : new Map<number, string>();

  const summary =
    subject.kind === 'day' ? dayCopySummary(subject.day) : weekCopySummary(subject.week);

  const title =
    subject.kind === 'day'
      ? `Copy ${dayFullLabel(subject.day.dayNumber)}`
      : `Copy week ${String(subject.week.weekNumber)}`;
  // The source is named in full: once the coach has moved the week chips,
  // "Copy Tuesday" alone no longer says which Tuesday.
  const subtitle =
    subject.kind === 'day'
      ? `${subject.day.name} · week ${String(subject.sourceWeekNumber)}`
      : `From week ${String(subject.week.weekNumber)} of this program`;

  const canCopy =
    subject.kind === 'day'
      ? targetWeek !== null && targetDayNumber !== null && !isSaving
      : targetWeekNumber !== null && !isSaving;

  // The commit label says what it is about to do, or what is missing — an
  // inert button that is merely grey makes the coach guess (frame 1g).
  const actionLabel = ((): string => {
    if (subject.kind === 'week') {
      return targetWeekNumber === null
        ? WEEK_COPY_INERT_LABEL
        : weekCopyActionLabel(targetWeekNumber);
    }
    if (targetWeek === null || targetDayNumber === null) return DAY_COPY_INERT_LABEL;
    return dayCopyActionLabel(targetWeek.weekNumber, targetDayNumber);
  })();

  const errorMessage = copyErrorMessage(errorCode, {
    weekNumber: targetWeek?.weekNumber ?? targetWeekNumber ?? 0,
    ...(targetDayNumber !== null ? { dayNumber: targetDayNumber } : {}),
  });

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="copy-sheet">
      <SheetHeader title={title} subtitle={subtitle} onClose={onDismiss} density="coach" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Never an adherence colour on a neutral fact (`DESIGN.md` §8) —
            the glyph only draws the eye, the sentence carries the promise. */}
        <View style={[styles.note, themed.note]}>
          <CircleCheck size={15} color={theme.colors.fg.muted} />
          <Text size="body-sm" tone="muted" style={styles.grow} testID="copy-summary">
            {summary}
          </Text>
        </View>

        {subject.kind === 'day' ? (
          <>
            <View style={styles.field}>
              <Text size="eyebrow" tone="warm-muted">
                Into week
              </Text>
              <View style={styles.weekRow}>
                {weeks.map((week) => {
                  const isSelected = week.id === targetWeekId;
                  return (
                    <Pressable
                      key={week.id}
                      onPress={() => {
                        setTargetWeekId(week.id);
                        // The slots belong to the week above them, so a
                        // slot chosen in one week is not a slot in another.
                        setTargetDayNumber(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Week ${String(week.weekNumber)}`}
                      accessibilityState={{ selected: isSelected }}
                      style={[
                        styles.weekChip,
                        isSelected ? themed.weekChipSelected : themed.weekChipFree,
                      ]}
                      testID={`copy-week-${String(week.weekNumber)}`}
                    >
                      <Metric
                        value={week.weekNumber}
                        size="label"
                        tone={isSelected ? 'default' : 'muted'}
                        maxFontSizeMultiplier={1.4}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <Text size="eyebrow" tone="warm-muted">
                On which day
              </Text>
              <View style={styles.slots}>
                {DAY_SLOTS.map((slot) => {
                  const occupant = occupants.get(slot);
                  const isTaken = occupant !== undefined;
                  const isSelected = targetDayNumber === slot;
                  return (
                    <Pressable
                      key={slot}
                      disabled={isTaken}
                      onPress={() => {
                        setTargetDayNumber(slot);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={dayFullLabel(slot)}
                      // The reason it cannot be picked, spoken — a slot
                      // that is merely dimmed is silent to a screen reader
                      // (`accessibility` §2).
                      accessibilityHint={isTaken ? `Already used by ${occupant}` : 'Free'}
                      accessibilityState={{ disabled: isTaken, selected: isSelected }}
                      style={[
                        styles.slot,
                        isTaken ? themed.slotTaken : themed.slotFree,
                        isSelected ? themed.slotSelected : null,
                      ]}
                      testID={`copy-day-slot-${String(slot)}`}
                    >
                      {/* Seven slots share one row's width, so neither
                          label can wrap. Capped rather than clipped — the
                          slot's label and hint carry the full day name and
                          its occupant at any text size. */}
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
          </>
        ) : (
          <View style={styles.field}>
            <Text size="eyebrow" tone="warm-muted">
              Into week
            </Text>
            <Text size="body-sm" tone="default" testID="copy-week-destination">
              {targetWeekNumber === null
                ? WEEK_COPY_CEILING_NOTE
                : `Week ${String(targetWeekNumber)}, the next free week in this program.`}
            </Text>
          </View>
        )}

        {errorMessage ? (
          <View style={[styles.note, themed.noteBad, { borderColor: destructiveInk }]}>
            <CircleAlert size={15} color={destructiveInk} />
            <Text
              size="body-sm"
              tone="urgent"
              accessibilityRole="alert"
              style={styles.grow}
              testID="copy-error"
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        <Text size="caption" tone="subtle" testID="copy-footnote">
          {COPY_FOOTNOTE}
        </Text>
      </ScrollView>
      <SheetFooter
        actionLabel={actionLabel}
        onAction={() => {
          if (subject.kind === 'week') {
            onCopy({ kind: 'week' });
            return;
          }
          if (targetWeek === null || targetDayNumber === null) return;
          onCopy({ kind: 'day', targetWeekId: targetWeek.id, targetDayNumber });
        }}
        isActionDisabled={!canCopy}
        isActionLoading={isSaving}
        density="coach"
      />
    </Sheet>
  );
}

function hasDay(week: ProgramWeek, programDayId: string): boolean {
  return week.days.some((day: ProgramDay) => day.id === programDayId);
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing(14), paddingTop: spacing(12), gap: spacing(14) },
  grow: { flex: 1, minWidth: 0 },
  field: { gap: spacing(8) },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(9),
    padding: spacing(11),
    borderRadius: radius.control,
    borderWidth: 1,
  },
  weekRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(6) },
  weekChip: {
    minWidth: WEEK_CHIP_HEIGHT,
    minHeight: WEEK_CHIP_HEIGHT,
    paddingHorizontal: spacing(10),
    borderRadius: radius.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  note: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.soft },
  noteBad: { backgroundColor: 'transparent', borderColor: t.colors.border.strong },
  weekChipFree: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  weekChipSelected: { backgroundColor: t.colors.bg.raised, borderColor: t.colors.brand.DEFAULT },
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
