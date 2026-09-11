import { Metric, Text } from '@coachos/ui';
import { spacing } from '@coachos/ui/theme';
import { formatWeight, type WeightUnit } from '@coachos/utils';
import { StyleSheet, View } from 'react-native';

import type { LastPerformanceState } from '../hooks/useExerciseTarget.ts';
import type { PreviousSet } from '../lib/last-performance.ts';
import { labelLastPerformance } from '../lib/target-line-copy.ts';

import { speakLoad, speakUnit, toDisplayWeight } from './SetEntryRow.tsx';

// `set-entry/03` — what THIS set number was last time, in the two places the
// design puts it: the composer's context band while the client is choosing a
// weight, and the trailing slot of a set they have already logged.
//
// ================= THE RULE THIS FILE EXISTS TO HOLD ==================
//
// **Set 3 shows set 3.** Never the exercise-level aggregate (that is
// `session-runtime/04`'s target line, one row above), and never the
// previous session's third *array element*. The lookup is
// `bySetNumber.get(n)` — a keyed read — because a previous session with a
// deleted set 2, or rows that arrived out of order, aligns correctly under
// a key and wrong under a position. That is the failure this task's Risks
// section names, and `pickPreviousSession` builds the map for exactly it.
//
// ==================== THE THREE ABSENCES, RANKED ======================
//
//   1. the read is loading or failed      → nothing, everywhere
//   2. the client has never logged this   → nothing, everywhere
//   3. the session existed, set N did not → nothing on the row;
//                                           "no set 4 last time" in the
//                                           composer, and only there
//
// **Only the composer spends words**, because that is the one place the
// client is deciding how much weight to put on a bar and the absence
// changes the decision. On a logged row the fact is already history.
// Nothing renders a dash, a placeholder, or an apology: an absence is not
// a failure (`COPY.md` §CO2, design spec §10.5).
//
// **Nothing here implies a network.** `history` resolves from SQLite
// (`readPreviousSession`), so `loading` is a few milliseconds of local read
// and gets no spinner, no skeleton, and no pending tint — a spinner in this
// band would be a lie about an offline query.

/**
 * Every word this line says, and the only place it says them — the same
 * shape as `SET_ENTRY_COPY`, so the composer and the row can never word one
 * set two ways.
 */
export const PREVIOUS_SET_COPY = {
  /** The lead-in, both placements. Lowercase: a label, not a sentence. */
  prefix: 'last',
  /** Composer only. States the fact and adds nothing to it. */
  absent: (setNumber: number) => `no set ${String(setNumber)} last time`,
  /** Spoken. Glyphs expanded to words — `×` is never read aloud usefully. */
  speak: (load: string) => `Last time ${load}.`,
  speakAbsent: (setNumber: number) => `No set ${String(setNumber)} last time.`,
} as const;

/**
 * Where the line is rendered, which is the only thing that differs between
 * the two — same data, same lookup, two registers.
 *
 * `composer` — context band, `caption` 12, `last` in `fg.muted` and the
 * value in `fg.warm`, unit printed. Speaks for itself.
 * `row` — trailing slot, `micro` 11, `fg.muted`, **unit dropped** because
 * it is already on the load beside it. Silent: `SetRow` reads the whole row
 * as one item and takes this line's words through `trailingLabel`.
 */
export type PreviousSetPlacement = 'composer' | 'row';

export type PreviousSetLineState =
  { kind: 'none' } | { kind: 'missing'; setNumber: number } | { kind: 'present'; set: PreviousSet };

export interface PreviousSetLineProps {
  /** `useExerciseTarget`'s history half, passed through untouched. */
  history: LastPerformanceState;
  /** The set number to match. **Never an array index** — see the header. */
  setNumber: number;
  /** Display unit only. The map holds kilograms and this converts at the edge. */
  unit: WeightUnit;
  placement: PreviousSetPlacement;
  testID?: string;
}

/**
 * The lookup, separated from the render so the three absences can be
 * asserted without mounting anything.
 *
 * `loading` and `error` collapse into `none` deliberately: both render the
 * same nothing, and a client mid-set cannot act on the difference
 * (`UI-UX.md` §UX8 — an optional section fails quietly).
 */
export function resolvePreviousSetLine(
  history: LastPerformanceState,
  setNumber: number,
): PreviousSetLineState {
  if (history.kind !== 'ready') return { kind: 'none' };
  if (history.previous === null) return { kind: 'none' };

  const set = history.previous.bySetNumber.get(setNumber);
  return set === undefined ? { kind: 'missing', setNumber } : { kind: 'present', set };
}

/**
 * What a screen reader hears, or `undefined` when there is nothing to say.
 *
 * Exported because a logged row does **not** speak this line itself — the
 * row is one accessible element (`accessibility` §2) and `SetList` hands the
 * sentence to `SetRow` as `trailingLabel`, which appends it to the row's own
 * label. A separately focusable line beside every logged set would put a
 * second stop between the client and the confirm.
 */
