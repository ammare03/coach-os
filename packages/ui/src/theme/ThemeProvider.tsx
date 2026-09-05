import { generateBrandRamp, isValidHexColor } from '@coachos/utils';
import { vars } from 'nativewind';
import { createContext, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';

import { schemeInk, schemes, schemeTokens, type Scheme } from './schemes.ts';
import { flattenColorChannels } from './to-rgb-channels.ts';
import {
  deriveSchemeTokens,
  colors as defaultColors,
  type SchemeColors,
  type SchemeTokens,
} from './tokens.ts';

// Deliberately not NativeWind's `darkMode: 'class'` + `colorScheme` API
// (theme-tokens/04's own approach text assumes it). That mechanism always
// treats its toggle class as the *dark* override on top of a light
// default — backwards for a dark-first product, and CoachOS never writes a
// `dark:` variant utility anywhere, so there's nothing to gain from it.
// `vars()` sets the same CSS custom properties `tokens.ts`/`global.css`
// already define, from plain React state — one mechanism for both the
// scheme switch and P25's white-label brand override.
//
// The context carries the scheme's DERIVED groups as well as its colours
// (`component-gallery/04`). Before that task the context published only
// `colors` and had no consumers at all, so every colour a component set in
// a JavaScript `style` object came from a module-level import of the dark
// table and never changed with the scheme. Publishing the groups here is
// what makes `scheme="light"` reach the screen.
export type ThemeContextValue = {
  scheme: Scheme;
  colors: SchemeColors & {
    brand: ReturnType<typeof generateBrandRamp>;
    /** §1.1's primary fill. Scheme-invariant — light keeps the same peach gradient and the same dark `fg.onBrand` ink on it. */
    primary: typeof defaultColors.primary;
  };
} & SchemeTokens;

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  /** Defaults to dark — the light scheme is reachable only by explicit prop (`CLAUDE.md` §7.1). */
  scheme?: Scheme;
  /** A coach's `coach_profiles.brand_primary_color` (P25). Falls back to the default ember-peach ramp on anything invalid. */
  brandPrimaryColor?: string | null;
  children: ReactNode;
};

export function ThemeProvider({
  scheme = 'dark',
  brandPrimaryColor,
  children,
}: ThemeProviderProps) {
  const schemeColors = schemes[scheme];
  // Same default ramp either way an override is absent — an invalid hex
  // must degrade to exactly the CoachOS accent, not a slightly-different
  // clamped variant of it (`DESIGN.md` §1.1).
  const brand = useMemo(
    () =>
      isValidHexColor(brandPrimaryColor)
        ? generateBrandRamp(brandPrimaryColor)
        : defaultColors.brand,
    [brandPrimaryColor],
  );

  const cssVars = useMemo(
    () => ({
      ...flattenColorChannels(schemeColors),
      ...flattenColorChannels({ brand }),
    }),
    [schemeColors, brand],
  );

  // The precomputed column when there is no white-label override, which is
  // every case today: composing it per provider would allocate seven
  // objects for a result `schemes.ts` already holds.
  const tokens = useMemo(
    () =>
      brand === defaultColors.brand
        ? schemeTokens[scheme]
        : deriveSchemeTokens(schemeColors, schemeInk[scheme], brand),
    [scheme, schemeColors, brand],
  );

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: { ...schemeColors, brand, primary: defaultColors.primary },
      ...tokens,
    }),
    [scheme, schemeColors, brand, tokens],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <View style={vars(cssVars)} className="flex-1">
        {children}
      </View>
    </ThemeContext.Provider>
  );
}
