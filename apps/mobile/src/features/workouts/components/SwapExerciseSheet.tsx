import { Pressable, Sheet, SheetHeader, Text, useTheme } from '@coachos/ui';
import { createThemedStyles, radius, spacing, tapTarget, withAlpha } from '@coachos/ui/theme';
import { ArrowLeftRight, Check } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { AlternativeExercise } from '../lib/alternatives.ts';

// `session-modifications/02` — the swap picker. Design: `swap-exercise.html`
// in the P09 design project, frames A, B and C.
//
// Six decisions, in the order they matter:
//
// (a) **There is no search field here, and there is no code path to one.**
//     The rows come from `lib/alternatives.ts`, whose whole contract is that
//     its only source is this block's `program_exercises.alternatives`. A
//     picker that could reach the library would let a client substitute a
//     movement their coach never sanctioned, which is what "coach-approved"
//     in §8.4 rules out and is task 02's named risk. This component takes a
//     list and renders it; it cannot go and get a different one.
//
// (b) **The empty case is a designed state, never a widened source.** If the
//     coach configured no alternatives, the sheet says so and points the
//     client back at them — it does NOT quietly offer a search "just this
//     once". {@link SwapExerciseSheetProps.onSkipInstead} hands off to task
//     03's skip, whose first reason is "Equipment unavailable", because that
//     is the one next step the client actually has and it reaches the coach
//     with the session notes.
//
// (c) **One tap commits, and there is no footer.** A swap captures no second
//     value the way a skip captures a reason, so a commit button would cost
//     every honest swap an extra tap on the surface where taps are most
//     expensive. What makes that safe is the revert below the list
//     (`ui-conventions` §5's undo-not-confirm), not a confirmation in front
//     of it.
//
// (d) **`radio` roles, not buttons.** The rows are one choice from a fixed
//     group and announce as such, so a screen-reader client hears the
//     position and which one is in force rather than three unrelated
//     buttons (`accessibility` §2). Same call `SkipExerciseSheet` made.
//
// (e) **The revert is not a fourth row.** It sits below a rule, as its own
//     control — which keeps the list literally equal to `alternatives`
//     (decision (a)) instead of quietly containing one exercise that is not
//     in it, and reads as "go back" rather than "pick this".
//
// (f) **Nothing here judges.** A client whose gym cannot equip an exercise
//     has done nothing wrong; the helper line states where the list came
//     from and that the numbers do not move, never what they should have
//     done (`COPY.md` §CO2, §CO3).

/**
 * Every word this sheet says, and the only place it says them — the same
 * shape `SKIP_SHEET_COPY` uses, so the sheet and anything that reads a swap
 * back can never word it two ways.
 */
export const SWAP_SHEET_COPY = {
  title: 'Swap this exercise',
  /** Two facts, in the order they matter: who approved these, and that the plan is unchanged. */
  helper: 'Your coach approved these. Your targets stay the same.',
  listLabel: 'Coach-approved swaps',
  /** The fact, not an apology (`COPY.md` §CO4.1). */
  emptyTitle: 'No approved swaps here',
  emptyBody:
    "Your coach hasn't set alternatives for this exercise. Message them if the equipment isn't available.",
  /** The one next step a client actually has when there is nothing to swap to. */
  emptyAction: 'Skip this exercise',
  /** Sentence case on a control, and it names what it goes back to. */
  revert: (originalName: string) => `Back to ${originalName}`,
  inEffect: 'Doing this one',
} as const;

const TICK = 18;
const EMPTY_MARK = 26;
/** Enough rows to scan without the sheet swallowing the screen behind it. */
const LIST_MAX_HEIGHT = 320;

export interface SwapExerciseSheetProps {
  isOpen: boolean;
  /** The name the page is showing, so the sheet names what is being swapped. */
  exerciseName: string;
  /** `lib/alternatives.ts`'s answer, in the coach's own order. Empty is a real state. */
  alternatives: readonly AlternativeExercise[];
  /** The substitute in force, or `null` when this slot is as programmed. */
  currentSubstituteId?: string | null;
  /** The coach's own exercise, named on the revert. `null` when nothing is swapped. */
  revertToName?: string | null;
  onDismiss: () => void;
  onSelect: (substitute: AlternativeExercise) => void;
  /** Puts the coach's own exercise back — decision (e). */
  onRevert?: (() => void) | undefined;
  /** Decision (b). Absent, the empty state states the fact and offers nothing. */
  onSkipInstead?: (() => void) | undefined;
}

