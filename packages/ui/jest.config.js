// React Native preset via @coachos/config/jest.react-native
// (quality-gates/01). `setupFilesAfterEnv` mirrors `apps/mobile/jest.
// config.js` — same WinterCG-global workaround, needed now that this
// package has real test files (`Button.test.tsx`, `auth-client/05`'s
// minimal primitives).
const reactNativePreset = require('@coachos/config/jest.react-native');
// `@coachos/config/jest.react-native` only sets `preset: 'jest-expo'` as a
// string — Jest resolves that preset's own `moduleNameMapper` later, in
// its config loader, not here, so it has to be read directly from
// `jest-expo` to extend it rather than clobber it.
//
// `lucide-react-native` (`ui-primitives-core/01`/`03`'s icon dependency —
// `Input`'s clear affordance, `FormField`'s error glyph) publishes a
// `"react-native"` package.json condition pointing at its ESM build only;
// jest-expo's resolver honours that condition ahead of `"require"`, so
// Jest always resolves the untransformed `.mjs` entry regardless of
// `transformIgnorePatterns`. Map it straight to the package's own CJS
// build instead of fighting the resolver.
const jestExpoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  ...reactNativePreset,
  moduleNameMapper: {
    ...jestExpoPreset.moduleNameMapper,
    // Plain Node `require.resolve` (unlike jest-expo's own resolver)
    // honours the package's `"require"` export condition, which already
    // points at the CJS build — no need to hardcode the subpath.
    '^lucide-react-native$': require.resolve('lucide-react-native'),
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
