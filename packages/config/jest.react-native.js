// React Native / Expo preset for apps/mobile and packages/ui.
//
// jest-expo (Expo's own Jest preset) supplies the transformer, the
// module-name mapper, and the default native-module mocks for this SDK —
// this file only layers CoachOS's cross-cutting settings on top of it.
// Do not try to hand-roll the transform-ignore pattern here; jest-expo's
// is kept in step with each Expo SDK release and a hand-rolled one drifts.
const base = require('./jest.base');

// Setting `preset: 'jest-expo'` as a string means Jest resolves that
// preset's own `moduleNameMapper` later, in its config loader — so it has
// to be read directly from `jest-expo` here to EXTEND it rather than
// clobber it.
const jestExpoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  preset: 'jest-expo',
  moduleNameMapper: {
    ...jestExpoPreset.moduleNameMapper,
    // `lucide-react-native` (the icon set, `CLAUDE.md` §3.1) publishes a
    // `"react-native"` package.json condition pointing at its ESM build
    // only, and jest-expo's resolver honours that condition ahead of
    // `"require"` — so Jest resolves the untransformed `.mjs` entry
    // whatever `transformIgnorePatterns` says. Map it straight to the
    // package's CJS build instead of fighting the resolver. Plain Node
    // `require.resolve` honours the `"require"` condition, which already
    // points there, so the subpath does not need hardcoding.
    '^lucide-react-native$': require.resolve('lucide-react-native'),
  },
};
