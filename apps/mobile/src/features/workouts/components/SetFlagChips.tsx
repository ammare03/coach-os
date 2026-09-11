import { Chip } from '@coachos/ui';
import { spacing } from '@coachos/ui/theme';
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// `set-entry/04` — `is_warmup` and `is_failure`, in the two places the design
// puts them: two chips on the right of the composer's head band, and a single
// tag in the trailing slot of a set already logged.
//
// ==================== WHAT THIS MAY NOT COST =========================
//
// **A working set with neither flag is still exactly two taps** (§8.4). Both
// default `false`, both are secondary, and neither sits between the steppers
// and the confirm. They add no band: they occupy the head band's existing
// trailing seam, which is why the card stays at 205px (`SetEntryRow`'s
// header).
//
// **The head label goes when warm-up comes on.** The two chips take ~191px
// of the card's 270, leaving ~71 for the label: `Set 3` fits in ~42,
// `Warm-up set` needs ~86 and would wrap the head to a second line, adding
// 39px to a card whose whole value is that it never changes height. So the
// selected chip IS the label — and a warm-up has no set number to show in
// the first place, since set 1 is the first *working* set. `SetEntryRow`
// owns that branch; this file owns the words it uses.
//
// ===================== "to failure" IS A WORD =========================
//
// It renders as a plain unselected `Chip` — `control.surface`,
// `border.strong`, `fg.muted` — and **never `urgent`**. `DESIGN.md` §8
// reserves red for missed, overdue and destructive; a client who took a set
// to failure did the thing their coach asked, and colouring it like a
// failure state would be the product passing judgement on them (§10.1,
// `COPY.md` §CO2). It also stays clear of `brand`-on-`deep`, which is the PR
// pairing — a record badge lands on this row later and the two must never be
// confusable.
//
// **A warm-up is de-emphasised on three channels, none of them hue** — the
// `W` glyph instead of a numeral, the load in `fg.muted`, and a `fg.muted`
// tick. That lives in `SetRow`; it is written down here because it is the
// same rule, and because desaturating the design's frame J is the check all
// three exist to pass.

/**
 * Every word these controls say, and the only place they say them — the same
 * shape as `SET_ENTRY_COPY` and `PREVIOUS_SET_COPY`, so the composer and the
 * row it produces can never word one flag two ways.
 */
export const SET_FLAG_COPY = {
  /** Sentence case on a control (`product-copy` §6). */
  warmupChip: 'Warm-up',
  failureChip: 'To failure',
  /** Lower case on a logged row: it is a tag, not a control. */
  failureTag: 'to failure',
  /**
   * A warm-up has no set number, so the row says what it is instead of
   * claiming one. Also what identifies a warm-up composer, whose visible
   * head label is omitted.
   */
  warmupSetLabel: 'Warm-up set',
  /** The number cell's glyph. A letter, never a numeral — see `SetRow`. */
  warmupGlyph: 'W',
  /**
   * The failure chip's spoken name. `To failure` alone is a fragment out of
   * context, and `failureTagSpoken` below ends a sentence — a control's name
   * does not. `warmupSetLabel` serves the warm-up chip unchanged.
   */
  failureChipSpoken: 'Taken to failure',
  /**
   * Merged into the logged row's single accessible label
   * (`SetRow.trailingLabel`) rather than spoken by the tag itself — the row
   * is one element and a tag beside every set would be a second focus stop
   * between the client and the confirm (`accessibility` §2).
   */
  failureTagSpoken: 'Taken to failure.',
} as const;

/** The two flags, from whatever holds them — a draft, or a row already logged. */
export interface SetFlagState {
  isWarmup: boolean;
  /**
   * Optional only because `SetEntrySlot` seeds rows from a read that predates
   * the column; absent means `false`, exactly as the mirror's default does.
   */
  isFailure?: boolean | undefined;
}

export interface SetFlagChipsProps extends SetFlagState {
  onWarmupChange: (next: boolean) => void;
  onFailureChange: (next: boolean) => void;
  testID?: string;
}

