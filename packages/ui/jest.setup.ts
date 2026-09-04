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

// The Reanimated and bottom-sheet stand-ins live in `@coachos/config` so
// this package and `apps/mobile` cannot drift apart — see that file for why
// each is needed.
require('@coachos/config/jest.native-mocks');
