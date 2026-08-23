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
  // `test-context.ts` and `fixtures/two-coaches.ts` live under `__tests__/`
  // (shared helpers other tests import — the fixture is
  // `03-owns-resource.md`'s Files table's own placement, "every later
  // authorization test in the plan tree imports this") but neither is
  // itself a test file — Jest's default testMatch would otherwise try to
  // run them and fail on "must contain at least one test".
  testPathIgnorePatterns: [
    ...nodePreset.testPathIgnorePatterns,
    '/__tests__/test-context.ts',
    '/__tests__/fixtures/',
  ],
};
