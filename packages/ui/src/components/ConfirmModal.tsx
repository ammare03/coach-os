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
  testID?: string | undefined;
};

/**
 * The typed-confirmation dialog, for the two stopping points `CLAUDE.md`
 * §7.5 permits: account deletion (§21.4) and client archival.
 *
 * Deliberately narrow. There is no `variant` prop, no "are you sure" mode
 * without typing, and no countdown-then-enable shortcut — each of those
 * defeats the only purpose of the pattern, which is to interrupt autopilot.
 * There is also no "don't ask again".
 *
 * If a third consumer appears, that is a design review rather than an
 * import: `screen-states/03`'s undo toast is the pattern for everything
 * else, including deletes.
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

      <FormField label={`Type ${confirmationText} to confirm`} density="client">
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
          disabled={!matches}
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
