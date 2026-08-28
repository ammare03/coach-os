// React Native preset via @coachos/config/jest.react-native
// (quality-gates/01). `setupFilesAfterEnv` mirrors `apps/mobile/jest.
// config.js` — same WinterCG-global workaround, needed now that this
// package has real test files (`Button.test.tsx`, `auth-client/05`'s
// minimal primitives).
const reactNativePreset = require('@coachos/config/jest.react-native');

/** @type {import('jest').Config} */
module.exports = {
  ...reactNativePreset,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
