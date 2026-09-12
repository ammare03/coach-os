import { Input, Sheet, SheetFooter, SheetHeader, Text } from '@coachos/ui';
import { spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

import type { CommentTargetType } from './CommentAffordance.tsx';

// `session-review/02` — the sheet §8.3's "comment can be created from any
// row without leaving the screen" opens, standing in for the real composer
// until `phase-12-feedback-comments` ships.
//
// ─────────────────────────────────────────────────────────────────────────
// THE ONE FAILURE MODE THIS FILE EXISTS TO PREVENT
// ─────────────────────────────────────────────────────────────────────────
// The P10 README names it, and `ClientChatComposer` was built against the
// same one: a composer that accepts text and silently drops it is WORSE
// than no composer at all, because it reads as a bug rather than as an
// unshipped feature. A coach who types two paragraphs of feedback on a
// squat and watches them vanish has lost work and trust.
//
// So the field is not merely styled as disabled — it cannot take input at
// any level:
//
//   1. `Input state="disabled"` sets `editable={false}` on the underlying
//      `TextInput`, so the platform never routes a keystroke here and the
//      keyboard never opens.
//   2. `value` is a frozen empty string with no state behind it. There is
//      no setter to call and nowhere for text to land.
//   3. `onChangeText` is `DROP_NOTHING`, which asserts rather than shrugs:
//      it is unreachable behind (1), and if a future edit makes it
//      reachable, the suite fails loudly instead of the app quietly eating
//      a coach's feedback.
//   4. The commit is disabled, so `Button` hands `Pressable` no `onPress`
//      at all — `POST_NOTHING` is as unreachable as (3) and asserts for the
//      same reason.
//
// ─────────────────────────────────────────────────────────────────────────
// AND WHY IT IS A FULL SHEET RATHER THAN A DIMMED ONE
// ─────────────────────────────────────────────────────────────────────────
// "Inert, not broken" is the phase README's requirement, so the sheet is
// the real anatomy at the real measurements — grabber, header with the
// row's context, field, the honest line, footer — and only the two controls
// are dead. A half-drawn sheet would read as a failed load, which is the
// same misreading in a different costume.
//
// **No glass inside glass** (`DESIGN.md` §4). The sheet is the tier-2 pane;
// the field inside it is the plain L1 well `Input` already draws and the
// commit is the flat disabled fill. Nothing in the body gets its own blur.

/**
 * Every word this sheet says, and the only place it says them.
 *
 * Exported because the affordance's hint quotes {@link honest}: the
 * inertness has to reach a screen reader BEFORE the tap, and one sentence
 * with two homes is already wrong in one of them (`code-conventions` §1).
 */
export const INERT_COMMENT_COPY = {
  /**
   * One word. `SheetHeader` pins `numberOfLines={1}` — "Comment on this
   * set" fits at 100% text and truncates at 200%.
   */
  title: 'Comment',
  /**
   * `Barbell back squat · Set 3 · 65 kg × 8`. Three facts, wrapping to two
   * lines at 200%. `load` arrives already formatted in the reader's unit,
   * so no string here hardcodes a "kg" (`CLAUDE.md` §0).
   */
  context: (exerciseName: string, setLabel: string, load: string) =>
    `${exerciseName} · ${setLabel} · ${load}`,
  /**
   * The grammatical sibling of the shipped "Messaging isn't available yet".
   * Deliberately redundant with {@link honest} — it renders in `fg.subtle`
   * and must never be the only carrier of the fact.
   */
  placeholder: "Comments aren't available yet",
  /** The spoken name of a field whose visible label is its placeholder. */
  fieldLabel: 'Comment',
  /**
   * Read out after the field's label, so the reason arrives with the
   * control rather than as a separate line further down the reading order.
   *
   * "Disabled." rather than the disc's "Opens a comment sheet.": the reader
   * is already INSIDE the sheet by the time they reach this, and a hint
   * that describes a tap they have already made is a lie to a screen reader
   * (`accessibility` §2). Same construction as `ClientChatComposer`'s.
   */
  fieldHint: "Disabled. This version of CoachOS can't post comments.",
  /**
   * `DESIGN.md` §10.8 — action labels count. "Done" or "Post" is a defect,
   * not a style preference. `SheetFooter` defaults `isActionDisabled` to
   * `true`, so the safe state is the one you get by forgetting.
   */
  action: 'Add comment',
  /**
   * States a fact and stops. No date, no "coming soon", no apology, no
   * exclamation mark — a promise about a future release is a promise the
   * product cannot keep on a schedule (`product-copy` §2, §5). The exact
   * shape already shipped on the Chat tab, so a coach who has met one
   * recognises the other as unshipped rather than broken.
   */
  honest: "This version of CoachOS can't post comments.",
} as const;

/**
 * Unreachable by construction (see (3) above). It exists because `Input` is
 * a controlled component whose `onChangeText` is required — not because
 * anything may call it.
 */
function DROP_NOTHING(): never {
  throw new Error(
    'InertCommentSheet is disabled and must never receive input. ' +
      'phase-12-feedback-comments replaces this component; it does not re-enable it.',
  );
}

/** Unreachable by construction (see (4) above), and asserts for the same reason. */
function POST_NOTHING(): never {
  throw new Error(
    'InertCommentSheet cannot post a comment. ' +
      'phase-12-feedback-comments replaces this component; it does not re-enable it.',
  );
}

/**
 * **The contract `phase-12-feedback-comments/comment-composer/` implements.**
 *
 * Its `CommentComposer` accepts exactly this and nothing else, so the swap
 * is one line inside `CommentAffordance` — `<InertCommentSheet />` becomes
 * `<CommentComposer />`, same props, same trigger, same placement.
 *
 * `targetType` and `targetId` are carried and deliberately unused here:
 * there is nowhere to post them yet, and a sheet that took them only once
 * it needed them would make that swap a signature change instead.
 */
export interface CommentSheetProps {
  isOpen: boolean;
  /** Closes the sheet and only the sheet — never the screen behind it. */
  onDismiss: () => void;
  /** Matches the `comment_target` pgEnum exactly (`DATABASE.md` DB§4). */
  targetType: CommentTargetType;
  /** The row's own id — `set_logs.id` for a set row. */
  targetId: string;
  /** Display only: the movement the row belongs to. */
  exerciseName: string;
  /** Display only: `Set 3` · `Warm-up set`. */
  setLabel: string;
  /** Display only, and **already formatted by `packages/utils`** — never a raw kilogram. */
  load: string;
  testID?: string;
}

export function InertCommentSheet({
  isOpen,
  onDismiss,
  exerciseName,
  setLabel,
  load,
  testID,
}: CommentSheetProps) {
  return (
    <Sheet
      isOpen={isOpen}
      onDismiss={onDismiss}
      snap="auto"
      testID={testID ?? 'inert-comment-sheet'}
    >
      {/* Title, then the row, then Close — the reading order the sheet is
          drawn in. `Sheet` sets `accessibilityViewIsModal`, so the screen
          behind it leaves the reading order entirely. */}
      <SheetHeader
        title={INERT_COMMENT_COPY.title}
        subtitle={INERT_COMMENT_COPY.context(exerciseName, setLabel, load)}
        onClose={onDismiss}
        density="coach"
      />

      <View style={styles.body}>
        <Input
          value=""
          onChangeText={DROP_NOTHING}
          state="disabled"
          density="coach"
          placeholder={INERT_COMMENT_COPY.placeholder}
          accessibilityLabel={INERT_COMMENT_COPY.fieldLabel}
          accessibilityHint={INERT_COMMENT_COPY.fieldHint}
          testID="inert-comment-input"
        />

        {/* `warm-muted`, not `subtle`: this sits on the sheet's tier-2
            glass, whose text steps up to the glass ramp (`DESIGN.md` §4),
            and it is the line carrying the whole reason — at 7.6:1 it is
            the one thing on this sheet nothing rests on the dimmed pixels
            of. No `numberOfLines`: at 200% text it wraps and the sheet
            grows with it (`accessibility` §3). */}
        <Text size="body-sm" tone="warm-muted">
          {INERT_COMMENT_COPY.honest}
        </Text>
      </View>

      <SheetFooter
        actionLabel={INERT_COMMENT_COPY.action}
        onAction={POST_NOTHING}
        isActionDisabled
        density="coach"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing(14),
    paddingTop: spacing(4),
    paddingBottom: spacing(16),
    gap: spacing(10),
  },
});
