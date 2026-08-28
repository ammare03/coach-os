import type { ConfigContext, ExpoConfig } from 'expo/config';

// The only Expo config file in this repo — there is deliberately no
// app.json. A dynamic, typed config is required because build-time
// values (API URL, EAS project id, …) must come from process.env, which
// static JSON cannot read. See the `configuration` skill and
// .claude/plan/phase-00-repository-foundation/workspace-scaffold/02-relocate-expo-app.md.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'coach-os',
  slug: 'coach-os',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'coachos',
  userInterfaceStyle: 'automatic',
  ios: {
    // `social-sign-in/01` — the `com.apple.developer.applesignin`
    // entitlement. `expo-apple-authentication` ships no config plugin of
    // its own (checked: no `app.plugin.js` in the package); `usesAppleSignIn`
    // is the dedicated top-level Expo config field for it, resolved into
    // the entitlement at `expo prebuild` time — the same "native change,
    // needs a dev client rebuild, never an OTA" rule as everything else in
    // the `configuration` skill §8.
    usesAppleSignIn: true,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    // `expo-secure-store` (auth-client/01) needs no entry here — its config
    // plugin only exists to customize Face ID copy or Android backup
    // rules, neither of which this app uses. Recorded so the next reader
    // doesn't go looking for one.
    //
    // `expo-glass-effect` (`ui-primitives-core/07`) also needs no entry —
    // it ships no `app.plugin.js` at all (checked in its
    // `expo-module.config.json`); it's a plain autolinked native module,
    // same situation as `expo-secure-store` above.
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    ...config.extra,
    eas: { projectId: process.env.EAS_PROJECT_ID },
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  },
});
