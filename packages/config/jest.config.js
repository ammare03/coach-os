// providers-and-gates/02. The custom ESLint rules in `eslint-rules/` are
// plain CommonJS with no transform to apply, so this is `jest.base` plus a
// Node environment — the RN and ts-jest presets would both be dead weight.
const base = require('./jest.base');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/eslint-rules/__tests__/**/*.test.js'],
};
