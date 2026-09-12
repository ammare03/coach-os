import { IconButton } from '@coachos/ui';
import { createThemedValue } from '@coachos/ui/theme';
import { MessageSquare } from 'lucide-react-native';
import { useCallback, useState } from 'react';

import { INERT_COMMENT_COPY, InertCommentSheet } from './InertCommentSheet.tsx';
import { SESSION_COMMENT_SLOT_HIT_SLOP } from './SessionSetRow.tsx';

// `session-review/02` — §8.3's "comment can be created from any row without
// leaving the screen (bottom sheet)", built now and wired to real comment
// creation once `phase-12-feedback-comments` ships.
//
// **A thin wrapper, on purpose.** Its only job once P12 lands is choosing
// which sheet content to render, so that phase's change is one line below —
// `<InertCommentSheet />` becomes `<CommentComposer />`, same props, same
// trigger, same placement. The icon, its position, and the prop contract
// never move. This component's interface is the one thing P12 builds
// against sight-unseen, eighteen tasks later; changing it then would ripple
// back through every row that renders one.
//
// **The disc occupies the cell `session-review/01` reserved** — 32×32, last
// in every row, warm-ups included. That task exported the geometry; this
// one re-derives none of it. `hitSlop` reaches 48 rather than growing the
// box, and 8px of slop stays inside the set card's `overflow: hidden` only
// because the row pads 13px in from it.

/**
 * The `comment_target` vocabulary, restated locally because **`apps/mobile`
 * never depends on `@coachos/db` at runtime** — the same rule
 * `pr-celebration.ts` follows for `PERSONAL_RECORD_TYPES`.
 *
 * Restated, and then PINNED: `CommentAffordance.test.tsx` asserts this
 * against `schema.commentTarget.enumValues` itself, so a seventh target
 * type added to the database fails a test here rather than a screen in P12.
 * Verbatim, never a subset — a target this surface happens not to use is
 * still part of the contract P12 accepts.
 */
export const COMMENT_TARGET_TYPES = [
  'workout_session',
  'set_log',
  'meal',
  'media_asset',
  'checkin',
  'program_day',
  'body_metric',
] as const;

export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

/** The design's measured glyph — `session-review/01`'s placeholder draws the same 14px. */
const COMMENT_GLYPH_SIZE = 14;

export const COMMENT_AFFORDANCE_COPY = {
  /**
   * `Comment on Barbell back squat, set 3` · `…, warm-up set`.
   *
   * The ACTION plus the row, never "comment icon" (`accessibility` §2). The
   * set label lowercases into the sentence — the sheet's context line, which
   * is a list of facts rather than a sentence, keeps its capital.
   */
  label: (exerciseName: string, setLabel: string) =>
    `Comment on ${exerciseName}, ${setLabel.charAt(0).toLowerCase()}${setLabel.slice(1)}`,
  /**
   * The inertness arrives BEFORE the tap. Without this, a screen-reader
   * user pays a tap, a full sheet read and a dismissal to learn what a
   * sighted user learns by reading one line — and pays it on every one of
   * 22 rows.
   */
  hint: `Opens a comment sheet. ${INERT_COMMENT_COPY.honest}`,
} as const;

export interface CommentAffordanceProps {
  /** Matches the `comment_target` pgEnum exactly — never a string, never a subset. */
  targetType: CommentTargetType;
  /** The row's own id. For a set row, `set_logs.id`. */
  targetId: string;
  /** Display only: the movement this row belongs to. Spoken, and the sheet's context. */
  exerciseName: string;
  /** Display only: `Set 3` · `Warm-up set`. A warm-up claims no set number. */
  setLabel: string;
  /**
   * Display only, and **already formatted by `packages/utils`** — the row
   * hands over a rendered `65 kg × 8`, never a raw kilogram. Conversion
   * happens at the edges and nowhere else (`CLAUDE.md` §0).
   */
  load: string;
  testID?: string;
}

export function CommentAffordance({
  targetType,
  targetId,
  exerciseName,
  setLabel,
  load,
  testID,
}: CommentAffordanceProps) {
  const glyph = useGlyphInk();
  // Local, because it is exactly one screen's UI state with no second
  // reader (`code-conventions` §5). `Sheet` returns `null` while closed, so
  // 72 affordances mount 72 booleans and at most one sheet.
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      <IconButton
        icon={<MessageSquare size={COMMENT_GLYPH_SIZE} color={glyph} strokeWidth={2} />}
        // `control.surface` under a 1px `control.border` — the same pair
        // `Button`'s secondary resolves, never a second treatment for one
        // disc.
        variant="secondary"
        size="sm"
        // 32 + 8 either side = 48, `ui-conventions` §5's floor. `sm`'s own
        // default reaches only `tapTarget.MIN`'s 44, and at 48 the slop
        // regions of adjacent rows exactly touch: below it a tap lands on
        // the wrong set, silently, because RN resolves overlapping slop by
        // z-order rather than by distance.
        hitSlop={SESSION_COMMENT_SLOT_HIT_SLOP}
        onPress={open}
        accessibilityLabel={COMMENT_AFFORDANCE_COPY.label(exerciseName, setLabel)}
        accessibilityHint={COMMENT_AFFORDANCE_COPY.hint}
        testID={testID ?? `comment-affordance-${targetId}`}
      />

      {/* P12 changes this element and nothing else around it. */}
      <InertCommentSheet
        isOpen={isOpen}
        onDismiss={dismiss}
        targetType={targetType}
        targetId={targetId}
        exerciseName={exerciseName}
        setLabel={setLabel}
        load={load}
      />
    </>
  );
}

/**
 * `brand.DEFAULT`, which measures 7.0:1 on the dark card gradient.
 *
 * It is ~1.9:1 on the light one against a 3:1 floor — a product-wide defect
 * recorded as UNFORGET A11, not this component's to resolve: the fix is a
 * light `brand` in `tokens.ts`, which would change every other surface in
 * the product. The disc is still readable there by SHAPE (`accessibility`
 * §4), and the row it sits on carries no meaning in its ink.
 */
const useGlyphInk = createThemedValue((t) => t.colors.brand.DEFAULT);
