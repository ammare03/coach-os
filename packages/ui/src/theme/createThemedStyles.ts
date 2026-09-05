import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { type ThemeContextValue } from './ThemeProvider.tsx';
import { useTheme } from './useTheme.ts';

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * A `StyleSheet` that depends on the active scheme, without paying for it
 * on every render.
 *
 * `StyleSheet.create` at module scope bakes the dark table in
 * (`component-gallery/04`'s defect); moving the call into the component
 * body fixes the colour and reallocates the whole sheet on every render,
 * which `AdherenceDot`, `Metric`, and `SkeletonText` cannot afford — they
 * render 200+ times in one coach dashboard (`CLAUDE.md` §19, ≥55fps).
 *
 * So the sheet is built once per THEME OBJECT and cached against it in a
 * `WeakMap`. There are two theme identities in the product (dark and
 * light, plus one more per white-label brand), each stable for the life of
 * the provider, so the factory runs twice in total rather than once per
 * render — and the map holds no strong reference, so a discarded theme is
 * collectable.
 *
 * Keep everything that does NOT carry a colour in a plain module-level
 * `StyleSheet.create` beside it: layout, flex, gaps, and positions are
 * scheme-invariant and belong at module scope where they cost nothing.
 */
export function createThemedStyles<T extends NamedStyles>(
  factory: (theme: ThemeContextValue) => T,
): () => T {
  const cache = new WeakMap<ThemeContextValue, T>();

  return function useThemedStyles(): T {
    const theme = useTheme();
    const cached = cache.get(theme);
    if (cached) return cached;
    const created = StyleSheet.create(factory(theme));
    cache.set(theme, created);
    return created;
  };
}

/**
 * The same cache for a value that is not a `StyleSheet` — a per-state
 * visual record, a resolved palette, a gradient pair. Same contract: the
 * factory runs once per theme identity, never per render.
 */
export function createThemedValue<T>(factory: (theme: ThemeContextValue) => T): () => T {
  const cache = new WeakMap<ThemeContextValue, { value: T }>();

  return function useThemedValue(): T {
    const theme = useTheme();
    const cached = cache.get(theme);
    if (cached) return cached.value;
    const value = factory(theme);
    cache.set(theme, { value });
    return value;
  };
}
