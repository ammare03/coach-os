import { forwardRef } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { colors, radius } from '../theme/tokens.ts';

export type InputState = 'default' | 'error' | 'disabled';

// A curated pass-through, not a spread of arbitrary `TextInput` props —
// `ui-primitives-core/03`'s point is a surface narrow enough that no
// screen can reintroduce a hardcoded `style`. Behaviour props are addable
// later (`onBlur` already is); styling props are not.
export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  state?: InputState;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  secureTextEntry?: boolean;
  multiline?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  maxLength?: number;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  testID?: string;
}

/**
 * The text control only — label, hint, and error live in `FormField`,
 * which wraps this. Controlled, deliberately: an uncontrolled input with
 * an imperative ref is how a value silently diverges from `react-hook-
 * form`'s state (`03`'s Approach step 1).
 *
 * 48px tall regardless of state — the one primitive in the product where
 * the tap target and the visible box are the same rectangle, so there is
 * no `hitSlop` to fall back on. Density (compact vs comfortable) is
 * deferred to the real `phase-04-design-system` task; this minimal version
 * only ever renders `comfortable`.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    value,
    onChangeText,
    placeholder,
    state = 'default',
    keyboardType,
    autoCapitalize = 'none',
    autoCorrect = false,
    autoComplete,
    textContentType,
    secureTextEntry,
    multiline,
    returnKeyType,
    onSubmitEditing,
    onBlur,
    maxLength,
    accessibilityLabel,
    accessibilityHint,
    testID,
  },
  ref,
) {
  const disabled = state === 'disabled';

  return (
    <TextInput
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.fg.subtle}
      editable={!disabled}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      autoComplete={autoComplete}
      textContentType={textContentType}
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      returnKeyType={returnKeyType}
      onSubmitEditing={onSubmitEditing}
      onBlur={onBlur}
      maxLength={maxLength}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[
        styles.base,
        {
          borderColor: state === 'error' ? colors.border.strong : colors.border.DEFAULT,
          backgroundColor: colors.bg.inset,
          color: colors.fg.DEFAULT,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: 'System',
  },
});
