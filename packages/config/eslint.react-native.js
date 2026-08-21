// Consumed by apps/mobile and packages/ui. Layers Expo/React Native rules on
// top of the shared base. apps/api must never load this file — it pulls
// React Native rules that make no sense server-side and slows every lint run
// (CLAUDE.md §3.1).
const rawExpoConfig = require('eslint-config-expo/flat');

const base = require('./eslint.base');

// eslint-config-expo bundles its own eslint-plugin-import registration in
// several entries. `base` already registers `import` workspace-wide with no
// `files` restriction, so a second, distinct plugin instance under the same
// key throws "Cannot redefine plugin" — strip expo's duplicate registration
// and let base's supply the plugin for expo's import/* rules too.
const expoConfig = rawExpoConfig.map((entry) => {
  if (!entry.plugins || !('import' in entry.plugins)) return entry;
  const { import: _unused, ...remainingPlugins } = entry.plugins;
  const deduped = { ...entry, plugins: remainingPlugins };
  if (Object.keys(remainingPlugins).length === 0) delete deduped.plugins;
  return deduped;
});

/** @type {import('eslint').Linter.Config[]} */
module.exports = [...base, ...expoConfig];
