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
// The double itself lives in `./jest-doubles/reanimated.js` — it is
// registered twice below, and `babel-plugin-jest-hoist` requires each
// `jest.mock` factory to be an inline function that closes over nothing.
// An inline factory may still `require`, which is how one definition
// serves both registrations.
jest.mock('react-native-reanimated', () => require('./jest-doubles/reanimated.js')());

// The same double under the SUB-PATH, and it is load-bearing for every
// route test. `expo-router/testing-library` (build/testing-library/mocks.js)
// overrides whatever is registered for `react-native-reanimated` with its
// own factory, which is `require('react-native-reanimated/mock')` inside a
// `try` whose fallback is `{}`. On Reanimated 4 that shipped mock reaches
// the missing native module and throws, so the module resolves to an empty
// object — and any route that transitively imports `@coachos/ui` then dies
// at module scope on `Pressable`'s `Easing.bezier`, before a test body runs.
//
// Mocking the sub-path is the smallest lever that fixes it: expo-router's
// factory requires exactly this specifier, so satisfying it makes the
// override resolve to a working double instead of `{}`. Found independently
// by `phase-05-app-shell/router-skeleton/` tasks 03 and 04, each of which
// had been carrying a local copy.
jest.mock('react-native-reanimated/mock', () => require('./jest-doubles/reanimated.js')());

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

// `@shopify/react-native-skia` (`ui-primitives-data/02`) is a native module —
// its JS entry reaches for the Skia C++ bindings at import time, which Jest's
// Node environment cannot provide.
//
// The library ships its own `jestSetup.js`, and it is deliberately NOT used:
// it swaps in the CanvasKit WebAssembly build, which needs a custom Jest
// environment (`jestEnv.js`), loads a multi-megabyte `.wasm` on every worker,
// and buys a real rasteriser we then never look at — no test in this repo
// asserts a pixel. What `ProgressRing` actually owes a test is its sweep
// arithmetic (extracted as `progressRingSweep`, asserted directly) and its
// accessibility contract (asserted on the rendered tree). Neither needs Skia
// to draw anything, so the seam is the drawing itself.
//
// `Skia.Path.Make()` returns a chainable recorder rather than `undefined`
// so a component that builds a path still runs its real geometry code — a
// silent no-op here would let a `NaN` radius through a test that then passes.
jest.mock('@shopify/react-native-skia', () => {
  const { View } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  const passthrough = ({ children, ...rest }) => createElement(View, rest, children);
  const nullRender = () => null;
  // `Path` takes paint children (a gradient, a dash effect) but is not a
  // layout box — rendering it as a `View` would put Skia's own props
  // (`style="stroke"`, an `SkPath` object) through React Native's style
  // handling. Rendering only its children keeps the tree identical to what
  // it was when `Path` was a null render, for every component that passes
  // none.
  const childrenOnly = ({ children }) => children ?? null;

  const makePath = () => {
    const path = {
      commands: [],
      addCircle(...args) {
        path.commands.push(['addCircle', ...args]);
        return path;
      },
      addArc(...args) {
        path.commands.push(['addArc', ...args]);
        return path;
      },
      addRect(...args) {
        path.commands.push(['addRect', ...args]);
        return path;
      },
      // `LineChart`/`Sparkline` (`ui-primitives-data/04`) build their series
      // from segments rather than from a single primitive, so the recorder
      // has to accept them for the real geometry code to run — a missing
      // method here would throw before the domain and gap rules were ever
      // exercised.
      moveTo(...args) {
        path.commands.push(['moveTo', ...args]);
        return path;
      },
      lineTo(...args) {
        path.commands.push(['lineTo', ...args]);
        return path;
      },
      close() {
        path.commands.push(['close']);
        return path;
      },
    };
    return path;
  };

  return {
    __esModule: true,
    Canvas: passthrough,
    Group: passthrough,
    Path: childrenOnly,
    Circle: nullRender,
    Rect: nullRender,
    RoundedRect: nullRender,
    Line: nullRender,
    // Paint children of a `<Path>` — the area fill's gradient and the
    // dashed gap/reference strokes (`DESIGN.md` §7). They render nothing in
    // a test; `Path` passes its children through so a missing one would be
    // a mount error rather than a silent omission.
    LinearGradient: nullRender,
    DashPathEffect: nullRender,
    vec: (x, y) => ({ x, y }),
    Skia: { Path: { Make: makePath } },
  };
});

// `react-native-gesture-handler`'s `GestureHandlerRootView` calls
// `RNGestureHandlerModule.install()` during render, and the root layout
// (`providers-and-gates/01`) mounts it at the true root of the app — so any
// test that renders the real tree hits a native module Jest's Node
// environment cannot provide. Unlike Reanimated's, the library's own shipped
// Jest setup works: it swaps in the mocks that live alongside it. Required
// here rather than per-suite so `apps/mobile` and `packages/ui` share one
// registration.
require('react-native-gesture-handler/jestSetup');
