// Shared by the rule-registration suites below. `Array.prototype.find`
// returns `T | undefined`, and an `undefined` entry handed to
// `Linter#verify` lints nothing and passes — the failure
// `no-bare-invalidate-queries.test.js` already warns about in its own
// comment. Throwing here turns "the registration moved" into a named error
// instead of a green run.
'use strict';

/**
 * Takes any flat-config array — `eslint.base.js` is typed by
 * typescript-eslint, `eslint.react-native.js` by ESLint itself — and hands
 * back something `Linter#verify` accepts.
 *
 * @param {readonly { rules?: Record<string, unknown> }[]} configs
 * @param {string} ruleId
 * @returns {import('eslint').Linter.Config}
 */
function findRuleEntry(configs, ruleId) {
  const entry = configs.find((config) => config.rules?.[ruleId] !== undefined);
  if (!entry) {
    throw new Error(`No flat-config entry registers "${ruleId}".`);
  }
  // typescript-eslint's `FlatConfig.Config` and ESLint's `Linter.Config`
  // describe the same runtime object; they differ only in whether their
  // optional properties also admit an explicit `undefined`, which
  // `exactOptionalPropertyTypes` turns into a type error and nothing more.
  return /** @type {import('eslint').Linter.Config} */ (entry);
}

module.exports = { findRuleEntry };
