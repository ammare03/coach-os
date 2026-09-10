// The scheme-INVARIANT tokens, plus the DARK derivation of the
// scheme-dependent groups. A component reads the latter through
// `useTheme()`, never from here (`component-gallery/04`).
export {
  colors,
  radius,
  spacing,
  spacingSteps,
  SPACING_STEPS,
  density,
  tapTarget,
  elevation,
  glass,
  dataviz,
  selectionPill,
  duration,
  easing,
  stagger,
  scrim,
  control,
  fontFamily,
  fontSize,
  type ColorTokens,
  type RadiusTokens,
  type FontFamilyTokens,
  type TextSize,
  type SpacingStep,
  type Density,
  type ElevationLevel,
  type GlassTier,
} from './tokens.ts';

export { schemes, schemeInk, schemeTokens, type Scheme } from './schemes.ts';
export {
  DARK_INK,
  darkSchemeTokens,
  deriveSchemeTokens,
  skeleton,
  type SchemeColors,
  type SchemeInk,
  type SchemeTokens,
} from './tokens.ts';
export { ThemeProvider, ThemeContext, type ThemeContextValue } from './ThemeProvider.tsx';
export { useTheme, DEFAULT_THEME } from './useTheme.ts';
export { createThemedStyles, createThemedValue } from './createThemedStyles.ts';
// A feature composing a translucent fill from a scheme colour it read
// through `useTheme()` — a chip tinted `brand` at 14%, a well at 50% —
// needs the same composition `deriveSchemeTokens` uses. Exported so that is
// one function rather than an rgba literal per call site, which would
// hardcode the default brand and break a white-label override
// (`tokens.ts`'s own note on why nothing imports `colors` directly).
export { withAlpha, hexToRgbChannels } from './to-rgb-channels.ts';
export { useReducedMotion } from './useReducedMotion.ts';
