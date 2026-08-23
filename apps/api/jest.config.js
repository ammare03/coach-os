// Node-environment tests only. The transform and environment live in the
// shared @coachos/config/jest.node preset (quality-gates/01); the only
// thing this package adds is the fake environment values every test needs
// before `./env.ts` parses `process.env` at import time — see
// jest.setup-env.ts.
import nodePreset from '@coachos/config/jest.node';

/** @type {import('jest').Config} */
export default {
  ...nodePreset,
  setupFiles: ['<rootDir>/jest.setup-env.ts'],
  // `test-context.ts` lives under `__tests__/` (it's a shared helper every
  // later procedure test imports, per the `testing` skill §4) but isn't
  // itself a test file — Jest's default testMatch would otherwise try to
  // run it and fail on "must contain at least one test".
  testPathIgnorePatterns: [...nodePreset.testPathIgnorePatterns, '/__tests__/test-context.ts'],
};
