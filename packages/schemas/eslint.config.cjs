// .cjs, not .js: this package is "type": "module", and a plain
// eslint.config.js would be parsed as ESM, which `require()` can't run in.
const base = require('@coachos/config/eslint.base');

// The path-scoped copy in eslint.base.js's own array never fires here —
// ESLint's cwd is already packages/schemas, so `packages/schemas/src/**`
// never matches (same reasoning as apps/api/eslint.config.js's own comment).
module.exports = [
  ...base,
  {
    // __tests__ is exempt: conventions.test.ts deliberately builds a
    // non-strict fixture to prove its own walker flags it, and
    // pagination.test.ts's throwaway item schema for pageOf() is neither
    // caller input nor a redaction gate.
    files: ['src/**/*.ts'],
    ignores: ['src/strict.ts', 'src/pagination.ts', 'src/auth-session.ts', 'src/__tests__/**'],
    rules: base.noBareZodObjectRules,
  },
];
