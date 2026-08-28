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
