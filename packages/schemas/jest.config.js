// Node-environment tests only — no DOM, no React import. The transform and
// environment live in the shared @coachos/config/jest.node preset
// (quality-gates/01); this package has nothing to add on top of it.
import nodePreset from '@coachos/config/jest.node';

/** @type {import('jest').Config} */
export default {
  ...nodePreset,
};
