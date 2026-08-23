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
const noHandWrittenRowType = require('./eslint-rules/no-hand-written-row-type.js');

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

// packages/utils's purity boundary (shared-config/02): it must run
// identically on the server, on the device, and in a worklet, so it may
// depend on nothing that only exists in one of those three. Defined once,
// here, and applied two ways below: unconditionally by
// packages/utils/eslint.config.cjs (files-glob matching is relative to
// wherever ESLint is invoked from, so a path-scoped rule silently never
// fires when linting runs with packages/utils itself as the cwd — the
// normal case), and path-scoped in this file's own exported array as
// defense-in-depth for a future whole-repo lint run.
const utilsPurityRules = {
  'import/no-nodejs-modules': [
    'error',
    {
      allow: [],
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'react',
          message:
            'packages/utils runs on the server and in a Reanimated worklet, ' +
            'neither of which has React — the formula belongs in a package ' +
            'that has a UI, or this dependency belongs on the caller.',
        },
        {
          name: 'react-dom',
          message: 'packages/utils has no DOM. See the "react" restriction above.',
        },
        {
          name: 'react-native',
          message: 'packages/utils has no React Native runtime. See the "react" restriction above.',
        },
      ],
      patterns: [
        {
          group: [
            'react-native/*',
            '@react-native/*',
            'react-native-*',
            'expo',
            'expo-*',
            '@expo/*',
          ],
          message:
            'packages/utils must run on the server too — nothing from the ' +
            'Expo/React Native ecosystem may be imported here.',
        },
        {
          group: ['@coachos/*'],
          message:
            'packages/utils has zero dependency on other @coachos/* workspace ' +
            'packages by design — that is what makes it safe to import from ' +
            'anywhere. If two packages need to share this code, it belongs here instead.',
        },
      ],
    },
  ],
};

// CLAUDE.md §6.4: input schemas live in packages/schemas, never inline in a
// router or a feature file — error-and-validation/01. Exported so apps/api
// and apps/mobile can apply it scoped to their own cwd (a path-scoped copy
// in this file's own array alone would silently never fire when ESLint's
// cwd is already that app's directory — the normal case; same reasoning as
// `utilsPurityRules` above).
const noInlineInputSchemaRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='z'][callee.property.name='object']",
      message: 'Input schemas live in packages/schemas (CLAUDE.md §6.4) — move this and import it.',
    },
  ],
};

// CLAUDE.md §6.3 step 3 (`error-and-validation/02`): `appError()` in
// apps/api/src/lib/app-error.ts is the only sanctioned way to construct a
// thrown error. A bare `new TRPCError({ code })` carries no catalogued
// `cause.code`, which the formatter then has to treat as uncaught. Exported
// for the same cwd reason `noInlineInputSchemaRules` is — see that
// comment.
const noBareTrpcErrorRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='TRPCError']",
      message:
        'Construct errors via appError() in apps/api/src/lib/app-error.ts (CLAUDE.md §6.3) — a bare TRPCError carries no catalogued cause.code.',
    },
  ],
};

// error-and-validation/03 step 1: strictObject() (packages/schemas/src/strict.ts)
// is the one constructor every input-schema module calls — a bare `z.object`
// defaults to silently stripping unknown keys, which is exactly the failure
// this task exists to close. `conventions.test.ts` catches it at runtime by
// walking the exported tree; this rule catches it at write time. Exported
// for the same cwd reason `noInlineInputSchemaRules` is.
const noBareZodObjectRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='z'][callee.property.name='object']",
      message: 'Use strictObject() from ./strict.ts instead of bare z.object (CLAUDE.md §6.4).',
    },
  ],
};

/** @type {import('eslint').Linter.Config[]} */
const config = tseslint.config(
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
  {
    files: ['packages/utils/**/*.{ts,tsx}'],
    rules: utilsPurityRules,
  },
  {
    files: ['apps/api/src/routers/**/*.{ts,tsx}', 'apps/mobile/src/features/**/*.{ts,tsx}'],
    rules: noInlineInputSchemaRules,
  },
  {
    files: ['apps/api/src/**/*.{ts,tsx}'],
    ignores: ['apps/api/src/lib/app-error.ts'],
    rules: noBareTrpcErrorRules,
  },
  {
    files: ['packages/schemas/src/**/*.{ts,tsx}'],
    ignores: ['packages/schemas/src/strict.ts', 'packages/schemas/src/pagination.ts'],
    rules: noBareZodObjectRules,
  },
  {
    // db-package-scaffold/05: flags a hand-written row type outside
    // packages/db, where the real `typeof someTable.$inferSelect`
    // declarations legitimately live (and where this rule would never
    // fire anyway — see the rule's own doc comment on TSTypeQuery).
    files: TS_FILES,
    ignores: ['packages/db/**'],
    plugins: { local: { rules: { 'no-hand-written-row-type': noHandWrittenRowType } } },
    rules: {
      'local/no-hand-written-row-type': 'error',
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

module.exports = config;
module.exports.utilsPurityRules = utilsPurityRules;
module.exports.noInlineInputSchemaRules = noInlineInputSchemaRules;
module.exports.noBareTrpcErrorRules = noBareTrpcErrorRules;
module.exports.noBareZodObjectRules = noBareZodObjectRules;
