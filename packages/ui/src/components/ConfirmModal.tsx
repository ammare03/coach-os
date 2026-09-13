import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from './Button.tsx';
import { FormField } from './FormField.tsx';
import { Input } from './Input.tsx';
import { Modal } from './Modal.tsx';
import { Text } from './Text.tsx';

export type ConfirmModalProps = {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  /**
   * The exact string the user must type. Matched **case-sensitively** and
   * without trimming the interior — the friction is the feature.
   */
  confirmationText: string;
  /** `DESIGN.md` §10.8 — the action label says what happens, not "OK". */
  actionLabel: string;
  isConfirming?: boolean;
  /**
   * An inline failure or notice, rendered in `FormField`'s **reserved**
   * message row with FormField's own error treatment — leading glyph, never
   * colour alone, and read as the field's hint.
   *
   * It belongs under the field rather than appended to `body` because the
   * row is already held open whether or not a message is present, so one
   * appearing shifts nothing above it, and it lands where the user is
   * already looking: the thing they are about to retype into.
   */
  message?: string | undefined;
  /**
   * Blocks the action even when the typed text matches — for a **standing
   * condition**, like having no connection, that no amount of typing fixes.
   *
   * Separate from `message` on purpose. A failure a retry could fix supplies
   * `message` alone and leaves the action pressable, so retrying costs one
   * tap rather than the whole word again; folding the two together would
   * take that button away.
   */
  isActionDisabled?: boolean;
  testID?: string | undefined;
};

/**
 * The typed-confirmation dialog, for the **three** stopping points
 * `CLAUDE.md` §7.5 permits: account deletion (§21.4), client archival, and
 * a client leaving their coach.
 *
 * Deliberately narrow. There is no `variant` prop, no "are you sure" mode
 * without typing, and no countdown-then-enable shortcut — each of those
 * defeats the only purpose of the pattern, which is to interrupt autopilot.
 * There is also no "don't ask again".
 *
 * This doc comment used to say two consumers, and that a third was "a
 * design review, not an import". **That review happened**, in
 * `phase-10-coach-review-surfaces/relationship-controls/02`, and the answer
 * was yes for one reason: leaving releases a seat and starts a 30-day clock
 * on the former coach's read access, and no undo toast can put either back.
 * The test is not "is this destructive" — every delete is — it is "is there
 * a take-back the five-second window could honestly offer". Where there is,
 * `screen-states/03`'s undo toast is still the pattern, including for
 * deletes.
 *
 * A **fourth** consumer is the next review, on the same test.
 */
export function ConfirmModal({
  isOpen,
  onCancel,
  onConfirm,
  title,
  body,
  confirmationText,
  actionLabel,
  isConfirming = false,
  message,
  isActionDisabled = false,
  testID,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('');
  // Reopening must not inherit the previous attempt's text, or the second
  // deletion is one tap with no confirmation at all. React's
  // reset-state-on-prop-change pattern, not a `setState` inside an effect —
  // the latter costs a cascading render and the compiler rejects it.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (typed !== '') setTyped('');
  }

  const matches = typed === confirmationText;

  return (
    <Modal
      isOpen={isOpen}
      onDismiss={onCancel}
      // Escapable: this interrupts autopilot, it does not trap. The typed
      // match is what makes the action deliberate, not an inability to leave.
      isDismissible={!isConfirming}
      testID={testID}
    >
      <View style={styles.copy}>
        <Text size="title">{title}</Text>
        <Text size="body" tone="muted">
          {body}
        </Text>
      </View>

      {/* `error`, not `hint`: every message this slot carries is a failure
          or a blocked condition, and `error` is what gives it the glyph. */}
      <FormField label={`Type ${confirmationText} to confirm`} error={message} density="client">
        <Input
          value={typed}
          onChangeText={setTyped}
          placeholder={confirmationText}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
          density="client"
        />
      </FormField>

      <View style={styles.actions}>
        <Button variant="ghost" size="md" onPress={onCancel} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="md"
          onPress={onConfirm}
          disabled={!matches || isActionDisabled}
          loading={isConfirming}
        >
          {actionLabel}
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
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
});
