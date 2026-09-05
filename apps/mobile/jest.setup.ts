// The one place a native module or global gets patched for Jest, so the
// fix is defined once and stays consistent across every test file
// (quality-gates/01). jest-expo's own preset already mocks the Expo
// modules it knows about (expo-font, expo-asset, expo-constants, …); add
// an entry here only when a test actually needs one, with a comment
// naming why.

// `expo`'s WinterCG runtime (expo/src/winter/installGlobal.ts) defines a
// batch of globals — TextDecoder, URL, DOMException, structuredClone,
// __ExpoImportMetaRegistry, fetch, … — as *lazy* getters that each call
// `require()` the first time anything reads them. Jest's own
// worker/result-serialization machinery reads several of these again after
// a test file's synchronous scope has already closed, and Jest forbids a
// `require()` at that point — "You are trying to `require` a file outside
// of the scope of the test code." Touching every one of them once here,
// inside the allowed window, resolves each to a plain value before Jest
// ever gets a chance to trip over the lazy path.
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

// Shared native-module stand-ins (Reanimated, @gorhom/bottom-sheet) — one
// copy, in `@coachos/config`, since `packages/ui` needs exactly the same
// two and a second copy would drift.
require('@coachos/config/jest.native-mocks');

// `providers-and-gates/05`. `src/app/_layout.tsx` calls `initSentry()` at
// module scope, so every test that renders the root layout pulls in
// `@sentry/react-native` — which resolves to its untranspiled `src/js` entry
// and from there to `@sentry/core`'s ESM build, neither of which jest-expo's
// `transformIgnorePatterns` covers. Mocked here rather than widening that
// pattern: transforming two more ESM packages in node_modules would slow
// every suite down to spin up an SDK that must not send anything from a test
// run anyway. `init` is the only member the app calls; `src/lib/sentry.ts`'s
// own test declares its own copy of this mock so it can assert on the call.
// This mock lives in apps/mobile only — packages/ui imports no Sentry.
jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));
