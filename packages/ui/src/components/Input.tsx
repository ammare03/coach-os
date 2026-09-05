import { X } from 'lucide-react-native';
import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTextScale } from '../theme/TextScaleProvider.tsx';
import {
  colors,
  control,
  fontFamily,
  fontSize,
  radius,
  tapTarget,
  type Density,
} from '../theme/tokens.ts';

import { IconButton } from './IconButton.tsx';

export type InputState = 'default' | 'error' | 'disabled';

// A curated pass-through, not a spread of arbitrary `TextInput` props
// (`ui-primitives-core/03`'s point is a surface narrow enough that no
// screen can reintroduce a hardcoded `style`). Behaviour props are
// addable later; styling props — `style` included — are not.
export interface InputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  state?: InputState;
  density?: Density;
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
  onFocus?: () => void;
  maxLength?: number;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  testID?: string;
}

const BODY_SIZE = fontSize['body-lg'][0]; // §1.2/`03`'s AC — 16pt floor, both densities.

// Density changes horizontal breathing room only — never the 44px height
// floor above, and never the 16pt body size (`03`'s AC).
const HORIZONTAL_PADDING: Record<Density, number> = {
  client: 16,
  coach: 14,
};

/**
 * The text control only — label, hint, and error live in `FormField`,
 * which wraps this. Controlled, deliberately: an uncontrolled input with
 * an imperative ref is how a value silently diverges from
 * `react-hook-form`'s state.
 *
 * L1 inset well (`bg.inset` at 50%, DESIGN.md §2), **44px tall at both
 * densities** — the one primitive in the product where the tap target and
 * the visible box are the same rectangle, so there is no `hitSlop` to fall
 * back on; density changes surrounding padding elsewhere, never this
 * control's height. Error is `border.strong`, never a red fill — the
 * glyph and the `urgent-text` message (rendered by `FormField`) carry the
 * meaning colour alone isn't allowed to.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    value,
    onChangeText,
    placeholder,
    state = 'default',
    density: densityProp = 'client',
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
    onFocus,
    maxLength,
    accessibilityLabel,
    accessibilityHint,
    testID,
  },
  ref,
) {
  const disabled = state === 'disabled';
  const showClear = value.length > 0 && !disabled && !multiline;
  // A raw `TextInput` scales with the OS font setting on its own but knows
  // nothing about the gallery's scale toggle, which is the one gap
  // `component-gallery/01` flagged. At the default scale of 1 this resolves
  // to `BODY_SIZE` and the render path is unchanged.
  const fontSizeScaled = BODY_SIZE * useTextScale();

  return (
    <View style={styles.wrapper}>
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
        onFocus={onFocus}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        testID={testID}
        style={[
          styles.base,
          {
            fontSize: fontSizeScaled,
            paddingHorizontal: HORIZONTAL_PADDING[densityProp],
            paddingRight: showClear ? 40 : HORIZONTAL_PADDING[densityProp],
            borderColor: state === 'error' ? colors.border.strong : colors.border.DEFAULT,
            backgroundColor: disabled ? control.surfaceSubtle : control.surface,
            color: disabled ? colors.fg.faint : colors.fg.DEFAULT,
          },
        ]}
      />
      {showClear && (
        <View style={styles.clearSlot}>
          <IconButton
            icon={<X size={16} color={colors.fg.muted} />}
            variant="ghost"
            size="sm"
            // Names the field it clears when the field has a name — a form
            // of six inputs otherwise announces six identical "Clear"
            // buttons (`accessibility` §2). `FormField` supplies the label,
            // so this is the normal case, not the rare one.
            accessibilityLabel={accessibilityLabel ? `Clear ${accessibilityLabel}` : 'Clear'}
            onPress={() => onChangeText('')}
          />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    justifyContent: 'center',
  },
  base: {
    minHeight: tapTarget.MIN,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingVertical: 10,
    fontFamily: fontFamily.sans,
  },
  clearSlot: {
    position: 'absolute',
    right: 4,
  },
});
