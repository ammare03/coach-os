// React Native preset via @coachos/config/jest.react-native
// (quality-gates/01). No tests yet — the package is still an empty barrel
// (shared-config/04) — so this only needs to prove that a workspace with
// zero test files passes rather than errors (`passWithNoTests`, set in the
// shared jest.base preset).
const reactNativePreset = require('@coachos/config/jest.react-native');

/** @type {import('jest').Config} */
module.exports = {
  ...reactNativePreset,
};
