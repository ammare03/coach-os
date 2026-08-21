// CLAUDE.md §18.1: 100% coverage for pure logic, no exceptions — and a
// threshold that only warns is decoration, so this one fails the run.
//
// Deliberately self-contained rather than importing
// @coachos/config/jest.node the way every other Node workspace does
// (quality-gates/01): packages/utils's own lint config enforces zero
// dependency on any @coachos/* package, tooling included, so it can be
// imported from anywhere without risk of a cycle (eslint.config.cjs,
// shared-config/02). The transform below is intentionally identical to
// @coachos/config/jest.node's — see that file if the two ever need to
// change together.
//
// The package's real tsconfig targets NodeNext (matching how apps/api
// consumes this package's raw .ts source at runtime), but Jest itself
// isn't running with Node's native ESM loader here — ts-jest is asked to
// transpile each test file down to CommonJS instead, which is a well-worn,
// fast path and orthogonal to how apps/api and Metro each consume the
// package in their own module systems.
/** @type {import('jest').Config} */
export default {
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true,
  coverageReporters: ['text', 'lcov'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.expo/', '/\\.turbo/'],
  watchPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.expo/', '/\\.turbo/'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          // TS 6 treats classic Node-style resolution (the only kind that
          // pairs with `module: commonjs`) as deprecated-but-still-working;
          // this transpile-only test path doesn't warrant chasing NodeNext
          // through ts-jest for a warning with no correctness effect.
          ignoreDeprecations: '6.0',
          // The real tsconfig rewrites relative `./x.ts` imports to `./x.js`
          // for Node's native loader (apps/api's use case). Under ts-jest's
          // CommonJS transpile, that rewrite points Jest's resolver at a
          // .js file that doesn't exist on disk — leave the literal .ts
          // specifier alone here instead so Jest just finds the real file.
          rewriteRelativeImportExtensions: false,
        },
      },
    ],
  },
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/*.test.ts'],
  coverageThreshold: {
    global: {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
