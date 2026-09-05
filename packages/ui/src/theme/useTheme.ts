import { useContext } from 'react';

import { schemes } from './schemes.ts';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider.tsx';
import { colors, darkSchemeTokens } from './tokens.ts';

/**
 * What `useTheme()` resolves to with no `<ThemeProvider>` above it: the
 * dark scheme, the default brand ramp, and the dark derivation of every
 * scheme-dependent group.
 *
 * A module-level constant, not a fresh object per call — component styles
 * are cached against the identity of the theme (`createThemedStyles`), and
 * a new object per render would defeat that on every bare-rendered tree.
 */
export const DEFAULT_THEME: ThemeContextValue = {
  scheme: 'dark',
  colors: { ...schemes.dark, brand: colors.brand, primary: colors.primary },
  ...darkSchemeTokens,
};

/**
 * The single way a component reads a scheme-dependent colour in JavaScript
 * — an SVG `fill`/`stroke`, a gradient stop, a Reanimated colour target, a
 * `StyleSheet` value that has no class-name equivalent. Anything that CAN
 * be a `className` still should be: `text-fg-muted` already follows the
 * scheme through NativeWind's CSS variables and costs nothing.
 *
 * **Returns the dark scheme outside a provider rather than throwing.**
 * `ThemeProvider`'s own `scheme` prop defaults to dark, so the default is
 * the same answer the provider would give; and every primitive in
 * `packages/ui` must stay renderable bare, which is how ~30 of its test
 * files render them (`component-gallery/04`). A hook that throws is not a
 * usable escape hatch — it just guarantees nobody uses it, which is the
 * defect this task exists to fix.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? DEFAULT_THEME;
}
