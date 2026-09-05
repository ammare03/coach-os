import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { radius, tapTarget } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { resolveButtonVariantVisuals, type ButtonVariant } from './Button.tsx';
import { Pressable, type PressableRenderState } from './Pressable.tsx';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps {
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: IconButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Required, not optional-with-a-warning: an icon button with no label is
   * invisible to VoiceOver/TalkBack (`ui-conventions` §8,
   * `ui-primitives-core/01`). TypeScript rejects a call site that omits it.
   */
  accessibilityLabel: string;
  testID?: string;
}

// No DESIGN.md literal names a generic icon-only control, so these are a
// local, documented choice rather than a token: `sm` matches the coach
// toolbar's compact controls, `lg` matches a mid-set nav item. `sm` is the
// only one that needs `hitSlop` to clear `tapTarget.MIN` (44); the other
// two already do.
const DIMENSION: Record<IconButtonSize, number> = {
  sm: 32,
  md: 44,
  lg: 52,
};

const HIT_SLOP: Record<IconButtonSize, number> = {
  sm: Math.ceil((tapTarget.MIN - DIMENSION.sm) / 2),
  md: 0,
  lg: 0,
};

/**
 * Icon-only pressable sharing `Button`'s variant palette and pressed
 * treatment (`resolveButtonVariantVisuals`) — never a second colour
 * system for the same four variants.
 */
export function IconButton({
  icon,
  variant = 'secondary',
  size = 'md',
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
}: IconButtonProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const dimension = DIMENSION[size];

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP[size]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      containerStyle={variant === 'primary' && !disabled ? themed.primaryShadow : undefined}
      style={({ pressed }: PressableRenderState) => {
        const v = resolveButtonVariantVisuals(variant, pressed, disabled, theme);
        return [
          styles.base,
          {
            width: dimension,
            height: dimension,
            borderRadius: radius.full,
            backgroundColor: v.backgroundColor,
            borderWidth: v.borderWidth,
            borderColor: v.borderColor,
            borderStyle: v.borderStyle,
            overflow: 'hidden',
          },
        ];
      }}
    >
      {({ pressed }: PressableRenderState) => {
        const v = resolveButtonVariantVisuals(variant, pressed, disabled, theme);
        return (
          <>
            {v.useGradient && (
              <LinearGradient
                colors={[theme.colors.primary.from, theme.colors.primary.to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            {v.showHairlines && (
              <>
                <View
                  pointerEvents="none"
                  style={[themed.hairlineTop, pressed && styles.hairlineHidden]}
                />
                <View
                  pointerEvents="none"
                  style={[themed.hairlineBottom, pressed && styles.hairlineHidden]}
                />
              </>
            )}
            <View style={styles.iconWrap}>{icon}</View>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairlineHidden: {
    opacity: 0,
  },
});

// Shares `Button`'s glow and inset edges - one treatment, two components.
const useThemedStyles = createThemedStyles((theme) => ({
  primaryShadow: {
    shadowColor: theme.colors.brand.DEFAULT,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.control.primaryHighlight,
  },
  hairlineBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: theme.control.primaryLowlight,
  },
}));
