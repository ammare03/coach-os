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
};
