import { Card, Text } from '@coachos/ui';
import { createThemedValue, spacing } from '@coachos/ui/theme';
import { formatTargetScheme, type WeightUnit } from '@coachos/utils';
import { ArrowLeftRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SessionReviewExerciseGroup, SessionReviewSet } from '../api.ts';

import { SessionSetRow } from './SessionSetRow.tsx';

// `session-review/01` — one exercise and every set logged against it.
//
// **Rendered as a group, never as a flattened list.** A head, then a card
// of rows: a coach scans by movement, and a 40-row list with the exercise
// repeated on each line is the spreadsheet this product exists to replace.
//
// Order is the SERVER's, top to bottom, and this component never sorts:
// performed order is recovered from `set_logs.logged_at` (the only column
// that records what actually happened) and a skip is interleaved at its
// prescribed position. Both are judgements about the program and the
// client's notes, and both were already made
// (`features/coach/session-review.ts` decisions (b) and (c2)).

const SWAP_GLYPH_SIZE = 13;

export const SESSION_GROUP_COPY = {
  /**
   * The swap, made legible UNDER the name that was actually performed — the
   * client did this exercise, and what they were prescribed is the footnote.
   * Parsed server-side from the first set's note, which is the only trace a
   * substitution leaves.
   */
  substitutedFor: (original: string) => `Substituted for ${original}`,
} as const;

export interface SessionExerciseGroupProps {
  group: SessionReviewExerciseGroup;
  /** Display unit only — the rows never convert (`CLAUDE.md` §0). */
  unit: WeightUnit;
  /**
   * **`session-review/02`'s seam.** Returns the occupant of each row's
   * reserved 32×32 comment cell, keyed on the set it belongs to. Omitted
   * (this task), every row renders the inert placeholder and the column is
   * held open at exactly the same width.
   *
   * A render prop rather than a component prop so one stable callback
   * serves every row — a per-row arrow would allocate a new node each
   * render and defeat `SessionSetRow`'s memo for 40 rows
   * (`frontend-performance` §3).
   */
  renderCommentSlot?: (set: SessionReviewSet) => ReactNode;
  testID?: string;
}

export function SessionExerciseGroup({
  group,
  unit,
  renderCommentSlot,
  testID,
}: SessionExerciseGroupProps) {
  const glyph = useGlyphColor();
  const swapped = group.substitutedFor;
  // `packages/utils`' one scheme formatter, spelled in the READER's unit —
  // the same call `programs/components/ExerciseBlock.tsx` makes, so a coach
  // reads one string for one prescription whether they are writing the day
  // or reviewing it. The server deliberately returns columns rather than a
  // string: the unit belongs to whoever is looking (DB§5.1.1), not to the
  // session.
  //
  // `null` renders NOTHING — no dash, no empty slot. A swapped block, an
  // ad-hoc session and a movement the client added themselves were asked
  // for nothing, which is not the same as being asked for zero (server
  // decision (f)).
  const scheme = group.target === null ? null : formatTargetScheme(group.target, unit);

  return (
    <View testID={testID ?? `session-group-${group.exerciseId}`}>
      {/* One accessible element for the head: the name, what it replaced,
          what it was prescribed, and how many sets follow — so a coach
          moving by heading hears one sentence and then the rows
          (`accessibility` §2). */}
      <View style={styles.head} accessible accessibilityLabel={speakGroupHead(group, unit)}>
        <View style={styles.headRow}>
          <Text size="body-lg" accessibilityRole="header" style={styles.name}>
            {group.exerciseName}
          </Text>
          {scheme === null ? null : (
            <Text size="micro" tone="muted" style={[styles.target, styles.tabular]}>
              {scheme}
            </Text>
          )}
        </View>
        {swapped === null ? null : (
          <View style={styles.swap}>
            <ArrowLeftRight size={SWAP_GLYPH_SIZE} color={glyph} strokeWidth={2} />
            <Text size="micro" tone="warm-muted" style={styles.swapWords}>
              {SESSION_GROUP_COPY.substitutedFor(swapped)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.sets}>
        <Card elevation="raised" density="coach" padded={false}>
          {group.sets.map((set, index) => (
            <SessionSetRow
              key={set.setLogId}
              set={set}
              unit={unit}
              isLast={index === group.sets.length - 1}
              {...(renderCommentSlot === undefined ? {} : { commentSlot: renderCommentSlot(set) })}
            />
          ))}
        </Card>
      </View>
    </View>
  );
}

/**
 * `Barbell Bench Press. Target: 4 × 6–8 · RPE 8. 4 sets.` ·
 * `Dumbbell Shoulder Press, substituted for Barbell Overhead Press. 3 sets.`
 *
 * The count is stated because it is the one fact the head carries that the
 * rows below do not repeat in a form a screen reader can count.
 *
 * The target is the PRINTED scheme, verbatim — the same string
 * `ExerciseBlock.tsx` hands its own reader, for the reason it gives there:
 * the scheme line IS the summary, so a non-sighted coach gets exactly what
 * a sighted one reads. A spelled-out second vocabulary here would be the
 * coach hearing one prescription and reading another. (The client's logger
 * does expand the glyphs, and should: that line is read mid-set by the
 * person loading the bar, not in a review block.)
 *
 * A swapped group never reaches the target branch — the server returns
 * `null` for one — so the two shapes above never combine.
 */
export function speakGroupHead(group: SessionReviewExerciseGroup, unit: WeightUnit): string {
  const name =
    group.substitutedFor === null
      ? group.exerciseName
      : `${group.exerciseName}, substituted for ${group.substitutedFor}`;
  const target = group.target === null ? '' : ` Target: ${formatTargetScheme(group.target, unit)}.`;
  const count = group.sets.length;
  return `${name}.${target} ${String(count)} ${count === 1 ? 'set' : 'sets'}.`;
}

const styles = StyleSheet.create({
  head: {
    // No `numberOfLines` anywhere here: at 200% text a long movement name
    // wraps and the head grows (`accessibility` §3).
    minWidth: 0,
  },
  headRow: {
    flexDirection: 'row',
    // Baseline, not centre: the name and the scheme sit on one line in the
    // prototype's `.ghead`, and they are two different sizes.
    alignItems: 'baseline',
    gap: spacing(10),
    minWidth: 0,
  },
  name: {
    // Takes the row and yields it: the name wraps and the head grows
    // TALLER rather than the scheme being squeezed into nothing, which is
    // what stops the two colliding at 200% text (`accessibility` §3).
    flex: 1,
    minWidth: 0,
  },
  target: {
    textAlign: 'right',
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  swap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(6),
    marginTop: spacing(3),
  },
  swapWords: {
    flex: 1,
    minWidth: 0,
  },
  sets: {
    marginTop: spacing(8),
  },
});

const useGlyphColor = createThemedValue((t) => t.colors.fg.muted);
