import { Metric, Skeleton, Text } from '@coachos/ui';
import { createThemedStyles, spacing } from '@coachos/ui/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useExerciseTarget } from '../hooks/useExerciseTarget.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';
import {
  labelLastPerformance,
  labelTarget,
  lastTimePrefix,
  speakTargetLine,
  targetSeparator,
  NO_HISTORY_LABEL,
  TARGET_UNAVAILABLE_LABEL,
} from '../lib/target-line-copy.ts';

// `session-runtime/04` — "3 × 8–10 @ RPE 8 · last time: 60kg × 9", the
// always-visible block between task 03's page header and the set rows
// `set-entry` will mount below it.
//
// **No surface of its own.** The page is L1 (`elevation.inset`, task 03's
// decision) and `set-entry` puts L2 rows inside it; a card here would spend
// a level the ladder has already allocated, and L3 is left free for
// `session-modifications`' edited-block tint. So this is typography plus one
// `border.soft` hairline — §9's list-row divider — and nothing else.
//
// **Two facts, two voices.** The prescription is Space Grotesk semibold at
// `title` through `Metric`; the history is Instrument Sans at `body-sm`
// through `Text`, with its value back in Space Grotesk. The face and tone
// split is what tells a client which half is their coach speaking and which
// half is their own log, with no badge and no icon.
//
// **Nothing animates.** `DESIGN.md` §5 forbids "motion on a value the coach
// is reading"; a prescribed load read mid-set by the client is the same
// hazard with higher stakes, so the prescription changes by re-render and
// silently. The shimmer on the history skeleton is the only movement here.
//
// **One accessible element.** The whole block is a single `summary` with a
// spelled-out label (`lib/target-line-copy.ts`), not five fragments — a
// screen reader reads `3 × 8–10` as very little otherwise, and this is the
// one line where a misread puts the wrong weight on a bar.

export interface TargetLineProps {
  page: ExercisePage;
  /** The live prescription mirror — `useExerciseTarget`'s task-09 seam. */
  payload: LocalSessionPayload | null;
  sessionLocalId: string;
}

export function TargetLine({ page, payload, sessionLocalId }: TargetLineProps) {
  const unit = useWeightUnit();
  const themed = useThemedStyles();
  const { target, history } = useExerciseTarget({ page, payload, sessionLocalId });

  const targetLabel = labelTarget(target, unit);
  const isLoading = history.kind === 'loading';
  const last = history.kind === 'ready' ? history.last : null;
  const unavailable = history.kind === 'error';

  // The prescription is already in memory, so it renders immediately rather
  // than waiting behind a SQLite read it does not depend on. Only the
  // history half can be pending, and its skeleton stands at the height the
  // resolved line will occupy so nothing shifts under the client's thumb
  // when it lands (`ui-conventions` §4 — a skeleton matching the real
  // layout, never a spinner).
  const historyNode: ReactNode = isLoading ? (
    <Skeleton width={104} height={20} />
  ) : last !== null ? (
    <View style={styles.pair}>
      <Text size="body-sm" tone="muted">
        {lastTimePrefix()}
      </Text>
      <Metric value={labelLastPerformance(last, unit)} size="body-sm" tone="warm" />
    </View>
  ) : (
    // `muted` (5.6:1), never `subtle` (3.1:1). `DESIGN.md` §13 would permit
    // the quieter grey at ≥14px, but the `accessibility` skill's 4.5:1 body
    // floor is the stricter of the two and this line is read at arm's
    // length under gym lighting.
    <Text size="body-sm" tone="muted">
      {unavailable && targetLabel === null ? TARGET_UNAVAILABLE_LABEL : NO_HISTORY_LABEL}
    </Text>
  );

  const label = isLoading
    ? targetLabel === null
      ? 'Loading target'
      : `Target: ${targetLabel}.`
    : speakTargetLine(target, last, unit, { unavailable });

  return (
    <View
      style={[styles.block, themed.block]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={label}
      // `accessible` alone is what merges the children into one item, on
      // both platforms. NOT `importantForAccessibility="no-hide-descendants"`,
      // which on Android hides this view AND its descendants — the block
      // would read as one item on iOS and as nothing at all on Android.
    >
      {targetLabel === null ? null : (
        // The prescription and its separator are ONE flex item, so the `·`
        // travels with the prescription when the row wraps at 200% text: it
        // closes line 1 as "there is more" rather than opening line 2 as a
        // stray bullet. One rule, correct at every scale, no measurement.
        <View style={styles.pair}>
          <Metric value={targetLabel} size="title" />
          <Text size="body-sm" tone="faint">
            {targetSeparator(true, true)}
          </Text>
        </View>
      )}
      {historyNode}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    // Wraps rather than truncates: at 200% text the two halves cannot share
    // a line on a 393pt screen, and `numberOfLines` on a prescribed weight
    // is not an option (`accessibility` §3). No fixed height anywhere — the
    // block grows with the type instead of clipping it.
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing(6),
    rowGap: spacing(3),
    paddingBottom: spacing(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'baseline',
    columnGap: spacing(4),
    // Shrinks before it overflows; the wrap above is what actually saves it.
    flexShrink: 1,
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  block: {
    // §9's list-row divider, which is what separates this from the set rows
    // below — not a card edge, because this is not a card.
    borderBottomColor: colors.border.soft,
  },
}));
