import { Button, Text, resolveButtonVariantVisuals } from '@coachos/ui';
import { spacing, useTheme } from '@coachos/ui/theme';
import { AlertTriangle, Check } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

// `session-runtime/07` — the control that ends a session, and the surface a
// refused completion lands on (`finish-control.html`). Task 07 built
// `useCompleteSession` and the server transition and left both of these
// undesigned, because both are design decisions rather than wiring.
//
// **It lives in the shell's foot, not the header and not the page.**
//
// Not the header, because the header already holds `Pause`. The two mean
// opposite things — leave, it keeps running; end it permanently — and
// seating them within a thumb's width of each other, in the one bar a
// client reaches for without looking, is the mis-tap this layout exists to
// avoid. Opposite ends of the screen is the cheapest reliable separation
// there is.
//
// Not the page, because completion is session-scoped. `ExercisePager`'s
// pages come and go and an ad-hoc session has none at all — and that is the
// case that needs this control most, since there is no last exercise to
// arrive at.
//
// **Four channels apart from `Pause`**: position (glass header, top-left vs
// canvas, bottom-centre), shape (a pill sized to its word vs one alone on
// its own row), word ("Pause" vs "Finish workout" — the object is named,
// because "Finish" alone reads as Pause's twin), and icon (bars vs check).
// Both carry icon AND word (`DESIGN.md` §13).
//
// **Secondary, never primary.** §9's secondary recipe. The peach gradient
// on this screen belongs to `set-entry`'s "Log set", pressed forty times a
// session against this control's once; giving Finish the primary fill would
// make the loudest object on the screen the one that ends it. The
// brightness gap is also what keeps the two apart, since Log set is the
// bottom-most control INSIDE the L1 page and this is the bottom-most
// control outside it.
//
// **It does not confirm.** `ui-conventions` §5 prefers undo to confirm, and
// a dialog here is the reflex-dismissed kind that teaches nothing.
// Completion has somewhere better to land: it navigates to the summary, and
// a screen showing what the client actually did is a better confirmation
// than a question asked beforehand. It does not ask about a short session
// either — stopping at exercise three because the rack was taken is
// ordinary, and `DESIGN.md` §10.1 forbids the product forming a view about
// it.
//
// **The last exercise changes nothing here.** A control that brightened on
// the final page would be telling the client they SHOULD finish now, which
// is a judgement, and the pager's own rule is that nothing gates the move.
// It is also one fewer way for the control to shift under a thumb.

/** Every word this control says. Extracted for localisation (`product-copy` §6). */
export const FINISH_COPY = {
  action: 'Finish workout',
  /**
   * `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`, in the footer's voice: what
   * happened, then the thing the client actually fears, then what to do —
   * the same order and the same reassurance `LoggerLoadError` gives for the
   * same underlying fault. Never the code, never the raw error.
   */
  failed: 'Couldn’t finish this session. Your sets are saved — try again.',
} as const;

type FinishStatus = 'idle' | 'working' | 'failed';

const ICON_SIZE = 17;
const MESSAGE_ICON_SIZE = 15;

export interface SessionFinishProps {
  /**
   * Completes the session.
   *
   * **Rejects rather than resolving a union**, which is `useCompleteSession`'s
   * own contract: every outcome except an outright local-mirror failure is a
   * success, and that one failure is what `status: 'failed'` renders. A
   * swallowed rejection here is a client tapping Finish, seeing nothing
   * happen, and leaving the session open.
   */
  onFinish: () => Promise<void>;
}

