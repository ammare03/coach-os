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
    // `Skeleton` (`ui-primitives-data/06`) loops its shimmer sweep; the
    // double resolves the loop to its target so nothing animates in a
    // behavioural test, and cancellation is a no-op with nothing running.
    withRepeat: (value) => value,
    cancelAnimation: () => undefined,
    runOnJS: (fn) => fn,
    interpolate: (value) => value,
  };
};
