// providers-and-gates/02. The custom ESLint rules in `eslint-rules/` are
// plain CommonJS with no transform to apply. `tailwind/__tests__` needs one
// anyway: `tailwind/preset.js` reaches into `packages/ui/src/theme/*.ts`, so
// loading the real preset — which is the whole point of that suite — means
// transpiling TypeScript. Same ts-jest settings as `jest.node.js`, inlined
// rather than spread from it because this config is otherwise plain CJS and
// only the transform is shared.
const base = require('./jest.base');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/eslint-rules/__tests__/**/*.test.js',
    '<rootDir>/tailwind/__tests__/**/*.test.js',
  ],
  moduleFileExtensions: ['js', 'ts', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2022',
          lib: ['ES2022'],
          ignoreDeprecations: '6.0',
          // See `jest.node.js` — the real tsconfig rewrites `./x.ts` to
          // `./x.js` for Node's loader, which points Jest's resolver at a
          // file that does not exist on disk. `packages/ui` writes the
          // `.ts` specifier literally, so the extension has to be allowed
          // rather than rewritten.
          rewriteRelativeImportExtensions: false,
          allowImportingTsExtensions: true,
          noEmit: false,
          allowJs: false,
        },
      },
    ],
  },
};
