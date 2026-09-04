// The only file in the repository that may contain a colour, a radius, or a
// spacing value (theme-tokens/02). `DESIGN-SYSTEM.md` DS§2/DS§4 is the source
// of truth for every value below — this file never invents one.
//
// This holds the DARK column only (DS§2.2/2.4/2.5/2.6) — dark is the
// designed scheme and the default (`CLAUDE.md` §7.1). The light column and
// the role→per-scheme restructuring land in `theme-tokens/04`
// (`packages/ui/src/theme/schemes.ts`); nothing here is a computed value.
//
// Nothing outside `packages/ui/src/theme/**` may import `colors` directly —
// `brand` is overridden per coach on Studio+ (white-label, `CLAUDE.md`
// §15.2), so a component that reads `colors.brand.DEFAULT` in JS bakes in
// the default forever. Use a `bg-brand` class, or (for genuine non-Tailwind
// consumers — SVG fills, Reanimated targets) `useTheme()` from
// `theme-tokens/04`.
export const colors = {
  bg: {
    sunken: '#06080B',
    DEFAULT: '#0A0D12',
    raised: '#12161D',
    overlay: '#1A1F28',
    inset: '#0E1218',
  },
  fg: {
    DEFAULT: '#F2F5F9',
    muted: '#97A2B4',
    subtle: '#5F6C7E',
    onBrand: '#FFFFFF',
  },
  border: {
    subtle: '#1E242E',
    DEFAULT: '#2A323F',
    strong: '#3A4553',
  },
  // Indigo. DS§2.4 — chosen over blue deliberately; every competitor in the
  // category is blue. Ten stops written out literally rather than imported
  // from a palette library so P25's white-label generator has a concrete
  // shape to reproduce from a coach's single hex.
  brand: {
    50: '#EEF0FF',
    100: '#E0E3FF',
    200: '#C7CBFE',
    300: '#A5A9FB',
    400: '#868CF8',
    DEFAULT: '#6366F1',
    500: '#6366F1',
    600: '#4F52E0',
    700: '#4144BE',
    800: '#373A9A',
    900: '#31347A',
  },
  // Adherence state — DS§2.5. Reserved for adherence surfaces only; never
  // decorative (`theme-tokens/05` enforces this by lint).
  state: {
    onTrack: '#10B981',
    drifting: '#F59E0B',
    offTrack: '#F43F5E',
    noData: '#6B7280',
  },
  // DS§2.6 — other semantics.
  realtime: '#06B6D4',
  danger: '#F43F5E',
  pr: '#FBBF24',
} as const;

// DS§4 — sm 8 · md 12 · lg 16 · xl 24 · full 999.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

// DS§4 — 4-point scale, step 1 (4px) through step 16 (64px) and nothing
// else. Overrides Tailwind's default spacing scale wholesale
// (theme-tokens/02 approach §3): the scale is a constraint or it is
// decoration. A function, not a lookup object, so existing call sites
// (`spacing(4)`) keep working; `spacingSteps` is the same scale as data, for
// the Tailwind preset and the token test.
export const SPACING_STEP_COUNT = 16;

/** `spacing(4)` is 16px. Throws outside the 1..16 scale — see DS§4. */
export function spacing(steps: number): number {
  if (!Number.isInteger(steps) || steps < 1 || steps > SPACING_STEP_COUNT) {
    throw new Error(
      `spacing: step must be an integer from 1 to ${SPACING_STEP_COUNT}, got ${steps}`,
    );
  }
  return steps * 4;
}

export const spacingSteps: readonly number[] = Array.from(
  { length: SPACING_STEP_COUNT },
  (_, i) => i + 1,
);

// DS§3 — Inter (UI, body) and Inter Tight (numerals, display). Each weight
// is a separate family name (theme-tokens/03 approach §3) — React Native
// does not reliably resolve `fontWeight` against a single family, so
// `Text`/`Metric` pick a *family*, never a `fontWeight`.
// Kebab-case keys — Tailwind emits `font-${key}` verbatim, so a camelCase
// key here would produce an unusable `font-sansMedium` class.
export const fontFamily = {
  sans: 'Inter-Regular',
  'sans-medium': 'Inter-Medium',
  'sans-semibold': 'Inter-SemiBold',
  display: 'InterTight-Medium',
  'display-semibold': 'InterTight-SemiBold',
  'display-bold': 'InterTight-Bold',
} as const;

// DS§3.1 — the closed ten-step scale. Each entry is `[size, { lineHeight,
// letterSpacing }]`, Tailwind's tuple form for `fontSize`, which this
// overrides wholesale, not extends (`text-3xl` and Tailwind's other
// defaults must not exist). Letter-spacing is -0.02em on the three largest
// display sizes and 0 everywhere else (DS§3.1).
export const fontSize = {
  display: [64, { lineHeight: '64px', letterSpacing: '-0.02em' }],
  hero: [48, { lineHeight: '48px', letterSpacing: '-0.02em' }],
  metric: [32, { lineHeight: '36px', letterSpacing: '-0.02em' }],
  'metric-sm': [24, { lineHeight: '28px', letterSpacing: '0' }],
  title: [20, { lineHeight: '28px', letterSpacing: '0' }],
  heading: [17, { lineHeight: '24px', letterSpacing: '0' }],
  body: [16, { lineHeight: '24px', letterSpacing: '0' }],
  'body-sm': [15, { lineHeight: '22px', letterSpacing: '0' }],
  label: [13, { lineHeight: '18px', letterSpacing: '0' }],
  caption: [12, { lineHeight: '16px', letterSpacing: '0' }],
} as const;

export type ColorTokens = typeof colors;
export type RadiusTokens = typeof radius;
export type FontFamilyTokens = typeof fontFamily;
export type TextSize = keyof typeof fontSize;
