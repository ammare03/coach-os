// .cjs, not .js: this package is "type": "module", but the purity rule
// below needs `base.utilsPurityRules` read as a real object property via
// `require()` — a files-glob-scoped version of the same rule lives in
// eslint.base.js's own exported array too, as defense-in-depth, but a glob
// of `packages/utils/**` never matches when ESLint's cwd is already
// packages/utils itself (the normal case here), so that copy alone would
// silently never fire.
const base = require('@coachos/config/eslint.base');

module.exports = [...base, { rules: base.utilsPurityRules }];
