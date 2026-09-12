import { Button, Modal, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

/**
 * The confirm-discard dialog `local-database/03-wipe-on-logout.md` step 2
 * specifies: *"wait (stay signed in until sync completes) or explicitly
 * discard (force wipe despite pending work)."*
 *
 * **Why a dialog at all, when `ui-conventions` §5 says undo, not confirm.**
 * This is not a confirmation of something the user asked for — the sign-out
 * did not happen. `wipeLocalDatabase` refused it, before the token revoke and
 * before the store flip, so the session behind this dialog is completely
 * untouched. What is on screen is the refusal, plus the only two ways past
 * it. Undo is not available as the alternative pattern here in the way it is
 * everywhere else: the thing undo would reverse is a deleted database file,
 * and five seconds does not honestly cover that. Nor is this §5's typed
 * confirmation — sign-out is not account deletion or client archival, and
 * making someone type a word to leave a shared phone would be theatre.
 *
 * **It leads with the safe choice, and that is the whole design.** DB§13's
 * caveat rendered as UI: the wipe that would lose a workout must be chosen,
 * never defaulted. So the primary action keeps the session, the destructive
 * one is the outlined `danger` variant beneath it, and dismissing the dialog
 * — backdrop, Android back — resolves to keeping the session too, because the
 * accidental outcome and the safe outcome have to be the same one.
 *
 * **The actions stack rather than sitting side by side.** Both labels are
 * full sentences, and `accessibility` §3 forbids truncating a primary action
 * at 200% text; a row of two would have had to shrink one of them, and the
 * label is the entire safeguard.
 *
 * Reused at the end of `account-actions/02`'s deletion flow, which also ends
 * in a sign-out.
 */
export interface UnsyncedWorkPromptProps {
  /**
   * The outbox rows that have not reached the server, from `WipeResult`'s
   * `blocked` branch — and `null` when there is nothing to ask about.
   *
   * One prop rather than an `isOpen` beside a count: a dialog that is open
   * without a number to name is a dialog with no content, and this makes that
   * state unexpressible.
   */
  pendingCount: number | null;
  onKeepSignedIn: () => void;
  onDiscard: () => void;
  /** The forced retry is in flight. Both actions go inert; nothing else changes. */
  isDiscarding?: boolean;
  testID?: string | undefined;
}

/**
 * "3 entries haven't synced yet" — `COPY.md` §CO6: a fact with a number in
 * it. Not "Are you sure?", which asks a question the product already knows
 * the answer to, and not "You have unsaved work", which puts the failure on
 * the person holding the phone.
 *
 * **"entries", not "sets".** The outbox carries whatever a phase queued into
 * it — sets, meals, check-in answers — and the count is of rows, not of
 * workouts. Naming a type the count does not actually measure would be wrong
 * the first time someone logs a meal offline.
 */
export function unsyncedWorkTitle(count: number): string {
  return count === 1 ? '1 entry hasn’t synced yet' : `${count} entries haven’t synced yet`;
}

export function UnsyncedWorkPrompt({
  pendingCount,
  onKeepSignedIn,
  onDiscard,
  isDiscarding = false,
  testID,
}: UnsyncedWorkPromptProps) {
  const isOpen = pendingCount !== null;

  return (
    <Modal isOpen={isOpen} onDismiss={onKeepSignedIn} isDismissible={!isDiscarding} testID={testID}>
      <View style={styles.copy}>
        <Text size="title">{unsyncedWorkTitle(pendingCount ?? 0)}</Text>
        {/* States the consequence, names no network condition — a gym
            basement is not a thing to explain to someone standing in one —
            and blames nothing. */}
        <Text size="body" tone="muted">
          They are saved on this phone only. Signing out clears this device, so they would go with
          it.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          variant="primary"
          size="md"
          fullWidth
          onPress={onKeepSignedIn}
          disabled={isDiscarding}
        >
          Keep me signed in
        </Button>
        <Button variant="danger" size="md" fullWidth onPress={onDiscard} loading={isDiscarding}>
          Discard and sign out
        </Button>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  copy: {
    gap: 8,
  },
  actions: {
    gap: 10,
  },
});
