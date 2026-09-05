import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import {
  colors,
  control,
  density,
  radius,
  spacing,
  tapTarget,
  type Density,
} from '../theme/tokens.ts';

import { Pressable, type PressableRenderState } from './Pressable.tsx';
import { Text } from './Text.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `Density` from `tokens.ts` — drives `size="md"`'s height only (see `MD_HEIGHT` below). */
  density?: Density;
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
}

// task doc `01`'s sizing table gives `sm`/`lg` a fixed height, reached at
// 48px tappable via `hitSlop` (`sm`) or already ≥48 (`lg`). DESIGN.md §9's
// primary-button literal ("height 46 coach / 52 client") is exactly
// `density[d].button` from `tokens.ts` — so `size="md"` (the default) pulls
// its height from `density` instead of a fixed number, and `sm`/`lg` stay
// fixed across both densities, since DESIGN.md gives no density-specific
// literal for either. This is CONTRACT.md's authority order in practice:
// the task doc's 3-tier hit-mechanics system still governs (DESIGN.md is
// silent on it), but the one literal DESIGN.md *does* give (md's height)
// wins over the task doc's flat `44`.
const FIXED_HEIGHT: Partial<Record<ButtonSize, number>> = {
  sm: 32,
  lg: 56,
};

// §3's floor is `tapTarget.MIN` (44), not the visible box. `sm` (32) is
// the only size that needs `hitSlop` to reach it; `md` (density-driven,
// 46/52) and `lg` (56) already clear it on their own.
const HIT_SLOP: Record<ButtonSize, number> = {
  sm: Math.ceil((tapTarget.MIN - 32) / 2),
  md: 0,
  lg: 0,
};

// DESIGN.md §1.2's type table pins buttons to the `label` size (500,
// 14–15/19–20) regardless of `size` — there is no button-specific size
// variant in the spec, only a height/tap-target variant (above). `sm`
// drops one step to `body-sm` (14pt) per the coach-only toolbar use case
// task `01`'s AC calls out; `md`/`lg` use `label`.
const FONT_SIZE: Record<ButtonSize, 'body-sm' | 'label'> = {
  sm: 'body-sm',
  md: 'label',
  lg: 'label',
};

const PADDING_HORIZONTAL: Record<ButtonSize, number> = {
  sm: 12,
  md: 16,
  lg: 20,
};

interface VariantVisuals {
  useGradient: boolean;
  showHairlines: boolean;
  backgroundColor: string;
  borderWidth: number;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed';
  textColor: string;
}

/**
 * Resolves the four-variant palette (CONTRACT.md §5 / DESIGN.md §9).
 * Shared with `IconButton` so the two never drift apart.
 *
 * `danger` is outlined and lettered in `urgent-text` — never a filled red
 * rectangle. Red/maroon fills are adherence state (`theme/adherence-
 * colors-only`); a filled danger button would read as a status signal in
 * a scanned list rather than a control's own affordance.
 */
export function resolveButtonVariantVisuals(
  variant: ButtonVariant,
  pressed: boolean,
  disabled: boolean,
): VariantVisuals {
  if (disabled) {
    // CONTRACT.md §5 — `bg.inset` at 40%, text `fg.faint`. One disabled
    // treatment for every variant; the difference between variants stops
    // mattering once a control can't be pressed.
    return {
      useGradient: false,
      showHairlines: false,
      backgroundColor: control.surfaceDisabled,
      borderWidth: 0,
      textColor: colors.fg.faint,
    };
  }

  switch (variant) {
    case 'primary':
      return {
        useGradient: true,
        showHairlines: true,
        backgroundColor: 'transparent',
        borderWidth: 0,
        textColor: colors.fg.onBrand,
      };
    case 'secondary':
      // DESIGN.md §9 — `bg.inset` 45–50%, same value as `elevation.inset`
      // in `tokens.ts`, + a 1px warm hairline border.
      return {
        useGradient: false,
        showHairlines: false,
        backgroundColor: control.surface,
        borderWidth: 1,
        borderColor: control.border,
        borderStyle: 'solid',
        textColor: colors.fg.glass,
      };
    case 'ghost':
      // DASHED border, never solid — the visual signal that this is an
      // "add" affordance, not a committed action. Press brightens the
      // border toward `brand.DEFAULT` only; no fill, ever.
      return {
        useGradient: false,
        showHairlines: false,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: pressed ? colors.brand.DEFAULT : colors.border.strong,
        borderStyle: 'dashed',
        textColor: colors.brand.DEFAULT,
      };
    case 'danger':
      return {
        useGradient: false,
        showHairlines: false,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors['urgent-text'],
        borderStyle: 'solid',
        textColor: colors['urgent-text'],
      };
  }
}

