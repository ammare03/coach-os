import {
  Badge,
  Card,
  createThemedStyles,
  Metric,
  Pressable,
  radius,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { formatIntensityShort, formatTargetScheme } from '@coachos/utils';
import { ChevronRight } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { ProgramDayExercise } from '../api/programs.ts';

// One exercise block on a program day (`program-builder/02`, frame 1b).
//
// **The scheme line is the same string the client's logger shows as its
// target line** — built by `formatTargetScheme` in `packages/utils`, never
// assembled here, so the coach and the client can never be reading two
// different sentences about the same set (`@coachos/utils`' own header).
//
// Self-contained on purpose: `program-builder/03` wraps this row in a
// draggable list and `04` groups it into supersets. Both take over the
// container; neither should have to reopen the row.

/** Five 46px chips is the most that stays legible across a 361px content width. */
const CHIPS_PER_ROW = 5;
const CHIP_HEIGHT = 46;
const CHIP_MAX_SCALE = 1.3;

export interface ExerciseBlockProps {
  block: ProgramDayExercise;
  onPress: () => void;
  testID?: string;
}

export function ExerciseBlock({ block, onPress, testID }: ExerciseBlockProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  const scheme = formatTargetScheme(block);
  const reps = repsLabel(block);
  const intensity = formatIntensityShort(block);
  const setRows = chunk(block.targetSets, CHIPS_PER_ROW);

  return (
    <Card elevation="raised" density="coach" {...(testID ? { testID } : {})}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        // The superset letter is folded in here rather than left to the
        // badge, which is `accessibilityElementsHidden` by contract — a
        // standalone focusable "A" tells a screen-reader user nothing
        // (`Badge`'s own docblock).
        accessibilityLabel={
          block.supersetGroup === null
            ? block.exerciseName
            : `${block.exerciseName}, superset ${block.supersetGroup}`
        }
        // The scheme line IS the summary, so a screen reader gets exactly
        // what a sighted coach reads under the name — and the per-set chips
        // below repeat it visually, which is why they are hidden from the
        // reader rather than announced twenty times (`accessibility` §2).
        accessibilityHint={scheme}
        style={styles.header}
        testID={testID === undefined ? undefined : `${testID}-open`}
      >
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <Text size="body-sm" numberOfLines={2}>
              {block.exerciseName}
            </Text>
            {/* `program-builder/04` owns superset grouping — the rail, the
                tint and the A1/A2 positions. Until then the letter is shown
                rather than hidden, so a group authored elsewhere is never
                invisible here. */}
            {block.supersetGroup === null ? null : (
              <Badge tone="brand" size="sm" label={block.supersetGroup} testID="superset-group" />
            )}
          </View>
          <Text size="micro" tone="muted" numberOfLines={1}>
            {scheme}
          </Text>
        </View>
        <ChevronRight size={15} color={theme.colors.fg.faint} />
      </Pressable>

      <View
        style={styles.setRows}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {setRows.map((row) => (
          // Keyed on the row's first set number — stable, and unique
          // because the rows are a contiguous partition of 1..targetSets.
          <View key={row[0]} style={styles.setRow}>
            {row.map((setNumber) => (
              <View key={setNumber} style={[styles.chip, themed.chip]}>
                {/* Reps on top: it is the number the client acts on.
                    Intensity sits under it (frame 1b). */}
                <Metric
                  value={reps}
                  size="body-sm"
                  maxFontSizeMultiplier={CHIP_MAX_SCALE}
                  testID={`set-chip-${setNumber}-reps`}
                />
                {intensity === null ? null : (
                  <Text size="micro" tone="subtle" maxFontSizeMultiplier={CHIP_MAX_SCALE}>
                    {intensity}
                  </Text>
                )}
              </View>
            ))}
            {/* Keeps the last, short row's chips the same width as a full
                row's rather than stretching them across the card. */}
            {Array.from({ length: CHIPS_PER_ROW - row.length }, (_, index) => (
              <View key={`spacer-${index}`} style={styles.grow} />
            ))}
          </View>
        ))}
      </View>

      {block.coachNotes === null ? null : (
        <Text size="caption" tone="warm" style={styles.notes}>
          {block.coachNotes}
        </Text>
      )}
    </Card>
  );
}

/** The chip's own top line — the rep range, or an em dash when there is none to show. */
function repsLabel(block: ProgramDayExercise): string {
  if (block.targetRepsMin === null && block.targetRepsMax === null) return '—';
  if (block.targetRepsMin === null) return String(block.targetRepsMax);
  if (block.targetRepsMax === null || block.targetRepsMax === block.targetRepsMin) {
    return String(block.targetRepsMin);
  }
  return `${block.targetRepsMin}–${block.targetRepsMax}`;
}

function chunk(count: number, size: number): number[][] {
  const rows: number[][] = [];
  for (let start = 1; start <= count; start += size) {
    rows.push(
      Array.from({ length: Math.min(size, count - start + 1) }, (_, index) => start + index),
    );
  }
  return rows;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(10), minHeight: 44 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(8), flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0 },
  setRows: { gap: spacing(6), marginTop: spacing(10) },
  setRow: { flexDirection: 'row', gap: spacing(6) },
  chip: {
    flex: 1,
    minHeight: CHIP_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(3),
  },
  notes: { marginTop: spacing(9) },
});

const useThemedStyles = createThemedStyles((t) => ({
  chip: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
}));
