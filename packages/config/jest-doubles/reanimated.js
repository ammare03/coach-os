// The `react-native-reanimated` stand-in, in its own module so
// `jest.native-mocks.js` can register it under BOTH the package specifier
// and the `/mock` sub-path without duplicating it. It cannot live inline in
// either factory: `babel-plugin-jest-hoist` requires `jest.mock`'s second
// argument to be an inline function, and an inline function may not close
// over a shared one — but it may `require`, which is on the plugin's
// allowlist. Hence a module, called from both factories.
//
// Covers exactly what this repo's components call: a shared value with a
// mutable `.value`, an animated style resolved eagerly (no real animation
// happens in a behavioural test), and `Easing.bezier` resolving to a no-op
// curve.
'use strict';

module.exports = function reanimatedDouble() {
  const { View } = jest.requireActual('react-native');
  const identity = (value) => value;
  return {
    __esModule: true,
    // `call` and the bare `View` export are what `expo-router`'s own
    // testing-library double reaches for; the package specifier alone
    // never needed them.
    default: { View, createAnimatedComponent: identity, call: () => undefined },
    View,
    Easing: { bezier: () => (t) => t },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (factory) => factory(),
    useDerivedValue: (factory) => ({ value: factory() }),
    withTiming: identity,
    withSpring: identity,
    withDelay: (_delay, value) => value,
    // The PR pill's `prpop` overshoot (`personal-records/03`) is two
    // segments — .86 → 1.05 → 1. Resolved to the LAST value, which is the
    // end state a behavioural test asserts on; the overshoot in between is
    // a UI-thread interpolation and is verified on hardware.
    withSequence: (...values) => values[values.length - 1],
    // `Skeleton` (`ui-primitives-data/06`) loops its shimmer sweep; the
    // double resolves the loop to its target so nothing animates in a
    // behavioural test, and cancellation is a no-op with nothing running.
    withRepeat: (value) => value,
    cancelAnimation: () => undefined,
    runOnJS: (fn) => fn,
    interpolate: (value) => value,
    // The three members `react-native-gesture-handler`'s own
    // `handlers/gestures/reanimatedWrapper.ts` probes for before it will
    // mount a `<GestureDetector>` (`program-builder/03`'s draggable list is
    // the first real one in the app). Without them RNGH either throws
    // `Reanimated.useEvent is not a function` or silently drops to its
    // non-Reanimated path — and the second is worse, because the tree still
    // renders and the failure only shows up as a gesture that never fires.
    //
    // No-ops on purpose: a drag is a UI-thread, native-driven interaction
    // and is verified on hardware, exactly as `@gorhom/bottom-sheet`'s is
    // below. What a component test owns is the tree the detector wraps —
    // its labels, its roles, and its non-gesture path.
    useEvent: () => () => undefined,
    setGestureState: () => undefined,
  };
};
