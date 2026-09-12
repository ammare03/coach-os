import { Text } from '@coachos/ui';
import {
  createThemedValue,
  density,
  radius,
  spacing,
  tapTarget,
  withAlpha,
} from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { MessageSquare, Triangle } from 'lucide-react-native';
import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SET_FLAG_COPY } from '../../workouts/components/SetFlagChips.tsx';
// `PR_COPY`, `SET_FLAG_COPY` and `speakWeight` are imported rather than
// restated: a record, a warm-up and a weight read aloud are the same facts
// the client saw in the moment, and a coach reading them back a day later
// must hear the same words (`code-conventions` §1 — a string that exists
// twice is already wrong in one place). Promoting them to `packages/ui`
// would mean editing `features/workouts`, which this task may not touch;
// reading from them costs nothing and drifts nowhere.
import { PR_COPY } from '../../workouts/lib/pr-celebration.ts';
import { speakWeight } from '../../workouts/lib/target-line-copy.ts';
import type { SessionReviewSet } from '../api.ts';

import { formatSessionVolume as formatDisplayWeight } from './SessionHistoryRow.tsx';

// `session-review/01` — ONE logged set, in the coach's read-only register.
//
// The client's own `SetRow` is a receipt for work just done; this is a line
// of a record being read hours later. So: no tick (nothing is being
// confirmed), no swipe, no edit, no entrance animation — the client owns
// editing their own logged data (`phase-09-workout-logger/set-entry/05`)
// and the coach owns reading it. Nothing on this row is pressable, and
// nothing about it moves.
//
// **What IS carried from the client's row:** the `W` glyph instead of a
// numeral, the load one ink-step down for a warm-up, and the record's
// triangle. Both flags differ by GLYPH before they differ by hue, which is
// what makes the row survive greyscale (`accessibility` §4).
//
// **What is deliberately NOT carried from `personal-records/03`:** the
// `prpop` overshoot, `easing.celebrate`, and the brand glow. `DESIGN.md` §5
// forbids motion on a value someone is reading, and the celebration is the
// client's one moment — repeating it here would spend it twice.

/**
 * **`12 + 32 + 12`, and every term is load-bearing.**
 *
 * The 32px comment slot is the tallest layout child, and 12px either side
 * of it lands exactly on `tokens.ts`' `density.coach.row`. FlashList v2
 * deleted `estimatedItemSize` (`CLAUDE.md` §25.8), so a stable first layout
 * is the row's own job — this screen is a `ScrollView` because a session is
 * bounded, but the number still earns its place twice over: at 200% text
 * the row grows past it instead of clipping, and `session-review/02` needs
 * a predictable row box to scroll a commented set into view.
 *
 * `minHeight`, NEVER `height`.
 */
export const SESSION_SET_ROW_MIN_HEIGHT = density.coach.row;

/**
 * **The reserved comment cell.** 32×32, the last child of every row —
 * warm-ups included — so the numeral channel is one width for the whole
 * session and a coach scanning 22 sets never has to re-find the right edge.
 *
 * `session-review/02` drops its control in here through
 * {@link SessionSetRowProps.commentSlot}; holding the column open is this
 * task's job, not that one's.
 */
export const SESSION_COMMENT_SLOT_SIZE = 32;

/**
 * `ui-conventions` §5's 48px floor, reached by SLOP rather than by growing
 * the 32px box — growing it would push the numerals off the row.
 *
 * `ceil((48 − 32) / 2) = 8` on all four sides. Exported so
 * `session-review/02` applies the arithmetic this row's geometry implies
 * instead of re-deriving it. 48 rather than `tapTarget.MIN`'s 44 because §5
 * and `DESIGN.md` §13 disagree and the larger general floor wins;
 * `tapTarget` is read here so that relationship is visible rather than
 * asserted.
 */
export const SESSION_COMMENT_SLOT_TAP_TARGET = Math.max(48, tapTarget.MIN);
export const SESSION_COMMENT_SLOT_HIT_SLOP = Math.ceil(
  (SESSION_COMMENT_SLOT_TAP_TARGET - SESSION_COMMENT_SLOT_SIZE) / 2,
);

/** `DESIGN.md` §8's record mark: a SHAPE first, an ink second. 13px, solid. */
const RECORD_MARK_SIZE = 13;
/** The placeholder glyph in the reserved slot, at the design's measured size. */
const COMMENT_GLYPH_SIZE = 14;

