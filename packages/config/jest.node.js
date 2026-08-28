// Node-environment preset for apps/api and any pure-TypeScript package
// (packages/schemas, and packages/db once it has tests) — no DOM, no React
// Native transform. packages/utils keeps its own copy of this instead of
// importing it: its lint config forbids depending on any @coachos/*
// package, tooling included, so that it stays safely importable from
// anywhere (quality-gates/01).
//
// ts-jest transpiles each test file straight to CommonJS rather than
// running under Node's native ESM/type-stripping loader. That loader is
// what apps/api and the packages use at runtime, but Jest itself isn't
// that loader, and chasing NodeNext through ts-jest buys nothing here —
// this is a transpile-only test path, so the deprecation warning it would
// otherwise raise is silenced rather than chased.
const base = require('./jest.base');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testEnvironment: 'node',
  // `.tsx` added for `apps/api/src/lib/email/` (auth-server/06) — React
  // Email templates are the one place this preset's "no DOM, no React
  // Native transform" doc comment above has an exception: `react-dom/server`
  // renders them to a string server-side, no DOM or native runtime
  // involved, so this stays a plain Node preset, just with JSX enabled.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          jsx: 'react-jsx',
          ignoreDeprecations: '6.0',
          // The real tsconfig rewrites relative `./x.ts` imports to `./x.js`
          // for Node's native loader. Under ts-jest's CommonJS transpile,
          // that rewrite would point Jest's resolver at a `.js` file that
          // doesn't exist on disk — leave the literal `.ts`/`.tsx` specifier
          // alone instead so Jest just finds the real file.
          rewriteRelativeImportExtensions: false,
        },
      },
    ],
  },
};
