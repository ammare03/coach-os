// The two native-module stand-ins every React Native test suite in this
// repo needs, in one file so `apps/mobile` and `packages/ui` cannot drift
// apart. Both are `jest.mock` calls with module-factory arguments, so this
// file must be required from a `setupFilesAfterEach` entry, not imported.
//
// Add an entry here only when a test actually needs one, with a comment
// naming why — jest-expo's own preset already mocks the Expo modules it
// knows about (expo-font, expo-asset, expo-constants, …).
'use strict';

// `react-native-reanimated` v4 (+ `react-native-worklets`) reads a native
// module at import time, which Jest's Node environment cannot provide —
// it throws `Cannot read properties of undefined (reading 'loadUnpackers')`
// before any test body runs. `Pressable` (`ui-primitives-core/01`) uses
// Reanimated for the shared press-scale, and every pressable in P04 imports
// `Pressable`, so this reaches nearly every component test transitively.
//
// Reanimated's own shipped double (`react-native-reanimated/mock`)
// re-imports the real `./index`, which reaches the same native module and
// throws identically; `react-native-worklets` 0.10.1 ships no Jest mock of
// its own. Hence this minimal hand-rolled stand-in, covering exactly what
// the components call: a shared value with a mutable `.value`, an animated
// style resolved eagerly (no real animation happens in a behavioural test),
// and `Easing.bezier` resolving to a no-op curve.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const identity = (value) => value;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: identity },
    Easing: { bezier: () => (t) => t },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (factory) => factory(),
    useDerivedValue: (factory) => ({ value: factory() }),
    withTiming: identity,
    withSpring: identity,
    withDelay: (_delay, value) => value,
    // `Skeleton` (`ui-primitives-data/06`) loops its shimmer sweep; the
    // double resolves the loop to its target so nothing animates in a
    // behavioural test, and cancellation is a no-op with nothing running.
    withRepeat: (value) => value,
    cancelAnimation: () => undefined,
    runOnJS: (fn) => fn,
    interpolate: (value) => value,
  };
});

// `@gorhom/bottom-sheet` (`ui-primitives-core/04`) pulls in
// `react-native-gesture-handler`'s `GestureDetector`, which calls
// `Reanimated.default.createAnimatedComponent` at module scope — before any
// test body runs, so no per-test mock can reach it. Rather than grow the
// Reanimated double above until it satisfies the whole of gorhom's
// internals (a moving target across minor versions), the library itself is
// replaced with a structural stand-in.
//
// That is the right seam anyway: `Sheet`'s own contract is what we test —
// does it mount its children, does it resolve the right snap points, does
// `isDismissible={false}` disable every gesture — and the snap and gesture
// rules are extracted as pure functions precisely so they can be asserted
// without the library at all. The behaviour that genuinely belongs to
// gorhom (the drag, the keyboard interaction, the Android back button) is
// not unit-testable and is verified on hardware instead.
jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  // `createElement`, not JSX — this is a plain `.js` setup file.
  const passthrough = ({ children, ...rest }) => createElement(View, rest, children);
  return {
    __esModule: true,
    default: passthrough,
    BottomSheetView: passthrough,
    BottomSheetModal: passthrough,
    BottomSheetModalProvider: passthrough,
    BottomSheetBackdrop: passthrough,
    BottomSheetScrollView: passthrough,
    BottomSheetFlatList: passthrough,
    BottomSheetTextInput: passthrough,
  };
});
