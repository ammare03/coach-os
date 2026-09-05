import { useWindowDimensions } from 'react-native';

import { useTextScale } from './TextScaleProvider.tsx';

/**
 * `accessibility` §3's ceiling. Past 2x the answer is to cap, not to keep
 * growing — a box that tracks an unbounded scale outgrows the phone rather
 * than the text outgrowing the box.
 */
export const MAX_BOX_TEXT_SCALE = 2;

/**
 * The multiplier a **non-text box** applies to keep pace with the text it
 * stands in for or encloses.
 *
 * React Native scales a `Text`'s glyphs by the OS font scale on its own, and
 * the gallery's `TextScaleProvider` scales them a second way
 * (`component-gallery/02`). A `View` sized in raw pixels tracks neither —
 * which is how a skeleton stops matching the text it reserves space for, and
 * how a ring stops containing its own numeral. Not exported from the package
 * barrel: a screen never needs this, only a primitive that draws a box around
 * type does.
 */
export function useBoxTextScale(): number {
  const { fontScale } = useWindowDimensions();
  const galleryScale = useTextScale();
  return Math.min(Math.max(fontScale, 1) * galleryScale, MAX_BOX_TEXT_SCALE);
}