/**
 * The composer's pair of toggles.
 *
 * `Chip`'s own interactive branch, unchanged: `accessibilityRole="button"`
 * with `accessibilityState.selected` and a 44pt target bought with symmetric
 * `hitSlop`. **Not a `switch` role** — the design says so explicitly, and it
 * is right: these are two independent pills from an open set, announced and
 * operated the way every other chip in the product is, and inventing a
 * second contract for them would make one chip behave unlike the rest.
 *
 * **No haptic.** Only three triggers exist (`ui-conventions` §5) and a chip
 * toggle is not one of them.
 */
export function SetFlagChips({
  isWarmup,
  isFailure = false,
  onWarmupChange,
  onFailureChange,
  testID,
}: SetFlagChipsProps) {
  const handleWarmup = useCallback(() => {
    onWarmupChange(!isWarmup);
  }, [isWarmup, onWarmupChange]);

  const handleFailure = useCallback(() => {
    onFailureChange(!isFailure);
  }, [isFailure, onFailureChange]);

  return (
    // Wraps rather than squashing: at 200% text a chip is 66px tall and the
    // two stop fitting side by side in 270px (`accessibility` §3). The head
    // band is `minHeight`, so a wrapped second line grows the card instead of
    // clipping either chip.
    <View style={styles.chips} testID={testID}>
      {/* The pills print an abbreviation the head band has room for; the
          spoken names are the whole thing (`accessibility` §2). */}
      <Chip
        label={SET_FLAG_COPY.warmupChip}
        accessibilityLabel={SET_FLAG_COPY.warmupSetLabel}
        selected={isWarmup}
        onPress={handleWarmup}
        testID="set-flag-warmup"
      />
      <Chip
        label={SET_FLAG_COPY.failureChip}
        accessibilityLabel={SET_FLAG_COPY.failureChipSpoken}
        selected={isFailure}
        onPress={handleFailure}
        testID="set-flag-failure"
      />
    </View>
  );
}

export interface SetFlagTagProps {
  /** Explicitly `| undefined`: `renderSetTrailing` forwards an optional argument
   *  through it, and `exactOptionalPropertyTypes` refuses that otherwise. */
  testID?: string | undefined;
}

/**
 * `to failure` on a set already logged — `Chip`'s non-interactive tag branch,
 * which is a pill and not a line of text (design spec, the compact-row
 * anatomy).
 *
 * Hidden from the reading order on purpose. The tag branch marks itself
 * `accessible` with its own label, which inside `SetRow`'s single accessible
 * element would be a second stop on iOS and a duplicate utterance on
 * Android; the words reach a screen reader through `trailingLabel` instead,
 * spelled as a sentence.
 */
export function SetFlagTag({ testID }: SetFlagTagProps) {
  return (
    <View
      style={styles.tag}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Chip label={SET_FLAG_COPY.failureTag} />
    </View>
  );
}

/**
 * The logged row's **one** trailing occupant, resolved (design spec, "One
 * slot, two occupants"): a flag tag, else this set's previous performance,
 * else nothing. 270px will not carry two, and the flag is the rarer, more
 * informative fact.
 *
 * Lives here rather than in `SetRow` because the priority is a product rule,
 * not a layout one — and it is the same rule `speakSetTrailing` has to apply,
 * so the two can only stay in step by sitting side by side.
 *
 * **A warm-up shows no previous line either.** `last 80 × 8` beside a 40kg
 * warm-up is exactly the misleading comparison DB§22's `is_warmup = false`
 * filter exists to prevent, one row further down; and a warm-up occupies no
 * set number, so the per-set history it would look up is not its own.
 * Nothing is the absent state — no dash, no placeholder (`COPY.md` §CO2).
 */
export function renderSetTrailing(
  set: SetFlagState,
  previous: ReactNode,
  tagTestID?: string,
): ReactNode {
  if (set.isFailure === true) return <SetFlagTag testID={tagTestID} />;
  if (set.isWarmup) return null;
  return previous;
}

/** The same resolution, spoken — appended to the row's own label by `SetRow`. */
export function speakSetTrailing(
  set: SetFlagState,
  previousLabel: string | undefined,
): string | undefined {
  if (set.isFailure === true) return SET_FLAG_COPY.failureTagSpoken;
  if (set.isWarmup) return undefined;
  return previousLabel;
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing(6),
    rowGap: spacing(6),
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  tag: {
    flexShrink: 0,
  },
});