export function speakPreviousSetLine(
  history: LastPerformanceState,
  setNumber: number,
  unit: WeightUnit,
): string | undefined {
  const state = resolvePreviousSetLine(history, setNumber);
  if (state.kind === 'none') return undefined;
  if (state.kind === 'missing') return PREVIOUS_SET_COPY.speakAbsent(state.setNumber);
  return PREVIOUS_SET_COPY.speak(speakPrevious(state.set, unit));
}

export function PreviousSetLine({
  history,
  setNumber,
  unit,
  placement,
  testID,
}: PreviousSetLineProps) {
  const state = resolvePreviousSetLine(history, setNumber);

  if (state.kind === 'none') return null;

  if (state.kind === 'missing') {
    // The row's absent state is nothing at all — no dash, no placeholder.
    if (placement === 'row') return null;

    return (
      <Text
        size="caption"
        tone="muted"
        // One utterance, and not a control: the band is reference, the
        // steppers are the interaction.
        accessible
        accessibilityLabel={PREVIOUS_SET_COPY.speakAbsent(setNumber)}
        // No `numberOfLines`: at 200% text this wraps and the band grows
        // with it (`accessibility` §3).
        style={styles.absent}
        testID={testID}
      >
        {PREVIOUS_SET_COPY.absent(setNumber)}
      </Text>
    );
  }

  if (placement === 'row') {
    return (
      // Carries no accessibility props of its own: `SetRow` wraps the whole
      // row in one `accessible` element, which merges this in, and the words
      // reach a screen reader through `trailingLabel` — spelled out, rather
      // than as the `×` glyph. Hiding it explicitly would say the same thing
      // twice and hide it from the tests that prove it renders.
      <Text size="micro" tone="muted" style={styles.row} testID={testID}>
        {`${PREVIOUS_SET_COPY.prefix} ${labelRowLoad(state.set, unit)}`}
      </Text>
    );
  }

  return (
    <View
      style={styles.composer}
      accessible
      accessibilityLabel={PREVIOUS_SET_COPY.speak(speakPrevious(state.set, unit))}
      testID={testID}
    >
      <Text size="caption" tone="muted">
        {PREVIOUS_SET_COPY.prefix}
      </Text>
      {/* `Metric`, not `Text` — Space Grotesk and tabular numerals, so the
          figure does not jitter against the load above it. */}
      <Metric value={labelLastPerformance(state.set, unit)} size="caption" tone="warm" />
    </View>
  );
}

/**
 * `12.5 × 15` — the row's form, with the unit dropped.
 *
 * Dropped because the load it sits beside already carries it and 270px will
 * not hold it twice (design spec, copy table). The numeral still goes
 * through `packages/utils`, so a client on pounds never reads kilograms
 * (`product-copy` §6); only the suffix is omitted, never hand-written.
 *
 * A set with only one of the two keeps `labelLastPerformance` unchanged —
 * a bare `12.5` with no rep count and no unit is not a fact.
 */
function labelRowLoad(set: PreviousSet, unit: WeightUnit): string {
  if (set.weightKg === null || set.reps === null) return labelLastPerformance(set, unit);
  const weight = Number(formatWeight(set.weightKg, unit));
  return `${String(weight)} ${MULTIPLY} ${String(set.reps)}`;
}

/** `80 kilograms for 8 reps` · `12 reps` · `80 kilograms`. */
function speakPrevious(set: PreviousSet, unit: WeightUnit): string {
  const displayWeight = toDisplayWeight(set.weightKg, unit);
  // `speakLoad` owns the pairing and the bodyweight case, but it always
  // appends a rep count — a loaded set with none (a timed carry) is the one
  // shape it cannot word.
  if (set.reps === null && displayWeight !== null) return speakWeightAlone(displayWeight, unit);
  // `?? 0` mirrors `labelLastPerformance`; `pickPreviousSession` filters
  // sets with neither value, so it is a guard, not a case.
  return speakLoad(displayWeight, set.reps ?? 0, unit);
}

/** Singularised off `speakUnit`, so the spoken unit still has one source. */
function speakWeightAlone(displayWeight: number, unit: WeightUnit): string {
  const plural = speakUnit(unit);
  return `${String(displayWeight)} ${displayWeight === 1 ? plural.slice(0, -1) : plural}`;
}

/** The glyph the target line and the logged row already use between load and reps. */
const MULTIPLY = '×';

const styles = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps rather than truncating at 200% text; the band is `minHeight`,
    // so it grows instead of clipping.
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    columnGap: spacing(4),
    flexShrink: 1,
  },
  absent: {
    flexShrink: 1,
    textAlign: 'right',
  },
  row: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
