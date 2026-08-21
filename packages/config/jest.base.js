// Cross-cutting Jest settings shared by every workspace — Node or React
// Native alike. Everything environment-specific (the transform, the test
// environment, native-module presets) lives in jest.node.js or
// jest.react-native.js instead: the two environments are different enough
// that unifying them here would produce a config that half-works in both
// (quality-gates/01).
// `clearMocks`/`restoreMocks` below need jest-runtime and the resolved
// jest-environment-node/-jsdom (and their nested jest-mock) to agree on the
// ModuleMocker API. jest-config's own dependency on jest-environment-node
// is pinned to the 29.x line even under jest@30, which nests an
// incompatible jest-mock and crashes with "clearMocksOnScope is not a
// function" the first time a test file runs. pnpm-workspace.yaml's
// `overrides` forces jest-environment-node, jest-environment-jsdom, and
// jest-mock to the same 30.4.1 across the whole workspace so this setting
// is safe to turn on everywhere (quality-gates/01).
/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  restoreMocks: true,
  // A workspace scaffolded ahead of its first test (packages/ui, today)
  // must pass, not error — otherwise `pnpm check` breaks the moment a
  // package exists before its first spec does.
  passWithNoTests: true,
  coverageReporters: ['text', 'lcov'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.expo/', '/\\.turbo/'],
  watchPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.expo/', '/\\.turbo/'],
};
