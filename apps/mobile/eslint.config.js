const base = require('@coachos/config/eslint.base');
const reactNativeConfig = require('@coachos/config/eslint.react-native');

// The path-scoped copy in eslint.base.js's own array never fires here —
// ESLint's cwd is already apps/mobile, so `apps/mobile/src/features/**`
// never matches (same reasoning as packages/utils/eslint.config.cjs's own
// comment on utilsPurityRules).
module.exports = [
  ...reactNativeConfig,
  { files: ['src/features/**/*.{ts,tsx}'], rules: base.noInlineInputSchemaRules },
];