/**
 * The words a set says when nothing was loaded onto a bar.
 *
 * Not "0 kg" and not a dash: a bodyweight set did not lift nothing
 * (`COPY.md` CO§2), and a dash makes a screen reader announce an empty
 * cell.
 */
const BODYWEIGHT = 'Bodyweight';

/** The failure marker. A letter, exactly as `W` is — see this file's header. */
const FAILURE_GLYPH = 'F';

export interface SessionSetRowProps {
  set: SessionReviewSet;
  /** Display unit only — the row never converts, it hands `packages/utils` the kilograms. */
  unit: WeightUnit;
  /**
   * **The reserved 32×32 cell's occupant.**
   *
   * Absent (this task), the cell renders an inert placeholder disc, so the
   * column exists and every row is the same width. Supplied
   * (`session-review/02`'s `CommentAffordance`, keyed on `set.setLogId`),
   * that renders instead — the box, its position and the row's geometry are
   * unchanged either way, which is the whole point of reserving it now.
   *
   * Whatever goes in here owns its own accessibility: the row is a single
   * accessible element and the slot's occupant is its one child action
   * (`accessibility` §2).
   */
  commentSlot?: ReactNode;
  /** The last row of a group draws no divider — the card's own edge closes it. */
  isLast?: boolean;
  testID?: string;
}

/**
 * Memoised: a 72-set session re-renders every row whenever the screen does,
 * and a row's props change only when its own set does
 * (`frontend-performance` §3).
 */
export const SessionSetRow = memo(function SessionSetRow({
  set,
  unit,
  commentSlot,
  isLast = false,
  testID,
}: SessionSetRowProps) {
  const ink = useSetRowInk();
  const isRecord = set.personalRecordTypes.length > 0;
  const numeralColor = isRecord ? ink.record : set.isWarmup ? ink.muted : ink.warm;
  const loadColor = isRecord ? ink.record : set.isWarmup ? ink.muted : ink.text;

  const exertion = formatSetExertion(set);
  const moreRecords = set.personalRecordTypes.length - 1;

  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: ink.divider },
        isRecord ? { backgroundColor: ink.recordFill, borderBottomColor: ink.recordEdge } : null,
        isLast ? styles.lastRow : null,
      ]}
      // One sentence per row, not five fragments (`accessibility` §2). The
      // slot's occupant is the row's one child action and speaks for itself.
      accessible
      accessibilityLabel={speakSetRow(set, unit)}
      testID={testID ?? `session-set-${set.setLogId}`}
    >
      <View style={styles.number}>
        <SetNumeral
          value={set.isWarmup ? SET_FLAG_COPY.warmupGlyph : String(set.setNumber)}
          color={numeralColor}
        />
      </View>

      {/* No `numberOfLines`: at 200% text the load wraps and the row grows
          with it (`accessibility` §3). */}
      <SetNumeral value={formatSetLoad(set, unit)} color={loadColor} />

      {isRecord ? (
        // The `View` carries the `testID`: a Lucide icon spreads its props
        // onto `react-native-svg`, which does not forward one.
        <View testID="session-set-record-mark">
          <Triangle
            size={RECORD_MARK_SIZE}
            color={ink.record}
            fill={ink.record}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </View>
      ) : null}

      {/* "and N more record types on this set" — never rendered at 0, and
          never four separate marks (`PR_COPY.moreLabel`). */}
      {moreRecords > 0 ? (
        <View
          style={[styles.more, { backgroundColor: ink.moreFill, borderColor: ink.recordEdge }]}
          testID="session-set-record-more"
        >
          <Text size="micro" tone="warm" style={styles.tabular}>
            {PR_COPY.moreLabel(moreRecords)}
          </Text>
        </View>
      ) : null}

      {/* A single glyph in the numeral channel, the same way `W` is. The
          WORDS cost ~66px of a 315px channel and do not fit; the letter
          costs 20, and the words arrive intact in the spoken label. */}
      {set.isFailure ? (
        <View
          style={[styles.failure, { borderColor: ink.failureEdge }]}
          testID="session-set-failure"
        >
          <Text size="micro" style={[styles.tabular, { color: ink.failureInk }]}>
            {FAILURE_GLYPH}
          </Text>
        </View>
      ) : null}

      <View style={styles.gap} />

      {exertion === null ? null : (
        <Text size="caption" tone="muted" style={styles.tabular}>
          {exertion}
        </Text>
      )}

      {/* Reserved on EVERY row, warm-ups included. `session-review/02`
          replaces the placeholder; the geometry does not move when it does. */}
      <View style={styles.slot} testID="session-set-comment-slot">
        {commentSlot ?? <CommentSlotPlaceholder />}
      </View>
    </View>
  );
});

