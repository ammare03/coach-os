import { Card, Text } from '@coachos/ui';
import { createThemedValue, density, spacing } from '@coachos/ui/theme';
import { SkipForward } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { SessionReviewSkippedExercise } from '../api.ts';

// `session-review/01` — an exercise the client explicitly skipped, rendered
// as a ROW and never as an absence.
//
// A coach reading top to bottom needs "they skipped lateral raises after
// incline press", not an exercise quietly missing from a list. The server
// interleaves it where the program put it; this draws it there.
//
// **L1, not L2.** A skip is a quieter register than work that happened —
// the same move the client's own session summary makes for a change. It is
// not an alert and it is not red: the client did not fail, they told their
// coach something (`DESIGN.md` §8 reserves `urgent` for missed, overdue and
// destructive; `COPY.md` CO§2's no-shame rule).

export const SESSION_SKIP_COPY = {
  flag: 'Skipped',
} as const;

const GLYPH_SIZE = 16;

export interface SessionSkippedRowProps {
  entry: SessionReviewSkippedExercise;
  testID?: string;
}

export function SessionSkippedRow({ entry, testID }: SessionSkippedRowProps) {
  const glyph = useGlyphColor();
  const why = formatSkipReason(entry);

  return (
    <Card
      elevation="inset"
      density="coach"
      padded={false}
      testID={testID ?? `session-skip-${entry.exerciseName}`}
    >
      {/* One accessible element. "Skipped" arrives as a WORD, which is also
          what makes the row readable with no colour vision at all
          (`accessibility` §2, §4). */}
      <View style={styles.row} accessible accessibilityLabel={speakSkippedRow(entry)}>
        <SkipForward
          size={GLYPH_SIZE}
          color={glyph}
          strokeWidth={2}
          // The glyph carries nothing the words do not.
        />
        <View style={styles.words}>
          <View style={styles.top}>
            <Text size="body-lg" tone="muted" style={styles.name}>
              {entry.exerciseName}
            </Text>
            <Text size="eyebrow" tone="warm">
              {SESSION_SKIP_COPY.flag.toUpperCase()}
            </Text>
          </View>
          {why === null ? null : (
            <Text size="body-sm" tone="warm-muted" style={styles.why}>
              {why}
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * `Out of time · “Gym closed at 8.”`
 *
 * The reason is the client's own label and the quote is their own sentence;
 * the screen adds no word to either, because a coach reads these aloud
 * (`product-copy` §3). The only edit is the leading capital the label lost
 * when it was stored mid-sentence.
 */
export function formatSkipReason(entry: SessionReviewSkippedExercise): string | null {
  const reason = capitaliseFirst(entry.reasonLabel);
  const quote = entry.note === null ? null : `“${entry.note}”`;
  const parts = [reason, quote].filter((part): part is string => part !== null && part !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

/** `Dumbbell Lateral Raise. Skipped. Out of time. Gym closed at 8.` */
export function speakSkippedRow(entry: SessionReviewSkippedExercise): string {
  const sentences = [`${entry.exerciseName}.`, `${SESSION_SKIP_COPY.flag}.`];
  const reason = capitaliseFirst(entry.reasonLabel);
  if (reason !== '') sentences.push(endWithStop(reason));
  if (entry.note !== null && entry.note !== '') sentences.push(endWithStop(entry.note));
  return sentences.join(' ');
}

function capitaliseFirst(value: string): string {
  const first = value.charAt(0);
  return first === '' ? '' : `${first.toUpperCase()}${value.slice(1)}`;
}

/** A screen reader runs two clauses together without one; the client's own may already have it. */
function endWithStop(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    // Matches the set row's box, so a skip reads as a row of the session
    // rather than a differently-sized interruption. `minHeight`, never
    // `height` (`accessibility` §3).
    minHeight: density.coach.row,
    paddingVertical: spacing(12),
    paddingHorizontal: spacing(13),
    gap: spacing(10),
  },
  words: {
    flex: 1,
    minWidth: 0,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing(10),
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  why: {
    marginTop: spacing(3),
  },
});

const useGlyphColor = createThemedValue((t) => t.colors.fg.muted);
