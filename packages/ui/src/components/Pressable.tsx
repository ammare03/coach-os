import { useState, type ReactNode } from 'react';
import {
  Pressable as RNPressable,
  type AccessibilityState,
  type PressableProps as RNPressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { duration, easing } from '../theme/tokens.ts';

export interface PressableRenderState {
  pressed: boolean;
}

export interface PressableProps extends Pick<
  RNPressableProps,
  | 'onLongPress'
  | 'hitSlop'
  | 'testID'
  | 'accessibilityLabel'
  | 'accessibilityHint'
  | 'accessibilityRole'
> {
  onPress?: (() => void) | undefined;
  disabled?: boolean;
  accessibilityState?: AccessibilityState | undefined;
  children: ReactNode | ((state: PressableRenderState) => ReactNode);
  /** Applied to the animated inner view — background, border, padding, etc. */
  style?: StyleProp<ViewStyle> | ((state: PressableRenderState) => StyleProp<ViewStyle>);
  /** Applied to the outer, non-animated `RNPressable` — layout only (e.g. `fullWidth`). */
  containerStyle?: StyleProp<ViewStyle>;
}

// CONTRACT.md §4/§5 — `duration.press` (120ms) and `easing.out` are the
// only curve this treatment is allowed to use.
const PRESS_EASING = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);

/**
 * The one press treatment in the product (CONTRACT.md rule 2): RN
 * `Pressable`, never `TouchableOpacity`. `scale(0.97)` on press-in,
 * `duration.press` + `easing.out` back to `1` on release. Opacity never
 * changes — dimming a label mid-press drops it below the 4.5:1 contrast
 * floor for the duration of the press.
 *
 * Every later pressable in P04 (`Button`, `IconButton`, `Card` when
 * pressable, `Chip`, `SegmentedControl` segments, list rows) wraps this
 * rather than re-deriving the animation. Consumers that render an inset
 * highlight/lowlight hairline (§4's "inset-edge trick") collapse it
 * themselves using the `pressed` value handed to function `children`/
 * `style` — this component owns only the scale.
 */
export function Pressable({
  disabled = false,
  children,
  style,
  containerStyle,
  accessibilityState,
  onPress,
  hitSlop,
  ...rest
}: PressableProps) {
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);

  // Deliberately NOT wrapped in `useCallback`: the React Compiler's
  // immutability rule rejects mutating a value that was passed to a hook
  // (`scale`, from `useSharedValue`) inside a hook's own callback. These
  // are plain functions handed to `RNPressable`, which is not memoised, so
  // the wrapper bought nothing anyway.
  const handlePressIn = () => {
    setPressed(true);
    scale.value = withTiming(0.97, { duration: duration.press, easing: PRESS_EASING });
  };

  const handlePressOut = () => {
    setPressed(false);
    scale.value = withTiming(1, { duration: duration.press, easing: PRESS_EASING });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const resolvedAccessibilityState: AccessibilityState = {
    ...accessibilityState,
    disabled,
  };

  return (
    <RNPressable
      {...rest}
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      disabled={disabled}
      // §3 — the tap floor. A control shorter than 44/52px reaches it via
      // symmetric `hitSlop`, never by shrinking. Does not survive a
      // clipping parent (`overflow: hidden`) — note that where relevant.
      hitSlop={hitSlop}
      accessibilityState={resolvedAccessibilityState}
      style={containerStyle}
    >
      <Animated.View
        style={[animatedStyle, typeof style === 'function' ? style({ pressed }) : style]}
      >
        {typeof children === 'function' ? children({ pressed }) : children}
      </Animated.View>
    </RNPressable>
  );
}
