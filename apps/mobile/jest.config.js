// React Native tests via the shared @coachos/config/jest.react-native
// preset (quality-gates/01) — jest-expo supplies the transform and the
// default native-module mocks for this SDK.
const reactNativePreset = require('@coachos/config/jest.react-native');

/** @type {import('jest').Config} */
module.exports = {
  ...reactNativePreset,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
