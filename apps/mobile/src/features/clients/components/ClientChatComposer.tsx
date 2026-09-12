import { Input, Text, createThemedStyles, createThemedValue, radius, spacing } from '@coachos/ui';
import { ArrowRight } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

// §8.8's composer, present and **deliberately inert**.
//
// ─────────────────────────────────────────────────────────────────────────
// THE ONE FAILURE MODE THIS FILE EXISTS TO PREVENT
// ─────────────────────────────────────────────────────────────────────────
// The P10 README's Risks section names it: a composer that accepts text and
// silently drops it is WORSE than no composer at all, because it looks like
// a bug rather than an unshipped feature. A coach who types two paragraphs
// of feedback and watches them vanish has lost work and trust.
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
//      reachable, the test below fails loudly instead of the app quietly
//      eating a message.
//   4. The send control has **no `onPress` at all** — not a no-op handler.
//      A handler that does nothing is a handler a later edit fills in by
//      accident.
//
// ─────────────────────────────────────────────────────────────────────────
// AND WHY IT DOES NOT JUST LOOK DIMMED
// ─────────────────────────────────────────────────────────────────────────
// `DESIGN.md` §9's live composer is a Tier-1 glass pill with an attach
// control and a warm gradient send button. The disabled one drops every one
// of those affordances rather than reducing their opacity: a flat bar, no
// attach control, no gradient. Opacity alone is how "disabled" gets read as
// "loading", and a coach waiting for a composer to finish loading is the
// same lost minute in a different costume.

/**
 * Unreachable by construction (see (3) above). It exists because `Input` is
 * a controlled component and its `onChangeText` is required — not because
 * anything may call it.
 */
function DROP_NOTHING(): never {
  throw new Error(
    'ClientChatComposer is disabled and must never receive input. ' +
      'phase-14-messaging-and-realtime replaces this component; it does not re-enable it.',
  );
}

export interface ClientChatComposerProps {
  testID?: string;
}

export function ClientChatComposer({ testID }: ClientChatComposerProps) {
  const themed = useThemedStyles();
  const sendIconColor = useSendIconColor();

  return (
    <View style={styles.wrap} testID={testID ?? 'client-chat-composer'}>
      <View style={[styles.bar, themed.bar]}>
        <View style={styles.field}>
          <Input
            value=""
            onChangeText={DROP_NOTHING}
            state="disabled"
            density="coach"
            placeholder="Messaging isn't available yet"
            accessibilityLabel="Message composer"
            // Read out after the label, so the reason arrives with the
            // control rather than as a separate line further down the
            // reading order (`accessibility` §2).
            accessibilityHint="Disabled. This version of CoachOS can't send messages."
            testID="client-chat-composer-input"
          />
        </View>

        {/* Not an `IconButton`: that primitive is a `Pressable` with a
            button role, and a focusable button that cannot be pressed is a
            stop in the reading order that leads nowhere. This is a plain
            View, hidden from assistive tech — the field above already
            carries the whole state in words. */}
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.send, themed.send]}
          testID="client-chat-composer-send"
        >
          <ArrowRight size={18} color={sendIconColor} />
        </View>
      </View>

      {/* States a fact and stops. No date, no "coming soon", no apology —
          a promise about a future release is a promise the product cannot
          keep on a schedule (`product-copy` §2, §5). */}
      <Text size="body-sm" tone="subtle" style={styles.explain}>
        {"This version of CoachOS can't send messages."}
      </Text>
    </View>
  );
}

// 40px, matching `DESIGN.md` §9's live send control, so the bar keeps its
// geometry when `phase-14-messaging-and-realtime` swaps this for the real
// one. Nothing here is a tap target, so `tapTarget.MIN` does not apply.
const SEND_DIAMETER = 40;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing(14), paddingTop: spacing(10), paddingBottom: spacing(14) },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(9),
    padding: spacing(9),
    borderRadius: radius.full,
    borderWidth: 1,
  },
  field: { flex: 1, minWidth: 0 },
  send: {
    width: SEND_DIAMETER,
    height: SEND_DIAMETER,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explain: { marginTop: spacing(9), paddingHorizontal: spacing(6) },
});

const useThemedStyles = createThemedStyles((t) => ({
  bar: { backgroundColor: t.colors.bg.raised, borderColor: t.colors.border.soft },
  send: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.soft },
}));

// `fg.faint` — §1.1's disabled ink, and the one token whose contract says
// outright that it never carries meaning. Exactly right for an arrow that
// is scenery.
const useSendIconColor = createThemedValue((t) => t.colors.fg.faint);
