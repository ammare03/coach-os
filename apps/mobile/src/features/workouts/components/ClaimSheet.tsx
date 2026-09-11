import { Sheet, SheetFooter, SheetHeader, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

// "Continue here?" — the one thing DB§14.5's device claim ever renders
// (`session-runtime/08`, `ERRORS.md` ER§1.4's `SESSION_CLAIMED_ELSEWHERE`).
// Design: `claim-sheet.html` in the P09 design project, frames A, B and C.
//
// **Most of the feature draws nothing at all.** A stale claim transfers
// silently and an offline start never asks the server, so this component
// appears only when another device is genuinely, currently logging the
// session the client just tapped Start on. Frames D and E of the design are
// the two silent paths and are deliberately not states of this component.
//
// Six decisions, in the order they matter:
//
// (a) **It is an offer, not a wall.** `SESSION_CLAIMED_ELSEWHERE` is one of
//     the few blocking states in the logger, and what makes it survivable is
//     that the blocking state ships its own way out: the primary action is
//     one tap from a loggable session. A duplicate row is recoverable; a
//     client standing in a gym who cannot log is not.
//
// (b) **Nothing here names the other device.** Not an id, not a model, not
//     "claimed 4 minutes ago". The server deliberately sends none of it
//     (`packages/schemas/src/errors.ts`), because a device name is a stable
//     identifier for hardware the client may no longer own, and a timestamp
//     is our bookkeeping surfacing as if it were their problem. "Another
//     device" is the whole of what anyone needs in order to decide.
//
// (c) **`SheetHeader` carries a SHORT title and the sentence goes in the
//     body.** The design's frames show ERRORS.md's own first sentence as the
//     title; the shared header pins `numberOfLines={1}` so that sentence
//     would truncate, and it is the one line that has to survive 200% text.
//     Splitting it — "Continue here?" above, the full sentence below — keeps
//     both the shared sheet anatomy and the copy intact.
//
// (d) **The close affordance disappears while the transfer runs**, matching
//     frame B: the claim has already moved server-side and only the catch-up
//     remains, so a control that appears to cancel would cancel nothing the
//     client thinks it does. The sheet stays **dismissible** by handle and
//     backdrop regardless — `isDismissible={false}` has exactly one
//     sanctioned use in this product (a sheet mid-purchase) and a one-second
//     catch-up is not it. Dismissing mid-catch-up is harmless: the next tap
//     renews the claim this device already holds and refetches again.
//
//     The affordance itself is `SheetHeader`'s close icon, where the design
//     draws the word "Cancel". The shared anatomy wins: it is the same
//     dismissal in the same corner on every sheet in the app, and forking it
//     for one screen is how two sheets stop looking like one product.
//
// (e) **The catch-up failure still leads into the logger.** Frame C. It says
//     what happened and offers "Start here anyway" rather than a retry loop
//     in front of someone holding a barbell. The copy states the mechanism —
//     both devices' sets join up once they are online — instead of promising
//     an outcome, because sets are device-wins and merge by their own keys
//     (DB§14.3) and there is no merge screen.
//
// (f) **Nothing counts what the other device logged.** The design sketched
//     "the 20 sets logged on the other device" and its own note said to drop
//     the number rather than guess it; decision (b) means the server never
//     sends one, so the copy states the fact without it.

export type ClaimSheetStatus =
  /** Another device holds the session, live. The client has not answered yet. */
  | 'offered'
  /** "Continue here" was tapped: the claim has moved and server truth is loading. */
  | 'transferring'
  /** The claim moved but the catch-up did not finish — decision (e). */
  | 'catchup-failed';

export type ClaimSheetProps = {
  isOpen: boolean;
  status: ClaimSheetStatus;
  /** Takes the claim. On `catchup-failed`, enters the logger without the catch-up. */
  onContinueHere: () => void;
  /** Leaves the session where it is. Nothing was written locally, so this is a true no-op. */
  onCancel: () => void;
};

const BODY: Record<ClaimSheetStatus, string> = {
  offered:
    "You're logging this session on another device. Continue here and this one takes over — anything the other device has already synced is loaded first.",
  transferring: 'Loading what the other device logged.',
  'catchup-failed':
    "We couldn't load what the other device logged. You can start here now — both devices' sets join up once they're back online.",
};

const ACTION_LABEL: Record<ClaimSheetStatus, string> = {
  offered: 'Continue here',
  // The design's frame B names this beat, and the label is not decoration
  // even though `Button` hides it behind the spinner: it stays in the tree,
  // so it is what a screen reader announces for a button whose
  // `accessibilityState` has just gone busy. "Continue here" there would
  // speak an offer the client has already accepted.
  transferring: 'Catching up',
  'catchup-failed': 'Start here anyway',
};

export function ClaimSheet({ isOpen, status, onContinueHere, onCancel }: ClaimSheetProps) {
  const isTransferring = status === 'transferring';

  return (
    <Sheet isOpen={isOpen} onDismiss={onCancel} snap="auto" testID="claim-sheet">
      {/* The design puts ERRORS.md's full sentence here, not "Continue here?".
          It is split because `SheetHeader` pins `numberOfLines={1}` on its
          title: the sentence would truncate, and it is the one line that has
          to survive 200% text. Decision (c). If that ever becomes wrappable
          in `packages/ui`, this is the call site that should go back to the
          design — the sentence below is already the design's own copy. */}
      <SheetHeader
        title="Continue here?"
        // Decision (d). Omitted, not disabled — the shared header renders no
        // close affordance at all when there is no handler.
        {...(isTransferring ? {} : { onClose: onCancel })}
      />

      <View style={styles.body}>
        {/* `body-lg` is the client app's body floor (`DESIGN.md` §1.3), and
            no `numberOfLines`: at 200% text this wraps and the sheet grows
            rather than clipping the sentence the decision rests on. */}
        <Text size="body-lg" tone="warm-muted" accessibilityLiveRegion="polite">
          {BODY[status]}
        </Text>
      </View>

      <SheetFooter
        actionLabel={ACTION_LABEL[status]}
        onAction={onContinueHere}
        // Decision (a): the way out is never inert. `SheetFooter` defaults
        // this to `true` so a forgotten footer fails safe; here the whole
        // point is that the action is available.
        isActionDisabled={isTransferring}
        isActionLoading={isTransferring}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
});
