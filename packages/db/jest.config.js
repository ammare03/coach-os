// Node-environment tests only. The transform and environment live in the
// shared @coachos/config/jest.node preset (quality-gates/01) — exactly
// the "packages/db once it has tests" case that preset's own comment
// anticipated. The one addition: a long default timeout, since these
// tests spin up a real Postgres container via Testcontainers
// (derived-data/03) rather than running against a mock — container
// startup plus a full migration replay routinely takes several seconds,
// well past Jest's 5s default.
import nodePreset from '@coachos/config/jest.node';

/** @type {import('jest').Config} */
export default {
  ...nodePreset,
  testTimeout: 60_000,
};
