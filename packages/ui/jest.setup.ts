// Identical workaround to `apps/mobile/jest.setup.ts` — see that file's
// comment for the full explanation. Needed here too now that this package
// has its first real test file (`shared-config/04`'s "empty barrel" note
// no longer applies).
[
  'TextDecoder',
  'TextDecoderStream',
  'TextEncoderStream',
  'URL',
  'URLSearchParams',
  'DOMException',
  '__ExpoImportMetaRegistry',
  'structuredClone',
  'fetch',
].forEach((name) => {
  void (globalThis as Record<string, unknown>)[name];
});

// `react-native-reanimated` v4 (+ `react-native-worklets`) needs a native
// module Jest's Node environment cannot load — `Pressable`
// (`ui-primitives-core/01`) uses it for the shared press-scale animation,
// and every later pressable in P04 imports `Pressable`, so this has to be
// mocked once here rather than per test file.
//
// Reanimated's own shipped test double (`react-native-reanimated/mock`)
// re-imports the real `./index`, which still reaches into
// `react-native-worklets`' native module and throws in Jest's Node
// environment (`react-native-worklets` 0.10.1 ships no jest mock of its
// own, only a babel-plugin test helper) — so this is a minimal hand-rolled
// stand-in instead, covering exactly what `Pressable` calls: a shared
// value with a mutable `.value`, an animated style resolved eagerly (no
// real animation happens in a behavioural test), and `Easing.bezier`
// resolving to a no-op curve.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { bezier: () => (t: number) => t },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (toValue: unknown) => toValue,
  };
});

// `@gorhom/bottom-sheet` (`ui-primitives-core/04`) pulls in
// `react-native-gesture-handler`'s `GestureDetector`, which calls
// `Reanimated.default.createAnimatedComponent` at module scope — before any
// test body runs, so no per-test mock can reach it. Rather than grow the
// hand-rolled Reanimated double above until it satisfies the whole of
// gorhom's internals (a moving target across minor versions), the library
// itself is replaced with a structural stand-in.
//
// That is the right seam anyway: `Sheet`'s own contract is what this
// package tests — does it mount its children, does it resolve the right
// snap points, does `isDismissible={false}` disable every gesture — and
// the snap/gesture rules are extracted as pure functions precisely so they
// can be asserted without the library at all. The behaviour that genuinely
// belongs to gorhom (the drag, the keyboard interaction, the Android back
// button) is not unit-testable and is verified on hardware instead.
jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  // `createElement`, not JSX — this setup file is `.ts`, not `.tsx`.
  const passthrough = ({ children, ...rest }: Record<string, unknown>) =>
    createElement(View, rest, children);
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
