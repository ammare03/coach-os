import { Text, createThemedStyles, spacing } from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

// One message in §8.8's coach↔client thread.
//
// **Built here rather than in `packages/ui`, deliberately.** `packages/ui`
// ships no message-bubble primitive — `DESIGN.md` §9 specifies one, but
// nothing has needed it yet, and `code-conventions` §1's promote-on-the-
// second-consumer rule says a component with one consumer lives with that
// consumer. `phase-14-messaging-and-realtime/conversations/03` builds the
// real `MessageThread`/`MessageBubble`, and IT is the second consumer that
// earns the promotion. Adding it to `packages/ui` now would put a
// half-specified primitive in the shared package for a phase that has not
// decided what it needs.
//
// **Why not `Card`.** `Card` hardcodes `radius.card` on all four corners,
// and the one thing that makes a bubble a bubble is the asymmetric tail
// corner. So the surface is composed here from the same `elevation` recipe
// `Card` reads, never from invented values.

export interface ClientChatMessage {
  messageId: string;
  /** Who wrote it, from the viewer's side: `coach` is the signed-in coach. */
  authorRole: 'coach' | 'client';
  body: string;
  /** A real instant (`messages.created_at` is `timestamptz`), rendered in the viewer's zone. */
  sentAt: Date;
}

export interface ClientChatBubbleProps {
  message: ClientChatMessage;
  /** Whose name a screen reader announces for a client-authored message. */
  clientName: string;
  /** The viewer's stored zone — resolved once by the screen, never per row (`CLAUDE.md` §25.5). */
  timeZone: string;
  testID?: string;
}

// `DESIGN.md` §9's message-bubble row, verbatim: "Max 270–276px, radius
// 18px with a 5px tail corner." None of the three is on the `radius` or
// `spacing` ladders, because neither ladder has a bubble entry — these are
// that row's literals, named here so a second bubble cannot pick different
// ones.
const BUBBLE_MAX_WIDTH = 276;
const BUBBLE_RADIUS = 18;
const BUBBLE_TAIL_RADIUS = 5;

/**
 * `memo`'d because a thread is a long list and the screen hands every row
 * the same three props; without it a re-render for any reason re-renders
 * every bubble on screen (`frontend-performance` §3).
 */
export const ClientChatBubble = memo(function ClientChatBubble({
  message,
  clientName,
  timeZone,
  testID,
}: ClientChatBubbleProps) {
  const themed = useThemedStyles();
  const isMine = message.authorRole === 'coach';
  const time = formatLocalDate(message.sentAt, timeZone, 'HH:mm');

  return (
    <View style={isMine ? styles.rowMine : styles.rowTheirs}>
      {/* One accessible element, one sentence. Five fragments per message
          is what a thread sounds like when the bubble, the body and the
          timestamp are each their own node (`accessibility` §2). The role
          is named in words because alignment and colour — the two things
          that carry it visually — are both invisible to a screen reader,
          and §8 forbids meaning in colour alone either way. */}
      <View
        accessible
        accessibilityLabel={`${isMine ? 'From you' : `From ${clientName}`}, ${time}. ${message.body}`}
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
          isMine ? themed.surfaceMine : themed.surfaceTheirs,
        ]}
        testID={testID ?? `chat-bubble-${message.messageId}`}
      >
        <Text size="body" style={isMine ? themed.inkMine : undefined}>
          {message.body}
        </Text>

        {/* An absolute clock time, never "2 minutes ago". A relative label
            is wrong the moment the screen is left open, and this one has a
            real instant behind it (`product-copy` §6). */}
        <Text size="micro" tone={isMine ? 'warm-muted' : 'subtle'} style={styles.time}>
          {time}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rowMine: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowTheirs: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    paddingVertical: spacing(12),
    paddingHorizontal: spacing(14),
    borderWidth: 1,
  },
  bubbleMine: {
    borderTopLeftRadius: BUBBLE_RADIUS,
    borderTopRightRadius: BUBBLE_RADIUS,
    borderBottomRightRadius: BUBBLE_TAIL_RADIUS,
    borderBottomLeftRadius: BUBBLE_RADIUS,
  },
  bubbleTheirs: {
    borderTopLeftRadius: BUBBLE_RADIUS,
    borderTopRightRadius: BUBBLE_RADIUS,
    borderBottomRightRadius: BUBBLE_RADIUS,
    borderBottomLeftRadius: BUBBLE_TAIL_RADIUS,
  },
  time: { marginTop: spacing(5) },
});

/**
 * ⚠️ **A deliberate, measured departure from `DESIGN.md` §9, flagged for
 * design review rather than made silently.**
 *
 * §9 draws the coach's own bubble as `linear-gradient(#E0855F, #B96341)`
 * with **white** text. White on those two stops measures **2.7:1** and
 * **4.3:1** — both under the 4.5:1 body-text floor `accessibility` §1 and
 * `CLAUDE.md` §23's definition of done require, and §1.1's own palette note
 * already calls white-on-warm-fill forbidden for exactly this reason.
 *
 * So the fill here is `colors.deep` — §1.1's maroon, the same family one
 * stop further down — with `colors['on-deep']`, the token whose documented
 * purpose is "labels on maroon". That pairing measures **9.9:1**, and the
 * bubble still reads unmistakably warm-and-mine against the cool L2 card
 * opposite it. The border keeps §9's `brand.deep` so the shape is unchanged.
 *
 * If the gradient is wanted back, the change belongs in `DESIGN.md` §9 with
 * an ink that clears 4.5:1 — not in this file.
 */
const useThemedStyles = createThemedStyles((t) => ({
  surfaceMine: { backgroundColor: t.colors.deep, borderColor: t.colors.brand.deep },
  surfaceTheirs: {
    backgroundColor: t.colors.bg.raised,
    borderColor: t.colors.border.DEFAULT,
  },
  inkMine: { color: t.colors['on-deep'] },
}));
