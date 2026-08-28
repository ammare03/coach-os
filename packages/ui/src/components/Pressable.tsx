import { Pressable as RNPressable, type PressableProps } from 'react-native';

// The one press treatment in the product (`ui-primitives-core/01`'s
// "Why this exists"): opacity never changes on press — it drops label
// contrast below 4.5:1 for the duration of the press — so every pressable
// wraps this instead of `TouchableOpacity`. Callers apply the "one level
// darker" surface step themselves via `pressed` in their own style
// function; this wrapper only forwards RN `Pressable`'s render-prop shape
// so that decision lives in one place conceptually, even before the full
// P04 `Pressable.tsx` (shared by `Chip`, `SegmentedControl`, etc.) lands.
export function Pressable(props: PressableProps) {
  return <RNPressable {...props} />;
}
