// Flat ESLint config shared by every workspace. `apps/api` and `apps/web`
// consume this directly; `apps/mobile` and `packages/ui` extend
// `eslint.react-native.js` instead, which layers React Native rules on top
// (CLAUDE.md §3.1 — apps/api must never load React Native lint rules).
//
// CLAUDE.md §0 hard rule: no `any` in committed TypeScript — `unknown` plus a
// narrowing guard is the sanctioned replacement. §17.1 permits a bare `!`
// only immediately after an explicit guard, with a comment, so the rule
// below errors and the rare legitimate site uses a targeted disable comment
// instead — a disable comment is reviewable, a bare `!` is invisible.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const prettierConfig = require('eslint-config-prettier');

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

/** @type {import('eslint').Linter.Config[]} */
module.exports = tseslint.config(
  js.configs.recommended,
  {
    // typescript-eslint's own recommended config includes two entries with
    // no `files` restriction (they'd otherwise apply TS-only rules, and
    // require the @typescript-eslint plugin, on plain .js config files too).
    // Scoping the whole extend to TS files is the documented fix.
    files: TS_FILES,
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    plugins: { import: importPlugin },
    settings: {
      // Tried in order; the first resolver that resolves a given import
      // wins. TypeScript's resolver understands path aliases and workspace
      // `exports` maps but requires a tsconfig.json in the target package —
      // several packages/* are still placeholders without one. The node
      // resolver is a plain-filesystem fallback so cross-package checks
      // (import/no-relative-packages, import/order) still work everywhere.
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      // Deterministic order kills a whole class of merge conflicts.
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // Enforces the package-name convention (§17.3): cross-workspace
      // imports always use `@coachos/x`, never a relative path climbing out
      // of the current package into another one.
      'import/no-relative-packages': 'error',

      // §17.3: one named export per component/module file. The two
      // sanctioned exceptions — framework route files and tooling config
      // files, both resolved by filename rather than import — are carved
      // out below rather than loosened here.
      'import/no-default-export': 'error',
    },
  },
  prettierConfig,
  {
    // Framework/tooling config files (eslint.config.js, next.config.ts, …)
    // and framework route files (expo-router and Next's App Router both use
    // an `app/` directory, possibly nested under `src/`) are read by their
    // filename, not imported — the default export is what the tool
    // requires, not a style choice.
    files: ['*.config.{js,mjs,cjs,ts}', '**/app/**/*.{ts,tsx}'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  {
    ignores: ['dist/**', '.next/**', '.expo/**', '.turbo/**', 'node_modules/**'],
  },
);
