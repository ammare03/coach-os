import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius } from '../theme/tokens.ts';

import { Pressable } from './Pressable.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Blocking-mutation cases only (a sign-in, a StoreKit purchase) —
   * `ui-conventions` §5's "optimistic always" means most buttons in this
   * product never enter this state. Keeps full contrast and the button's
   * width; only the label is swapped for a spinner.
   */
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// `sm`/`md` reach the 48×48 tap floor via `hitSlop`, not by growing the
// visible control — `ui-primitives-core/01`'s sizing table. `lg` is
// already ≥48 and needs none.
const SIZES: Record<
  ButtonSize,
  { height: number; fontSize: number; paddingHorizontal: number; hitSlop: number }
> = {
  sm: { height: 32, fontSize: 14, paddingHorizontal: 12, hitSlop: 8 },
  md: { height: 44, fontSize: 16, paddingHorizontal: 16, hitSlop: 2 },
  lg: { height: 56, fontSize: 16, paddingHorizontal: 20, hitSlop: 0 },
};

function variantStyle(variant: ButtonVariant, pressed: boolean) {
  switch (variant) {
    case 'primary':
      return {
        backgroundColor: colors.brand.DEFAULT,
        borderWidth: 0,
        textColor: colors.fg.onBrand,
      };
    case 'secondary':
      return {
        backgroundColor: pressed ? colors.bg.overlay : colors.bg.raised,
        borderWidth: 1,
        borderColor: colors.border.DEFAULT,
        textColor: colors.fg.DEFAULT,
      };
    case 'ghost':
      return {
        backgroundColor: pressed ? colors.bg.raised : 'transparent',
        borderWidth: 0,
        textColor: colors.fg.muted,
      };
    case 'danger':
      // Outlined and lettered in red, never filled — red is adherence
      // state (`ui-conventions` §2's semantic colour rule), and a filled
      // red button reads as a status signal in a scanned list.
      return {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.danger,
        textColor: colors.danger,
      };
  }
}

/**
 * Four variants × three sizes, no thirteenth (`ui-primitives-core/01`).
 * No haptics anywhere in this component — `screen-states/04` owns the
 * three haptic triggers in the product and "button press" is not one.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  children,
  accessibilityLabel,
  testID,
  style,
}: ButtonProps) {
  const { height, fontSize, paddingHorizontal, hitSlop } = SIZES[size];
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => {
        const v = variantStyle(variant, pressed);
        return [
          styles.base,
          {
            height,
            paddingHorizontal,
            backgroundColor: v.backgroundColor,
            borderWidth: v.borderWidth,
            borderColor: 'borderColor' in v ? v.borderColor : undefined,
            borderRadius: radius.md,
            opacity: disabled ? 0.5 : 1,
            width: fullWidth ? '100%' : undefined,
          },
          style,
        ];
      }}
    >
      {(() => {
        const v = variantStyle(variant, false);
        return (
          <View style={styles.content}>
            <View style={[styles.labelRow, { opacity: loading ? 0 : 1 }]}>
              {iconLeft}
              <Text style={{ fontSize, fontWeight: '600', color: v.textColor }} numberOfLines={1}>
                {children}
              </Text>
              {iconRight}
            </View>
            {loading && (
              <View style={styles.spinner}>
                <ActivityIndicator color={v.textColor} size="small" />
              </View>
            )}
          </View>
        );
      })()}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spinner: {
    position: 'absolute',
  },
});
