// Three third-party entry points this package requires that ship no types.
// Declared with the shape they actually have rather than left implicitly
// `any` — an untyped `eslint-config-expo/flat` is what let the `entry`
// parameter in `eslint.react-native.js` go unchecked, and that map is the
// one place a malformed config entry would be silently produced.

declare module 'eslint-config-expo/flat' {
  const config: import('eslint').Linter.Config[];
  export = config;
}

declare module 'jest-expo/jest-preset' {
  const preset: import('jest').Config;
  export = preset;
}

// Side-effect only: registers the library's own Jest mocks. It exports
// nothing, which is why this declaration has an empty body.
declare module 'react-native-gesture-handler/jestSetup';