export function SessionFinish({ onFinish }: SessionFinishProps) {
  const theme = useTheme();
  const [status, setStatus] = useState<FinishStatus>('idle');
  const isWorking = status === 'working';

  const handlePress = useCallback(() => {
    setStatus('working');
    void (async () => {
      try {
        await onFinish();
        // Deliberately never reset to 'idle'. A resolved completion is
        // navigating to the summary, and a control that became pressable
        // again on the way out is a second completion waiting to happen.
      } catch {
        // Handled, not swallowed (`code-conventions` §8) — the caught error
        // is rendered below. It is not reported to Sentry: nothing else in
        // this feature reports a local-mirror fault, and the client already
        // has the one thing they can act on.
        setStatus('failed');
      }
    })();
  }, [onFinish]);

  useEffect(() => {
    if (status !== 'failed') return;
    // A failure that only appears on screen is silent to a screen reader,
    // and this one arrives with the client's thumb already on the button
    // (`accessibility` §2, the same announce `ExercisePager` makes for a
    // page turn). Re-announces on a second failed attempt, because the
    // status passes back through 'working' between the two.
    AccessibilityInfo.announceForAccessibility(FINISH_COPY.failed);
  }, [status]);

  // Kept in step with the label in both states — `disabled` collapses every
  // variant to one treatment, so a hardcoded icon colour would stay bright
  // against a dimmed word.
  const iconColor = resolveButtonVariantVisuals('secondary', false, isWorking, theme).textColor;

  return (
    <View style={styles.foot}>
      {status === 'failed' ? (
        // In the footer, above the button the client just pressed, where
        // their thumb already is. NOT a toast — it dismisses itself, and it
        // renders over this exact control. NOT a full error state — the
        // session and every logged set are still on screen and still fine.
        // It persists until the next attempt, and the button below is the
        // retry, so there is no second button.
        //
        // One accessible item with the spelled-out words, so the triangle
        // is not read as a fragment of its own.
        <View
          style={styles.message}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={FINISH_COPY.failed}
          testID="logger-finish-error"
        >
          {/* Warm, never `urgent`. Red in this product means missed or
              overdue, and a refused tap is not an adherence signal
              (`DESIGN.md` §8). The glyph is the second channel, so the
              message never rests on hue alone. */}
          <AlertTriangle
            size={MESSAGE_ICON_SIZE}
            color={theme.colors.fg.warm}
            strokeWidth={2}
            // `accessible` above merges this in; it carries nothing the
            // label does not already say.
          />
          <Text size="body" tone="warm" style={styles.messageText}>
            {FINISH_COPY.failed}
          </Text>
        </View>
      ) : null}

      {/* `Button` sets `alignSelf: 'flex-start'` on its own container, so
          the wrapper is what centres it — the same wrapper `LoggerLoadError`
          needs for the same reason. */}
      <View style={styles.action}>
        <Button
          variant="secondary"
          size="md"
          // 52px, not 44 — §13's mid-set floor, the same one the `Pause`
          // pill takes, and `Button` applies it as a `minHeight` so the
          // label grows past it at 200% text rather than clipping.
          density="client"
          onPress={handlePress}
          // `disabled`, not `loading`: `loading` swaps the label for a
          // spinner, and `DESIGN.md` §5 forbids one here — a label that
          // rewrites itself under a resting thumb is what this screen avoids
          // everywhere else. The local write and the outbox enqueue resolve
          // inside a frame in the normal case, so this state exists for the
          // double tap rather than for the wait: `completeSession` already
          // makes the second tap a no-op, but two taps would still fire two
          // navigations.
          disabled={isWorking}
          accessibilityLabel={FINISH_COPY.action}
          testID="logger-finish"
          iconLeft={<Check size={ICON_SIZE} color={iconColor} strokeWidth={2.4} />}
        >
          {FINISH_COPY.action}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  foot: {
    gap: spacing(10),
    // The separation from the page's rounded edge above. `set-entry` must
    // not put a second bottom-anchored control in this band, and must not
    // let its primary escape the card.
    paddingTop: spacing(16),
    paddingBottom: spacing(18),
  },
  message: {
    flexDirection: 'row',
    // Not `center`: at 200% text the message wraps to several lines and a
    // centred glyph would float to their middle.
    alignItems: 'flex-start',
    gap: spacing(8),
    paddingHorizontal: spacing(8),
  },
  messageText: {
    // Wraps rather than truncates. No `numberOfLines` and no fixed height
    // anywhere in this file (`accessibility` §3).
    flex: 1,
  },
  action: {
    alignItems: 'center',
  },
});
