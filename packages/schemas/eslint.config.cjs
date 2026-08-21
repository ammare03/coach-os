// .cjs, not .js: this package is "type": "module", and a plain
// eslint.config.js would be parsed as ESM, which `require()` can't run in.
module.exports = require('@coachos/config/eslint.base');
