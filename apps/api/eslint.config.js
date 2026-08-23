import base from '@coachos/config/eslint.base';

// The path-scoped copy in eslint.base.js's own array never fires here —
// ESLint's cwd is already apps/api, so `apps/api/src/routers/**` never
// matches (same reasoning as packages/utils/eslint.config.cjs's own
// comment on utilsPurityRules).
export default [...base, { files: ['src/routers/**/*.ts'], rules: base.noInlineInputSchemaRules }];
