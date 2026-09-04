import { AlertCircle } from 'lucide-react-native';
import { cloneElement, isValidElement, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, fontSize, spacing, type Density } from '../theme/tokens.ts';

import { Text } from './Text.tsx';

export interface FormFieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  isRequired?: boolean;
  density?: Density;
  children: ReactElement<{
    accessibilityLabel?: string | undefined;
    accessibilityHint?: string | undefined;
  }>;
}

const MESSAGE_LINE_HEIGHT = Number.parseInt(fontSize['body-sm'][1].lineHeight, 10);

// Density changes the label/control/message gap only — never the label's
// `body-sm` size and never the message slot's reserved height.
const GAP: Record<Density, number> = {
  client: spacing(6),
  coach: spacing(5),
};

/**
 * Label / hint / error anatomy, wired to whatever control it wraps —
 * `Input` today, `NumberStepper`/`Select`/check-in field types later.
 * That is why label and error live here rather than inside `Input`
 * itself: those are form-field concerns, not text-input concerns.
 *
 * The hint/error slot always occupies its line, present or not — an error
 * appearing must never shift the control above it. Error is never colour
 * alone: a leading glyph carries the meaning colour isn't allowed to
 * (DESIGN.md §8 / CONTRACT.md rule 7), and the field itself never becomes
 * a red fill (`border.strong`, not `urgent`) — only this message does.
 *
 * Label is **static, above, `body-sm`** — never a floating label, never
 * placeholder-as-label (DESIGN.md §9's `Input` row).
 */
export function FormField({
  label,
  hint,
  error,
  isRequired = false,
  density: densityProp = 'client',
  children,
}: FormFieldProps) {
  const isError = error !== undefined;
  const message = error ?? hint;

  // The label is the reader's spoken name for the control; the message
  // (error preferred over hint) becomes the hint so VoiceOver/TalkBack
  // read label → value → hint/error, and an errored field is announced
  // with its reason, not just a generic "invalid" (`03`'s AC).
  const control = isValidElement(children)
    ? cloneElement(children, {
        accessibilityLabel: label,
        accessibilityHint: message,
      })
    : children;

  return (
    <View style={[styles.container, { gap: GAP[densityProp] }]}>
      <Text size="body-sm" tone="muted">
        {label}
        {isRequired && <Text style={{ color: colors.brand.DEFAULT }}> *</Text>}
      </Text>
      {control}
      <View style={styles.messageSlot}>
        {message !== undefined && (
          <View style={styles.messageRow}>
            {isError && (
              <AlertCircle size={14} color={colors['urgent-text']} style={styles.messageGlyph} />
            )}
            <Text
              size="body-sm"
              style={[styles.messageText, isError && { color: colors['urgent-text'] }]}
            >
              {message}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  messageSlot: {
    minHeight: MESSAGE_LINE_HEIGHT,
    justifyContent: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(6),
  },
  messageGlyph: {
    marginTop: 2,
  },
  messageText: {
    flex: 1,
    color: colors.fg.muted,
  },
});