export function SwapExerciseSheet({
  isOpen,
  exerciseName,
  alternatives,
  currentSubstituteId = null,
  revertToName = null,
  onDismiss,
  onSelect,
  onRevert,
  onSkipInstead,
}: SwapExerciseSheetProps) {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <Sheet isOpen={isOpen} onDismiss={onDismiss} snap="auto" testID="swap-exercise-sheet">
      <SheetHeader title={SWAP_SHEET_COPY.title} subtitle={exerciseName} onClose={onDismiss} />

      <View style={styles.body}>
        {alternatives.length === 0 ? (
          <View style={styles.empty} testID="swap-empty-state">
            {/* Decorative: the heading below states the same thing in words. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <ArrowLeftRight size={EMPTY_MARK} color={colors.fg.faint} strokeWidth={2} />
            </View>
            {/* `h2`, the heading size `EmptyState` itself uses — this state
                is that component's anatomy, rendered inside a sheet rather
                than on a page, because §9's contract requires exactly one
                primary action and the honest next step here is optional. */}
            <Text size="h2" accessibilityRole="header" style={styles.centred}>
              {SWAP_SHEET_COPY.emptyTitle}
            </Text>
            <Text size="body-lg" tone="muted" style={[styles.centred, styles.measure]}>
              {SWAP_SHEET_COPY.emptyBody}
            </Text>
            {onSkipInstead === undefined ? null : (
              <Pressable
                onPress={onSkipInstead}
                accessibilityRole="button"
                accessibilityLabel={SWAP_SHEET_COPY.emptyAction}
                style={[styles.secondary, themed.secondary]}
                testID="swap-empty-skip-action"
              >
                <Text size="body-lg" tone="warm">
                  {SWAP_SHEET_COPY.emptyAction}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            {/* Scrolls rather than growing without bound: a coach may approve
                several, and a sheet taller than the screen behind it is a
                route, not a sheet (`Sheet`'s own "never 100%"). */}
            <ScrollView
              style={styles.listViewport}
              contentContainerStyle={styles.list}
              accessibilityRole="radiogroup"
              accessibilityLabel={SWAP_SHEET_COPY.listLabel}
            >
              {alternatives.map((alternative) => {
                const isCurrent = alternative.id === currentSubstituteId;
                return (
                  <Pressable
                    key={alternative.id}
                    onPress={() => {
                      onSelect(alternative);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isCurrent }}
                    // Name first, then the muscle, then the state — one item
                    // rather than three fragments (`accessibility` §2).
                    accessibilityLabel={
                      isCurrent
                        ? `${alternative.name}, ${alternative.primaryMuscle}, ${SWAP_SHEET_COPY.inEffect}`
                        : `${alternative.name}, ${alternative.primaryMuscle}`
                    }
                    style={[styles.row, themed.row, isCurrent && themed.rowCurrent]}
                    testID={`swap-option-${alternative.id}`}
                  >
                    <View style={styles.words}>
                      {/* No `numberOfLines`: at 200% text the name wraps and
                          the row deepens (`accessibility` §3). */}
                      <Text size="body-lg" tone={isCurrent ? 'default' : 'muted'}>
                        {alternative.name}
                      </Text>
                      <Text size="body-sm" tone="subtle">
                        {alternative.primaryMuscle}
                      </Text>
                    </View>
                    {/* Drawn because §8 forbids meaning in hue alone — the
                        check is the shape channel beside the warm edge and
                        the tinted fill. The `checked` state is what carries
                        it to a screen reader, so this is hidden from it. */}
                    {isCurrent ? (
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        <Check size={TICK} color={colors.brand.DEFAULT} strokeWidth={3} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text size="body-sm" tone="subtle">
              {SWAP_SHEET_COPY.helper}
            </Text>

            {onRevert === undefined || revertToName === null ? null : (
              <View style={[styles.revertWell, themed.revertWell]}>
                <Pressable
                  onPress={onRevert}
                  accessibilityRole="button"
                  accessibilityLabel={SWAP_SHEET_COPY.revert(revertToName)}
                  style={[styles.secondary, themed.secondary]}
                  testID="swap-revert-action"
                >
                  <Text size="body-lg" tone="warm" style={styles.centred}>
                    {SWAP_SHEET_COPY.revert(revertToName)}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing(20),
    paddingTop: spacing(4),
    paddingBottom: spacing(20),
    gap: spacing(10),
  },
  listViewport: {
    // `maxHeight`, never `height`: one alternative renders one row tall.
    maxHeight: LIST_MAX_HEIGHT,
    flexGrow: 0,
  },
  list: {
    gap: spacing(8),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    // `minHeight`, never `height`: §13's mid-set floor is the floor, and at
    // 200% text the row grows past it rather than clipping its name.
    minHeight: tapTarget.MID_SET,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(11),
    borderRadius: radius.control,
    borderWidth: 1,
  },
  words: {
    flex: 1,
    minWidth: 0,
    gap: spacing(3),
  },
  empty: {
    alignItems: 'center',
    gap: spacing(8),
    paddingTop: spacing(20),
    paddingHorizontal: spacing(4),
  },
  centred: {
    textAlign: 'center',
  },
  // §9's explanation measure. A line longer than this reads as a paragraph.
  measure: {
    maxWidth: 270,
  },
  secondary: {
    marginTop: spacing(8),
    alignSelf: 'stretch',
    minHeight: tapTarget.MID_SET,
    paddingHorizontal: spacing(18),
    paddingVertical: spacing(12),
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revertWell: {
    borderTopWidth: 1,
    paddingTop: spacing(4),
  },
});

const useThemedStyles = createThemedStyles(({ colors, control }) => ({
  row: {
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
  rowCurrent: {
    // The maroon tint under a dimmed brand edge — the same pairing
    // `SkipExerciseSheet`'s selected reason and the pager's badge use, and
    // deliberately NOT the solid `deep`-under-`brand.DEFAULT` treatment §8
    // reserves for a record.
    backgroundColor: withAlpha(colors.deep, '0.3'),
    borderColor: colors.brand.shade,
  },
  secondary: {
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
  revertWell: {
    borderTopColor: colors.border.soft,
  },
}));
