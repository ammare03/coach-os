// React Native / Expo preset for apps/mobile and packages/ui.
//
// jest-expo (Expo's own Jest preset) supplies the transformer, the
// module-name mapper, and the default native-module mocks for this SDK —
// this file only layers CoachOS's cross-cutting settings on top of it.
// Do not try to hand-roll the transform-ignore pattern here; jest-expo's
// is kept in step with each Expo SDK release and a hand-rolled one drifts.
const base = require('./jest.base');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  preset: 'jest-expo',
};
