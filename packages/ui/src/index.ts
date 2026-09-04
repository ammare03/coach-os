// Barrel. Full P04 `theme-tokens`/`ui-primitives-core` will replace most
// of what's exported below with the real, fully-specced versions — these
// are minimal implementations built ahead of that phase to unblock
// `phase-03-identity-and-auth/auth-client/05` (see each file's own doc
// comment for what's deferred).
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button.tsx';
export { FormField, type FormFieldProps } from './components/FormField.tsx';
export { Input, type InputProps, type InputState } from './components/Input.tsx';
export { Metric, type MetricProps } from './components/Metric.tsx';
export { Pressable } from './components/Pressable.tsx';
export { Text, type TextProps, type TextTone } from './components/Text.tsx';
export {
  ThemeProvider,
  type ThemeProviderProps,
  type ThemeContextValue,
} from './theme/ThemeProvider.tsx';
export { useTheme } from './theme/useTheme.ts';
export type { Scheme } from './theme/schemes.ts';
export {
  GlassSurface,
  type GlassSurfaceProps,
  type GlassSurfaceStyle,
} from './surfaces/GlassSurface.tsx';
export { colors, radius, spacing, fontFamily, fontSize } from './theme/tokens.ts';
