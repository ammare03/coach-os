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
  // `test-context.ts`, `fixtures/two-coaches.ts`, `authz-allowlist.ts`, and
  // everything under `authz/` live under `__tests__/` (shared helpers other
  // tests import — the fixture and the allowlist module are
  // `03-owns-resource.md`'s and `05-public-allowlist.md`'s own file
  // placements) but none of them is itself a test file — Jest's default
  // testMatch would otherwise try to run them and fail on "must contain at
  // least one test".
  testPathIgnorePatterns: [
    ...nodePreset.testPathIgnorePatterns,
    '/__tests__/test-context.ts',
    '/__tests__/fixtures/',
    '/__tests__/authz-allowlist.ts',
    '/__tests__/authz/',
  ],
};
