import { Pressable, Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing, tapTarget, useTheme } from '@coachos/ui/theme';
import { router } from 'expo-router';
import { PenLine, Video, X } from 'lucide-react-native';
import { useState, type ComponentType } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { SessionNoteCapture } from './SessionNoteCapture.tsx';

// `phase-09-workout-logger/session-summary/02` — §8.4's "a prompt to add a
// form video or a note", on the screen that is the highest-intent moment in
// the product for either.
// Design: `post-session-prompt.html` in the P09 session-summary project.
//
// Six decisions, in the order they matter:
//
// (a) **It is an offer, never a gate.** Neither action opens itself, neither
//     is a modal or a sheet, and `SessionSummaryScreen`'s Done sits below
//     this in a foot that never reads its state. A client who wants to leave
//     the instant the screen paints taps Done and is gone, with the prompt
//     simply not acted upon (the task's second acceptance criterion).
//
// (b) **Two rows, not one combined action.** A client may want the note
//     without the video or the video without the note, and routing either
//     through the other adds friction to exactly the moment this exists to
//     catch. Each row is dismissible on its own, and dismissing costs
//     nothing and says nothing — no confirmation, no undo toast, no "you can
//     add one later".
//
// (c) **"Add a note" reveals ALL of `session-summary/03`'s capture, not half
//     of it.** The effort picker and the note field are one write behind one
//     Save (`useUpdateSessionNotes` decision (e) sends both fields every
//     time), so revealing only the field would either strand the picker
//     without a Save or split one write into two. The row's supporting line
//     says so in the client's own words, so the reveal is never a surprise.
//
// (d) **The reveal is one-way.** Once open the capture stays open and the
//     row does not come back. A collapse control would let a client hide an
//     effort value or a sentence they had already chosen, which is the one
//     outcome this prompt must not produce.
//
// (e) **The form-check link carries only context this screen actually
//     holds.** The session always; the exercise only when the session logged
//     exactly one, because that is the only case where "which exercise is
//     this a check of" has one answer. See {@link formCheckParams}.
//
// (f) **No haptic, and no analytics event.** `ui-conventions` §5 sanctions
//     four haptics and none of them is "a prompt was offered"; §20's event
//     for this area is `form_check_uploaded`, which belongs to the upload
//     P11 owns, not to the tap that opens the route.

/**
 * The route `CLAUDE.md` §9.1 committed to, registered as a modal in
 * `(client)/_layout.tsx` and today a P05 placeholder. `phase-11-media-pipeline`
 * builds the screen behind it; if that phase ever moves the path, this
 * constant is the one line that changes here.
 */
export const FORM_CHECK_ROUTE = '/(client)/record-form-check' as const;

/** Every word this prompt says, and the only place it says them (`product-copy` §6). */
export const PROMPT_COPY = {
  /** The screen's own eyebrow vocabulary — `Personal records`, `Changes`. Never "Before you go". */
  heading: 'Add to this session',
  formCheck: 'Add a form check',
  /** What happens next, stated as a fact. Never an instruction the client could have failed. */
  formCheckDetail: 'Your coach can watch a set and comment on it.',
  note: 'Add a note',
  /** Names both halves of what the row opens — decision (c). */
  noteDetail: 'How hard it was, and anything you want to say.',
  /** Icon-only controls are labelled with the action, and the action names its row. */
  dismissFormCheck: 'Dismiss add a form check',
  dismissNote: 'Dismiss add a note',
  /** The capture appears below with no focus move, which is silent otherwise (`accessibility` §2). */
  noteOpenedAnnouncement: 'Note open',
} as const;

const GLYPH_SIZE = 18;
const DISMISS_GLYPH_SIZE = 16;

/**
 * What `record-form-check` is opened with.
 *
 * `sessionId` is `local_workout_sessions.client_local_id`, the same name and
 * the same value the logger and summary routes already carry for it.
 *
 * `exerciseId` only when the session logged against exactly one exercise.
 * With six logged, this screen has no idea which one the client wants to
 * film, and a pre-filled wrong answer is worse than an unanswered question —
 * P11's capture can ask. **The exact contract is `phase-11-media-pipeline`'s
 * to confirm** when it builds the screen; both params are extra query values
 * the placeholder ignores until then.
 */
export function formCheckParams(
  sessionLocalId: string,
  exerciseIds: readonly string[],
): Record<string, string> {
  const onlyExerciseId = exerciseIds.length === 1 ? exerciseIds[0] : undefined;
  return onlyExerciseId === undefined
    ? { sessionId: sessionLocalId }
    : { sessionId: sessionLocalId, exerciseId: onlyExerciseId };
}

export interface PostSessionPromptProps {
  /** `local_workout_sessions.client_local_id` — the id the summary route carries. */
  sessionLocalId: string;
  /** `exercises.id` for every exercise this session logged against. Decision (e). */
  exerciseIds: readonly string[];
}