interface SetNumeralProps {
  value: string;
  color: string;
}

/**
 * A numeral in the row's own ink.
 *
 * `Metric` is the product's number component and this is deliberately not
 * it: `Metric` exposes no `style`, and its `tone` set has no entry for the
 * record's ink — which is a SCHEME-LOCAL resolution this screen makes
 * (see {@link useSetRowInk}) rather than a token. So the face and the
 * tabular figures `DESIGN.md` §1.2 actually requires are reproduced exactly
 * — `size="numeral"` is the same `font-display-semibold` at the same
 * 15/19 that `Metric` would pick — and only the colour is resolved here.
 * One component for all four inks, so "the record row is a different
 * colour" cannot become four scattered branches.
 */
function SetNumeral({ value, color }: SetNumeralProps) {
  return (
    <Text size="numeral" style={[styles.tabular, { color }]}>
      {value}
    </Text>
  );
}

/**
 * The empty cell, until `session-review/02` fills it.
 *
 * Silent and unfocusable: it does nothing, so claiming a role would be a
 * lie to a screen reader, and a stop on every one of 72 rows that leads
 * nowhere is worse than no stop at all.
 */
function CommentSlotPlaceholder() {
  const ink = useSetRowInk();

  return (
    <View
      style={[styles.disc, { backgroundColor: ink.discFill, borderColor: ink.discEdge }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MessageSquare size={COMMENT_GLYPH_SIZE} color={ink.discGlyph} strokeWidth={2} />
    </View>
  );
}

/**
 * `92.5 kg × 8` · `Bodyweight × 12` · `Bodyweight · 45 s`.
 *
 * Kilograms in, the reader's unit out — `formatWeight` in `packages/utils`
 * is the one place a stored kilogram becomes a displayed number
 * (`CLAUDE.md` §0), reached here through the history row's own formatter so
 * one session's weights are spelled the same on both surfaces.
 *
 * **A figure that does not exist contributes nothing** — no `0`, no dash,
 * no greyed placeholder (`COPY.md` CO§2). A rep-based set says nothing
 * about seconds and a timed hold says nothing about reps.
 */
export function formatSetLoad(set: SessionReviewSet, unit: WeightUnit): string {
  const measures: string[] = [];
  if (set.durationSeconds !== null) measures.push(`${String(set.durationSeconds)} s`);
  if (set.distanceM !== null) measures.push(`${String(set.distanceM)} m`);

  const load =
    set.weightKg === null ? BODYWEIGHT : `${formatDisplayWeight(set.weightKg, unit)} ${unit}`;

  // `×` binds a load to a rep count; `·` joins it to anything else. A set
  // with neither says the load alone rather than trailing punctuation.
  const reps = set.reps === null ? null : `${load} × ${String(set.reps)}`;
  return [reps ?? load, ...measures].join(' · ');
}

/**
 * `RPE 8` · `2 RIR` · nothing.
 *
 * RPE first when both are present: it is the scale a prescription is
 * written in, and a set carrying both is one rating expressed two ways
 * rather than two separate claims.
 */
export function formatSetExertion(set: SessionReviewSet): string | null {
  if (set.rpe !== null) return `RPE ${String(set.rpe)}`;
  if (set.rir !== null) return `${String(set.rir)} RIR`;
  return null;
}

/**
 * `Set 1. 92.5 kilograms, 8 reps. RPE 8.`
 *
 * One sentence, so a coach reading 40 sets with VoiceOver hears 40
 * sentences rather than 200 fragments (`accessibility` §2). Every glyph the
 * row compresses arrives here as a word: `W` becomes "Warm-up set", `F`
 * becomes `SET_FLAG_COPY.failureTagSpoken`, and the triangle becomes
 * `PR_COPY.title` — which is also what makes the row readable with no
 * colour vision at all (§4).
 */
export function speakSetRow(set: SessionReviewSet, unit: WeightUnit): string {
  const name = set.isWarmup ? SET_FLAG_COPY.warmupSetLabel : `Set ${String(set.setNumber)}`;

  const load: string[] = [set.weightKg === null ? BODYWEIGHT : speakWeight(set.weightKg, unit)];
  if (set.reps !== null) load.push(`${String(set.reps)} ${set.reps === 1 ? 'rep' : 'reps'}`);
  if (set.durationSeconds !== null) {
    load.push(`${String(set.durationSeconds)} ${set.durationSeconds === 1 ? 'second' : 'seconds'}`);
  }
  if (set.distanceM !== null) load.push(`${String(set.distanceM)} metres`);

  const sentences = [`${name}.`, `${load.join(', ')}.`];

  if (set.rpe !== null) {
    sentences.push(`RPE ${String(set.rpe)}.`);
  } else if (set.rir !== null) {
    // Spelled out: a screen reader reads "RIR" as three letters, and the
    // glossary's own words are what a coach would say (`CLAUDE.md` §26).
    sentences.push(`${String(set.rir)} ${set.rir === 1 ? 'rep' : 'reps'} in reserve.`);
  }

  if (set.isFailure) sentences.push(SET_FLAG_COPY.failureTagSpoken);

  // Last, so the fact a screen reader hears most recently is the one the
  // triangle is showing.
  const more = set.personalRecordTypes.length - 1;
  if (set.personalRecordTypes.length > 0) {
    sentences.push(more > 0 ? `${PR_COPY.title}, and ${String(more)} more.` : `${PR_COPY.title}.`);
  }

  return sentences.join(' ');
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // `minHeight`, never `height` — 56 at the default scale, ~64 at 200%,
    // and nothing clips either way.
    minHeight: SESSION_SET_ROW_MIN_HEIGHT,
    paddingVertical: spacing(12),
    paddingHorizontal: spacing(13),
    gap: spacing(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  number: {
    width: 18,
  },
  gap: {
    flex: 1,
    minWidth: spacing(8),
  },
  failure: {
    minWidth: 20,
    minHeight: 18,
    paddingHorizontal: spacing(4),
    borderRadius: radius.cell,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(9),
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  slot: {
    width: SESSION_COMMENT_SLOT_SIZE,
    height: SESSION_COMMENT_SLOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: SESSION_COMMENT_SLOT_SIZE,
    height: SESSION_COMMENT_SLOT_SIZE,
    borderRadius: SESSION_COMMENT_SLOT_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

/**
 * **The record's ink, resolved per scheme — and the one screen-local
 * substitution this screen makes (UNFORGET A11).**
 *
 * `brand` is scheme-invariant in `tokens.ts`, and `#FFA586` measures ~1.9:1
 * on a white card. So under light the record walks `DESIGN.md` §1.1's warm
 * ramp DOWN — `brand.deep` for the stroke, `fg.warm` for the numerals —
 * rather than `tokens.ts` growing a light `brand`, which would change every
 * other surface in the product. A screen-local resolution, declared here,
 * never a token change.
 *
 * `colors.deep` is already scheme-dependent (#541A2E dark, #7A2C42 light),
 * so only its alpha differs: a 30% maroon wash reads on a dark card and
 * would be a bruise on a white one.
 */
const useSetRowInk = createThemedValue(({ scheme, colors }) => {
  const light = scheme === 'light';
  return {
    text: colors.fg.DEFAULT,
    warm: colors.fg.warm,
    muted: colors.fg.muted,
    divider: colors.border.soft,
    record: light ? colors.fg.warm : colors.brand.DEFAULT,
    recordFill: withAlpha(colors.deep, light ? '0.09' : '0.30'),
    recordEdge: withAlpha(
      light ? colors.brand.deep : colors.brand.DEFAULT,
      light ? '0.48' : '0.28',
    ),
    moreFill: withAlpha(colors.deep, light ? '0.10' : '0.55'),
    failureEdge: light ? colors.brand.deep : colors.brand.shade,
    failureInk: light ? colors.brand.deep : colors.fg.warm,
    // The design's L1 well: translucent over the card on dark, opaque on
    // light, where a 50% inset would disappear into the white gradient.
    discFill: withAlpha(colors.bg.inset, light ? '1' : '0.5'),
    discEdge: colors.border.strong,
    discGlyph: colors.fg.subtle,
  };
});
