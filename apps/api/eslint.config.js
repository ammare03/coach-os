import base from '@coachos/config/eslint.base';

// The path-scoped copy in eslint.base.js's own array never fires here —
// ESLint's cwd is already apps/api, so `apps/api/src/routers/**` never
// matches (same reasoning as packages/utils/eslint.config.cjs's own
// comment on utilsPurityRules).
export default [
  ...base,
  { files: ['src/routers/**/*.ts'], rules: base.noInlineInputSchemaRules },
  {
    // error-formatter.test.ts exercises the formatter's own uncaught-error
    // branch, which by definition means feeding it a TRPCError with no
    // catalogued cause — the one place outside app-error.ts a bare
    // TRPCError is the correct fixture, not a violation of CLAUDE.md §6.3.
    files: ['src/**/*.ts'],
    ignores: ['src/lib/app-error.ts', 'src/__tests__/error-formatter.test.ts'],
    rules: base.noBareTrpcErrorRules,
  },
];
