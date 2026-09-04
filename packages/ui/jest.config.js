// React Native preset via @coachos/config/jest.react-native
// (quality-gates/01), which supplies the transform, the `lucide-react-native`
// resolution fix, and jest-expo's own module mapping. `setupFilesAfterEnv`
// mirrors `apps/mobile/jest.config.js`.
const reactNativePreset = require('@coachos/config/jest.react-native');

/** @type {import('jest').Config} */
module.exports = {
  ...reactNativePreset,
  setupFilesAfterEach: undefined,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};
