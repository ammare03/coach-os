import { Metric, Pressable, Text, useTextScale } from '@coachos/ui';
import { createThemedStyles, radius, spacing, tapTarget, withAlpha } from '@coachos/ui/theme';
import { PixelRatio, StyleSheet, View } from 'react-native';

// `phase-09-workout-logger/session-summary/03` — the 1–10 exertion picker.
// Design: `rpe-and-notes.html` in the P09 session-summary project, frames A
// and C.
//
// Five decisions, in the order they matter:
//
// (a) **Not a `SegmentedControl`.** Task 03 step 3 offers it or a row of
//     tappable numbers; the first is not available. `SegmentedControl` caps
//     its options at four IN ITS OWN TYPE (`ui-primitives-core/05`'s "more
//     than four options is a type error"), and ten segments across the 353px
//     between the client gutters would be a 30px target anyway — under §13's
//     44px floor before anyone touches the text-size setting. Five across and
//     two down clears 44 on both axes and 52 on the vertical.
//
// (b) **No new control type either.** The cells are `Pressable` with the
//     product's own press scale and `Metric` for the numeral, so the
//     tabular figures and the press treatment are the ones every other
//     surface uses rather than a second opinion about them.
//
// (c) **Tapping the chosen number clears it.** The field is optional, so
//     unsaying has to cost exactly what saying cost — and without this a
//     mis-tap is permanent, which is the one thing `ui-conventions` §5's
//     undo-not-confirm rule exists to prevent. There is no separate "clear"
//     control to find.
//
// (d) **Selection carries a fill, not only a hue.** Maroon under a warm
//     edge with brighter ink — desaturate the screen and the chosen cell is
//     still the only light rectangle in the grid (§8, `accessibility` §4).
//     The same pairing `SkipExerciseSheet` gives its chosen reason, so the
//     client meets one vocabulary for "you picked this".
//
// (e) **The grid reflows at large text rather than shrinking.** A percentage
//     flex basis alone would keep five per row and clip the numeral, because
//     React Native breaks flex lines on the basis and not on the content.
//     Two columns past 1.5× is the explicit rule (`accessibility` §3's
//     "reflow to one column past a threshold"), and the scale still reads in
//     order.

/** §26's RPE, in the client's own words rather than the coach's. */
export const EXERTION_COPY = {
  /** Never "RPE" on this side of the product (`product-copy` §4). */
  question: 'How hard was that?',
  /** States the scale. It does not suggest where on it the client ought to be. */
  hint: '1 is easy, 10 is everything you had. Optional.',
  groupLabel: 'How hard was that, 1 to 10',
  /** What one cell says to a screen reader. */
  option: (value: number, max: number) => `Effort ${String(value)} out of ${String(max)}`,
} as const;

/** DB§5.2's `perceived_exertion`, and `updateSessionNotesInput`'s bound. */
const EXERTION_MIN = 1;
const EXERTION_MAX = 10;
const EXERTION_VALUES = Array.from(
  { length: EXERTION_MAX - EXERTION_MIN + 1 },
  (_unused, index) => EXERTION_MIN + index,
);

const COLUMNS_DEFAULT = 5;
const COLUMNS_LARGE_TEXT = 2;
/** Past this, five cells across stop holding their numeral — decision (e). */
const LARGE_TEXT_SCALE = 1.5;
/** Leaves room for the gaps: five at 18% plus four 8px gaps fits 353px, six does not. */
const BASIS_PERCENT: Record<number, `${number}%`> = {
  [COLUMNS_DEFAULT]: '18%',
  [COLUMNS_LARGE_TEXT]: '47%',
};

export interface PerceivedExertionPickerProps {
  /** 1–10, or `null` for unanswered — which is an ordinary, final state. */
  value: number | null;
  /** Called with `null` when the chosen number is tapped again — decision (c). */
  onChange: (value: number | null) => void;
}

export function PerceivedExertionPicker({ value, onChange }: PerceivedExertionPickerProps) {
  const themed = useThemedStyles();
  // The OS setting and the gallery harness's own scale, multiplied: the
  // second is how `component-gallery/02` verifies 200% without a device
  // setting, and a rule that read only one of them would be right in one
  // place and wrong in the other.
  const scale = useTextScale() * PixelRatio.getFontScale();
  const columns = scale >= LARGE_TEXT_SCALE ? COLUMNS_LARGE_TEXT : COLUMNS_DEFAULT;

  return (
    <View style={styles.block}>
      <Text size="title">{EXERTION_COPY.question}</Text>
      <Text size="body-sm" tone="subtle">
        {EXERTION_COPY.hint}
      </Text>

      <View
        style={styles.grid}
        accessibilityRole="radiogroup"
        accessibilityLabel={EXERTION_COPY.groupLabel}
        testID="exertion-picker"
      >
        {EXERTION_VALUES.map((candidate) => {
          const isSelected = candidate === value;
          return (
            <Pressable
              key={candidate}
              onPress={() => {
                onChange(isSelected ? null : candidate);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={EXERTION_COPY.option(candidate, EXERTION_MAX)}
              containerStyle={[styles.cellOuter, { flexBasis: BASIS_PERCENT[columns] }]}
              style={[styles.cell, themed.cell, isSelected && themed.cellSelected]}
              testID={`exertion-${String(candidate)}`}
            >
              {/* The numeral goes through `Metric`, never `Text` — tabular
                  figures, so a 1 and a 10 sit on the same grid (§1.2). The
                  `Pressable` above is what names the cell for a screen
                  reader; this is just the glyph. */}
              <Metric value={candidate} size="label" tone={isSelected ? 'bright' : 'muted'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing(6),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(8),
    marginTop: spacing(4),
  },
  cellOuter: {
    flexGrow: 1,
  },
  cell: {
    // `minHeight`, never `height`: §13's floor is a floor, and the numeral
    // grows past it at 200% text rather than clipping.
    minHeight: tapTarget.MID_SET,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(4),
  },
});

const useThemedStyles = createThemedStyles(({ colors, control }) => ({
  cell: {
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
  cellSelected: {
    // Decision (d) — the same maroon-under-a-dimmed-brand-edge pairing
    // `SkipExerciseSheet` uses for its chosen reason.
    backgroundColor: withAlpha(colors.deep, '0.42'),
    borderColor: colors.brand.shade,
  },
}));
