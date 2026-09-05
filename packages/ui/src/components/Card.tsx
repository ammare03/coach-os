import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import {
  density as densityTokens,
  radius,
  type Density,
  type ElevationLevel,
} from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { Pressable, type PressableRenderState } from './Pressable.tsx';

export type CardElevation = ElevationLevel;

export interface CardProps {
  /**
   * DESIGN.md §2 — five levels, L0–L3 here (L4 glass is a composite that
   * needs blur; it lives in `GlassSurface`, not `Card`). A surface sits on
   * exactly one:
   *   - `canvas` (L0) — the app background itself. Rarely a `Card`; kept
   *     for completeness of the ladder and for a card that needs to sit
   *     flush with the screen.
   *   - `inset`  (L1) — recessed wells. `Input`'s well, track backgrounds.
   *   - `raised` (L2) — the workhorse. Gradient fill, hairline top
   *     highlight, soft drop shadow. **Default.**
   *   - `tinted` (L3) — the only way to say "this one is different"
   *     without colour-coding it (needs-attention rows, edited blocks).
   *
   * A card never contains a card at the same or a lower level — nest
   * `raised` inside `raised` and the border between them disappears.
   */
  elevation?: CardElevation;
  density?: Density;
  /** Turns the card into a control: `accessibilityRole="button"` and the shared press treatment. A card with no `onPress` is a container, never focusable. */
  onPress?: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * DESIGN.md §12 REQUIRES shadow and the inset-edge hairline trick on a
 * raised surface — this supersedes `ui-primitives-core/02`'s original
 * "do not add shadow" call, which predates the DESIGN.md rewrite
 * (CONTRACT.md §1). React Native has no inset `box-shadow`; `raised`
 * fakes the top highlight with an absolutely-positioned 1px line, and the
 * outer drop shadow comes straight from `elevation.raised.shadow` in
 * `tokens.ts` — never a value invented here.
 */
export function Card({
  elevation: level = 'raised',
  density: densityProp = 'client',
  onPress,
  children,
  accessibilityLabel,
  testID,
}: CardProps) {
  const { elevation } = useTheme();
  const themed = useThemedStyles();
  const padding = densityTokens[densityProp].cardPadding;
  const recipe = elevation[level];
  const hasGradient = level === 'raised' || level === 'tinted';
  const hasShadow = level === 'raised';
  const hasTopHighlight = level === 'raised';

  const content = (pressed: boolean) => (
    <View
      style={[
        styles.surface,
        {
          borderRadius: level === 'canvas' ? 0 : radius.card,
          backgroundColor:
            !hasGradient && 'backgroundColor' in recipe ? recipe.backgroundColor : undefined,
          borderWidth: 'borderWidth' in recipe ? recipe.borderWidth : 0,
          borderColor: 'borderColor' in recipe ? recipe.borderColor : undefined,
        },
        hasShadow && 'shadow' in recipe ? recipe.shadow : undefined,
      ]}
    >
      {hasGradient && 'gradient' in recipe && (
        <LinearGradient
          colors={recipe.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {hasTopHighlight && 'highlight' in recipe && (
        <View
          pointerEvents="none"
          style={[styles.topHighlight, { backgroundColor: recipe.highlight }]}
        />
      )}
      {/* Pressed-state surface step (CONTRACT.md rule 2): a tint BELOW the
          content, never the container's own `opacity` — text stays at full
          contrast through the press. */}
      {onPress && pressed && <View pointerEvents="none" style={themed.pressedTint} />}
      <View style={{ padding }}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={{ borderRadius: level === 'canvas' ? 0 : radius.card, overflow: 'hidden' }}
      >
        {({ pressed }: PressableRenderState) => content(pressed)}
      </Pressable>
    );
  }

  return (
    <View testID={testID} accessible={false}>
      {content(false)}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

// The one colour this component sets itself; the rest come from the
// scheme's own `elevation` recipe above.
const useThemedStyles = createThemedStyles((theme) => ({
  pressedTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.control.pressScrim,
  },
}));
