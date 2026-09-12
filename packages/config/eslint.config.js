// The preset this repo lints with, finally pointed at the package that
// defines it (UNFORGET A8). Until this file existed, `packages/config` had
// no `lint` script and no config to run one against — so every rule in
// `eslint.base.js`, including the six custom ones next door, was unenforced
// on its own source.
//
// Required relatively rather than by package name: a self-reference through
// `exports` resolves, but only when this package's own node_modules link is
// present, which is one more thing to be wrong about here than in any
// consumer.
const base = require('./eslint.base.js');

module.exports = [
  ...base,
  {
    // Every file in this package is CommonJS (there is no `"type": "module"`
    // in its package.json). Without this, `module`, `require`, and
    // `__dirname` all read as undefined globals — the base preset declares
    // no environment because every other workspace's source is either
    // TypeScript, where `no-undef` is off, or covered by
    // `eslint-config-expo`.
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // `import/no-relative-packages` visits ESM `import` declarations only
    // unless told otherwise, and this package is entirely `require()` — so
    // the rule the base preset sets to `error` could not see the one file in
    // the repo that violates it (`tailwind/preset.js`). That is half of what
    // UNFORGET A8 is about; turning it on here is what makes the other half
    // enforceable.
    files: ['**/*.js'],
    rules: { 'import/no-relative-packages': ['error', { commonjs: true }] },
  },
  {
    // Jest's globals — the suites, and the two setup modules that run
    // inside a Jest runtime (`jest.mock`, `jest.requireActual`). Listed
    // rather than pulled from the `globals` package, which is not a
    // declared dependency of this workspace.
    files: ['**/__tests__/**/*.js', 'jest.native-mocks.js', 'jest-doubles/*.js'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
  },
  {
    // A `.d.ts` holding `declare module` blocks must stay a global script:
    // a top-level `import type` would turn it into a module and the
    // declarations would stop being ambient. `import()` types are the only
    // way to name a type in one, so the rule has nothing to enforce here.
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
