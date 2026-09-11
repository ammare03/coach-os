import { Text } from '@coachos/ui';
import {
  createThemedStyles,
  radius,
  spacing,
  tapTarget,
  useTheme,
  withAlpha,
} from '@coachos/ui/theme';
import { ArrowLeftRight, SkipForward } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SUMMARY_COPY } from '../lib/session-summary.ts';

// `phase-09-workout-logger/session-summary/01` — what the client changed,
// counted.
//
// Four decisions, in the order they matter:
//
// (a) **Absent at zero, not empty at zero.** A session run exactly as the
//     coach wrote it renders nothing here at all — no heading, no well, no
//     "0 skipped". `DESIGN.md` §10.3 and the task's own fourth approach
//     step: the product does not show information about things that did not
//     happen, and a zeroed row would make a clean session look like it had
//     something to answer for.
//
// (b) **Quieter than the records above it.** An L1 inset well against the
//     records' brand-on-maroon, and `warm-muted` ink against their `bright`
//     value. A skip is a FACT about the session; a record is an EVENT in it,
//     and the elevation ladder is what says so without a word.
//
// (c) **Each row carries its own glyph.** `SkipForward` and `ArrowLeftRight`
//     — the exact two `SkipExerciseSheet` and `SwapExerciseSheet` put on the
//     actions that produced these counts, so the summary names the thing the
//     client remembers doing. Shape as well as words, which is what makes
//     the two rows tellable apart at a glance and under greyscale.
//
// (d) **It counts and does not explain.** The reason a client gave for a
//     skip, and the alternative they chose for a swap, both reach the coach
//     in `client_notes` and `set_logs.notes` (`useSkipExercise` decision
//     (a), `useSwapExercise` decision (a)). Repeating them here would turn a
//     two-line fact into a paragraph the client has to read past, on the one
//     screen whose job is to be finished with.

const ICON_SIZE = 16;

export interface ModificationsSummaryProps {
  /** Exercises the client explicitly skipped — `useSkippedExercisesStore`. */
  skippedCount: number;
  /** Pager slots swapped for a coach-approved alternative — `useSubstitutedExercisesStore`. */
  substitutedCount: number;
}

export function ModificationsSummary({
  skippedCount,
  substitutedCount,
}: ModificationsSummaryProps) {
  const themed = useThemedStyles();
  const theme = useTheme();

  // Decision (a). Before any hook-free work, and before the heading.
  if (skippedCount <= 0 && substitutedCount <= 0) return null;

  const rows: { key: string; icon: ReactNode; text: string }[] = [];
  if (skippedCount > 0) {
    rows.push({
      key: 'skipped',
      icon: <SkipForward size={ICON_SIZE} color={theme.colors.fg.muted} strokeWidth={2} />,
      text: SUMMARY_COPY.skipped(skippedCount),
    });
  }
  if (substitutedCount > 0) {
    rows.push({
      key: 'swapped',
      icon: <ArrowLeftRight size={ICON_SIZE} color={theme.colors.fg.muted} strokeWidth={2} />,
      text: SUMMARY_COPY.swapped(substitutedCount),
    });
  }

  return (
    <View style={styles.section} testID="summary-modifications">
      <Text size="eyebrow" tone="muted" accessibilityRole="header" style={styles.heading}>
        {SUMMARY_COPY.changes}
      </Text>

      <View style={[styles.well, themed.well]}>
        {rows.map((row, index) => (
          // One accessible item per fact, so the glyph is never read as a
          // fragment of its own.
          <View
            key={row.key}
            style={[styles.row, index > 0 ? themed.divided : null]}
            accessible
            accessibilityLabel={row.text}
            testID={`summary-modifications-${row.key}`}
          >
            {row.icon}
            {/* Wraps rather than truncates — no `numberOfLines` and no fixed
                height anywhere in this file (`accessibility` §3). */}
            <Text size="body" tone="warm-muted" style={styles.text}>
              {row.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing(9),
  },
  heading: {
    textTransform: 'uppercase',
    paddingHorizontal: spacing(3),
  },
  well: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing(13),
  },
  row: {
    // `minHeight`, never `height`: at 200% text the row grows rather than
    // clipping its own words.
    minHeight: tapTarget.MIN,
    flexDirection: 'row',
    // Not `center`: a wrapped second line would float the glyph to the
    // middle of the paragraph.
    alignItems: 'center',
    gap: spacing(10),
    paddingVertical: spacing(11),
  },
  text: {
    flex: 1,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  well: {
    backgroundColor: withAlpha(theme.colors.bg.inset, '0.5'),
    borderColor: theme.colors.border.soft,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.soft,
  },
}));
