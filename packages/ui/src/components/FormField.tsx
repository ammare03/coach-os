import { cloneElement, isValidElement, type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/tokens.ts';

export interface FormFieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  isRequired?: boolean;
  children: ReactElement<{
    accessibilityLabel?: string | undefined;
    accessibilityHint?: string | undefined;
  }>;
}

/**
 * Label / hint / error anatomy, wired to whatever control it wraps —
 * `ui-primitives-core/03`'s `Input` today, `NumberStepper`/`Select` later.
 * That's why this lives separately from `Input` rather than inside it.
 *
 * The hint/error line always occupies its slot, present or not — an error
 * appearing must never shift the field below it (`03`'s Approach step 4).
 * The error is never colour alone: a glyph carries the meaning colour
 * isn't allowed to (`ui-conventions` §2's semantic colour rule — red is
 * adherence state, not a form error).
 */
export function FormField({ label, hint, error, isRequired, children }: FormFieldProps) {
  const message = error ?? hint;
  const control = isValidElement(children)
    ? cloneElement(children, {
        accessibilityLabel: label,
        accessibilityHint: hint,
      })
    : children;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {isRequired ? ' *' : ''}
      </Text>
      {control}
      <View style={styles.messageSlot}>
        {message !== undefined && (
          <Text style={[styles.message, error !== undefined && styles.errorMessage]}>
            {error !== undefined ? '⚠ ' : ''}
            {message}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    color: colors.fg.muted,
  },
  messageSlot: {
    minHeight: 18,
  },
  message: {
    fontSize: 13,
    color: colors.fg.muted,
  },
  errorMessage: {
    color: colors.fg.DEFAULT,
  },
});