/**
 * Four variants × three sizes, no thirteenth (`ui-primitives-core/01`).
 * `loading` and `disabled` both block `onPress`; only `loading` preserves
 * width and full contrast (a spinner replaces the label without shrinking
 * the button, so a thumb already moving toward the next control doesn't
 * follow a layout shift). No haptics anywhere in this component —
 * `screen-states/04` owns the three haptic triggers in the product and
 * "button press" is not one of them.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  density: densityProp = 'client',
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  iconLeft,
  iconRight,
  children,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const blocked = disabled || loading;
  const height = size === 'md' ? density[densityProp].button : (FIXED_HEIGHT[size] ?? 44);

  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      disabled={blocked}
      hitSlop={HIT_SLOP[size]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      testID={testID}
      containerStyle={[
        styles.outer,
        fullWidth && styles.fullWidth,
        variant === 'primary' && !disabled && styles.primaryShadow,
      ]}
      style={({ pressed }: PressableRenderState) => {
        const v = resolveButtonVariantVisuals(variant, pressed, disabled);
        return [
          styles.base,
          {
            // Min-height, never height: at 200% text the `label` line box is
            // 40px and a `sm` button's 32px box would clip it
            // (`accessibility` §3).
            minHeight: Math.max(height, tapTarget.MIN),
            paddingHorizontal: PADDING_HORIZONTAL[size],
            borderRadius: radius.full,
            backgroundColor: v.backgroundColor,
            borderWidth: v.borderWidth,
            borderColor: v.borderColor,
            borderStyle: v.borderStyle,
            width: fullWidth ? '100%' : undefined,
            overflow: 'hidden',
          },
        ];
      }}
    >
      {({ pressed }: PressableRenderState) => {
        const v = resolveButtonVariantVisuals(variant, pressed, disabled);
        return (
          <>
            {v.useGradient && (
              <LinearGradient
                colors={[colors.primary.from, colors.primary.to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            {v.showHairlines && (
              <>
                {/* the inset-edge trick (CONTRACT.md §4) — collapses on press */}
                <View
                  pointerEvents="none"
                  style={[styles.hairlineTop, pressed && styles.hairlineHidden]}
                />
                <View
                  pointerEvents="none"
                  style={[styles.hairlineBottom, pressed && styles.hairlineHidden]}
                />
              </>
            )}
            <View style={styles.content}>
              <View style={[styles.labelRow, loading && styles.labelRowHidden]}>
                {iconLeft}
                {/* No `numberOfLines`: `accessibility` §3 forbids truncating a
                    primary action's label. A constrained (`fullWidth`) button
                    wraps and grows; an unconstrained one still sizes to its
                    content, so nothing changes at the default scale. */}
                <Text size={FONT_SIZE[size]} style={[styles.label, { color: v.textColor }]}>
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
          </>
        );
      }}
    </Pressable>
  );
}

// DESIGN.md §9's primary-button glow: `0 10px 22px -8px rgba(255,165,134,.5)`.
// `shadowColor` routes through `colors.brand.DEFAULT` rather than a bare
// hex; the offset/radius geometry is component-specific (like `SIZES`
// above) and isn't a reusable token.
const styles = StyleSheet.create({
  outer: {
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  primaryShadow: {
    shadowColor: colors.brand.DEFAULT,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: tapTarget.MIN,
    // Only reached once the label is taller than the button's own box, i.e.
    // at a large text scale — at the default scale `minHeight` wins and this
    // changes nothing.
    paddingVertical: spacing(4),
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(32),
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
  labelRowHidden: {
    opacity: 0,
  },
  spinner: {
    position: 'absolute',
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: control.primaryHighlight,
  },
  hairlineBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: control.primaryLowlight,
  },
  hairlineHidden: {
    opacity: 0,
  },
});
