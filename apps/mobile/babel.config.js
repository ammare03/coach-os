// react-native-reanimated/plugin must stay last in the plugins array
// (CLAUDE.md §3.1) — NativeWind contributes a preset/jsxImportSource, not a
// plugin, so the two do not collide, but a future reorder here would
// silently break Reanimated.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
