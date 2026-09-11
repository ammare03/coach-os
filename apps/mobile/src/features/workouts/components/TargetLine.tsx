import { Metric, Skeleton, Text } from '@coachos/ui';
import { createThemedStyles, spacing } from '@coachos/ui/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useWeightUnit } from '../../../hooks/useWeightUnit.ts';
import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useExerciseTarget } from '../hooks/useExerciseTarget.ts';
import { useLiveTarget } from '../hooks/useLiveTargetOverride.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';
import {
  labelLastPerformance,
  labelSupersededTarget,
  labelTarget,
  lastTimePrefix,
  speakTargetLine,
  targetSeparator,
  LIVE_OVERRIDE_LABEL,
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
//
// ============ WHERE `session-modifications/04` PLUGGED IN ==============
//
// §8.9's live coach adjustment lands here and nowhere else on this screen.
// The line subscribes to it itself, through `useLiveTarget`, the way
// `RestTimerBar` subscribes to the rest store — no screen wiring, no prop
// threaded down from the logger, and nothing for P19 to find and connect.
//
// **Three channels, because one would be hue alone** (`DESIGN.md` §8's
// rule, and `ui-conventions` §8's): the §8 "Live / new" dot, the
// attribution label, and the superseded value struck through. Desaturate
// the screen and the change is still obvious — which matters, because the
// posture §8.9 describes is the phone on the floor three metres away.
//
// **Still nothing animates.** §8 pairs that dot with `pulsedot`, and the
// rule above — §5 forbids motion on a value being read — is the stricter
// of the two here: this line is read between two working sets to decide
// what goes on a bar. The change is noticed because the line is different,
// not because it flickers.
//
// **Still no surface.** No card, no tint, no glass: the page is L1 and the
// set rows are L2, and spending a level here would move the composer,
// whose confirm control sits at one screen coordinate all session.

export interface TargetLineProps {
  page: ExercisePage;
  /** The live prescription mirror — `useExerciseTarget`'s task-09 seam. */
  payload: LocalSessionPayload | null;
  sessionLocalId: string;
}

export function TargetLine({ page, payload, sessionLocalId }: TargetLineProps) {
  const unit = useWeightUnit();
  const themed = useThemedStyles();
  const { target: programTarget, history } = useExerciseTarget({ page, payload, sessionLocalId });
  // The live layer, subscribed to here rather than threaded down from the
  // logger — `RestTimerBar` reads its store the same way.
  const { target, isLiveOverridden } = useLiveTarget(
    programTarget,
    page.exerciseId,
    sessionLocalId,
  );

  const targetLabel = labelTarget(target, unit);
  // `null` when the adjustment does not reach this line at all — a change
  // to rest seconds prints the same string, and the same numbers twice with
  // an arrow between them would read as a bug.
  const supersededLabel = labelSupersededTarget(programTarget, target, unit);
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
    : speakTargetLine(target, last, unit, {
        unavailable,
        isLiveOverridden,
        // The same rule the printed strike uses, so what is heard and what
        // is seen can never disagree about whether anything changed.
        supersededTarget: supersededLabel === null ? null : programTarget,
      });

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
      {isLiveOverridden ? (
        <View style={styles.pair}>
          {/* `DESIGN.md` §8's "Live / new" dot, rendered as a glyph rather
              than a sized view: `tone="urgent"` is the palette's own
              accent-text role, and a glyph grows with dynamic type where a
              fixed 8px circle would not. Not the adherence ramp — a coach
              changing a target says nothing about whether the client is on
              plan. */}
          <Text size="body-sm" tone="urgent">
            {LIVE_DOT}
          </Text>
          <Text size="label" tone="urgent">
            {LIVE_OVERRIDE_LABEL}
          </Text>
        </View>
      ) : null}
      {supersededLabel === null ? null : (
        <View style={styles.pair}>
          {/* The third channel, and the only one that survives greyscale
              on its own. A strike, not a dimming: dimming is what `faint`
              already means on this line, and it would not read at three
              metres. */}
          <Metric value={supersededLabel} size="title" tone="muted" className="line-through" />
          <Text size="body-sm" tone="faint">
            {SUPERSEDED_ARROW}
          </Text>
        </View>
      )}
      {targetLabel === null ? null : (
        // The prescription and its separator are ONE flex item, so the `·`
        // travels with the prescription when the row wraps at 200% text: it
        // closes line 1 as "there is more" rather than opening line 2 as a
        // stray bullet. One rule, correct at every scale, no measurement.
        <View style={styles.pair}>
          <Metric value={targetLabel} size="title" tone={isLiveOverridden ? 'bright' : 'default'} />
          <Text size="body-sm" tone="faint">
            {targetSeparator(true, true)}
          </Text>
        </View>
      )}
      {historyNode}
    </View>
  );
}

/** `DESIGN.md` §8's live dot. A glyph, so it scales with the type around it. */
const LIVE_DOT = '●';

/** Between the superseded value and the one that replaced it. */
const SUPERSEDED_ARROW = '→';

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
