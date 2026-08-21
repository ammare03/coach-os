// The package's real tsconfig targets NodeNext (matching how apps/api
// consumes this package's raw .ts source at runtime), but Jest itself
// isn't running with Node's native ESM loader here — ts-jest is asked to
// transpile each test file down to CommonJS instead, the same workaround
// packages/utils uses and for the same reason.
/** @type {import('jest').Config} */
export default {
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
          // for Node's native loader. Under ts-jest's CommonJS transpile,
          // that rewrite points Jest's resolver at a .js file that doesn't
          // exist on disk — leave the literal .ts specifier alone here
          // instead so Jest just finds the real file.
          rewriteRelativeImportExtensions: false,
        },
      },
    ],
  },
};