export function PostSessionPrompt({ sessionLocalId, exerciseIds }: PostSessionPromptProps) {
  const [isFormCheckDismissed, setIsFormCheckDismissed] = useState(false);
  const [isNoteDismissed, setIsNoteDismissed] = useState(false);
  const [isNoteOpen, setIsNoteOpen] = useState(false);

  const showsFormCheck = !isFormCheckDismissed;
  // Decision (d): opening the capture consumes the row, and neither the
  // reveal nor a dismissal can put it back.
  const showsNote = !isNoteDismissed && !isNoteOpen;
  const showsOffers = showsFormCheck || showsNote;

  if (!showsOffers && !isNoteOpen) return null;

  return (
    <View style={styles.block} testID="summary-prompt">
      {showsOffers ? (
        <View style={styles.section}>
          {/* Absent with the last row, never an empty heading — the rule
              `ModificationsSummary` follows at a count of zero. */}
          <Text size="eyebrow" tone="muted" accessibilityRole="header" style={styles.heading}>
            {PROMPT_COPY.heading}
          </Text>

          <View style={styles.offers}>
            {showsFormCheck ? (
              <Offer
                icon={Video}
                title={PROMPT_COPY.formCheck}
                detail={PROMPT_COPY.formCheckDetail}
                dismissLabel={PROMPT_COPY.dismissFormCheck}
                onPress={() => {
                  router.push({
                    pathname: FORM_CHECK_ROUTE,
                    params: formCheckParams(sessionLocalId, exerciseIds),
                  });
                }}
                onDismiss={() => {
                  setIsFormCheckDismissed(true);
                }}
                testID="summary-prompt-form-check"
              />
            ) : null}

            {showsNote ? (
              <Offer
                icon={PenLine}
                title={PROMPT_COPY.note}
                detail={PROMPT_COPY.noteDetail}
                dismissLabel={PROMPT_COPY.dismissNote}
                onPress={() => {
                  setIsNoteOpen(true);
                  AccessibilityInfo.announceForAccessibility(PROMPT_COPY.noteOpenedAnnouncement);
                }}
                onDismiss={() => {
                  setIsNoteDismissed(true);
                }}
                testID="summary-prompt-note"
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Inline, on this screen, in place of the row — the task's fourth
          acceptance criterion. No animation: the layout shift is the direct
          result of the tap that caused it, and an animated height would
          delay the field the client just asked for (`DESIGN.md` §5). */}
      {isNoteOpen ? <SessionNoteCapture sessionLocalId={sessionLocalId} /> : null}
    </View>
  );
}

/** `lucide-react-native`'s own prop shape, narrowed to what this file passes. */
type Glyph = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/**
 * One offer and its dismissal, as **two sibling controls inside one row** —
 * never a pressable nested in a pressable. A screen reader gets two items
 * with two labels rather than one control with two meanings, and a thumb
 * gets a dismiss column wide enough to hit deliberately and narrow enough
 * not to hit on the way to the offer.
 */
function Offer({
  icon: Icon,
  title,
  detail,
  dismissLabel,
  onPress,
  onDismiss,
  testID,
}: {
  icon: Glyph;
  title: string;
  detail: string;
  dismissLabel: string;
  onPress: () => void;
  onDismiss: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={[styles.offer, themed.offer]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        // The detail carries real information about what pressing this does,
        // which is the one case `AddSetButton` says a hint earns its place.
        accessibilityHint={detail}
        containerStyle={styles.goContainer}
        style={styles.go}
        testID={testID}
      >
        <Icon size={GLYPH_SIZE} color={theme.colors.fg.warm} strokeWidth={2} />
        <View style={styles.words}>
          {/* Both lines wrap rather than truncate — no `numberOfLines` and no
              fixed height anywhere in this file (`accessibility` §3). */}
          <Text size="body-lg">{title}</Text>
          <Text size="body-sm" tone="muted">
            {detail}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        containerStyle={styles.dismissContainer}
        style={styles.dismiss}
        testID={`${testID}-dismiss`}
      >
        <X size={DISMISS_GLYPH_SIZE} color={theme.colors.fg.faint} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/** `DESIGN.md` §1.3's client list row, as a floor the row grows past. */
const OFFER_MIN_HEIGHT = 60;

const styles = StyleSheet.create({
  block: {
    gap: spacing(20),
  },
  section: {
    gap: spacing(9),
  },
  heading: {
    textTransform: 'uppercase',
    paddingHorizontal: spacing(3),
  },
  offers: {
    gap: spacing(9),
  },
  offer: {
    // `minHeight`, never `height`: at 200% text the row grows rather than
    // clipping either of its two lines.
    minHeight: OFFER_MIN_HEIGHT,
    // Radius `card`, not `full`. These are rows; two fully-rounded pills this
    // tall would read as two primary actions competing with Done.
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  goContainer: {
    flex: 1,
    minWidth: 0,
  },
  go: {
    flex: 1,
    flexDirection: 'row',
    // Not `center`: a wrapped detail line would float the glyph into the
    // middle of the paragraph.
    alignItems: 'center',
    gap: spacing(12),
    paddingVertical: spacing(11),
    paddingLeft: spacing(14),
    paddingRight: spacing(4),
  },
  words: {
    flex: 1,
    minWidth: 0,
    gap: spacing(3),
  },
  dismissContainer: {
    width: tapTarget.MIN,
  },
  dismiss: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  offer: {
    // `DESIGN.md` §9's secondary control, read from the tokens rather than
    // rewritten as literals — the same surface the capture's Save wears. On
    // this screen, secondary means optional, and Done stays the one gradient.
    backgroundColor: theme.control.surface,
    borderColor: theme.control.border,
  },
}));
