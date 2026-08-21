// .cjs, not .js: this package is "type": "module", and a plain
// eslint.config.js would be parsed as ESM, which `require()` can't run in.
// The base preset, not the React Native one — packages/db runs on the
// server only (CLAUDE.md §3.1's split between server and RN lint rules).
module.exports = require('@coachos/config/eslint.base');
