import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeProvider.tsx';

/**
 * For JavaScript that genuinely cannot use a class name — SVG `fill`/
 * `stroke`, a Reanimated colour target, the status-bar style
 * (theme-tokens/04). **Not** the general way to style anything; a
 * component that calls this to build a `style` object is doing by hand
 * what `className` does for free (`ui-conventions` §10).
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme() must be called within a <ThemeProvider>.');
  }
  return value;
}
