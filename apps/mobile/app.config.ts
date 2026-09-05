import type { ConfigContext, ExpoConfig } from 'expo/config';

import { isDevGalleryEnabled } from './dev-gallery.js';

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
  // Dark-first, forced (theme-tokens/04) — the OS chrome (status bar,
  // keyboard, autofill sheets) must follow the app's scheme, not the
  // device's, or a device in light mode gets black-on-black status text.
  // `'automatic'` was the P00 scaffold default; there is no user-facing
  // appearance setting in v1 (CLAUDE.md §7.1).
  userInterfaceStyle: 'dark',
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
    // `ui-primitives-core/03` — `CLAUDE.md` §25.9: keyboard + a scrolling
    // form on Android needs `adjustResize`, or the focused field ends up
    // behind the keyboard instead of the window shrinking to fit it. A
    // native change; ships with a dev-client rebuild, never an OTA.
    softwareKeyboardLayoutMode: 'resize',
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
    //
    // `@shopify/react-native-skia` (`ui-primitives-data/02`, `CLAUDE.md`
    // §3.1) is the third of these: no `app.plugin.js`, no
    // `expo-module.config.json`, just a podspec and a Gradle module that
    // React Native autolinks. Nothing to configure here — but it IS native,
    // so it needs a dev-client rebuild and can never arrive over OTA
    // (`configuration` skill §8, `CLAUDE.md` §25.1, §25.11). Its own
    // postinstall copies the prebuilt Skia binaries into place; that build
    // script is allowed explicitly in `pnpm-workspace.yaml`.
    'expo-router',
    // `providers-and-gates/05`. Unlike the three modules above, Sentry DOES
    // ship a config plugin, and it is the whole source-map story: it writes
    // `sentry.properties` into the generated iOS and Android projects and
    // adds the upload build phase, so a `eas build` symbolicates without any
    // further wiring. Native — needs a dev-client rebuild, never an OTA
    // (`configuration` skill §8).
    //
    // `authToken` is deliberately absent and must stay absent: the plugin
    // would write it into `sentry.properties`, which is generated into
    // `ios/`/`android/` and shipped in the build. The token comes from the
    // `SENTRY_AUTH_TOKEN` environment variable instead — an EAS Secret,
    // never a repo value, and never an `EXPO_PUBLIC_` one (`configuration`
    // §3's server-only list). `organization`/`project` are plain identifiers,
    // not secrets, and fall back to `SENTRY_ORG`/`SENTRY_PROJECT` when unset
    // so a fork with a different Sentry account needs no code change.
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG ?? 'coachos',
        project: process.env.SENTRY_PROJECT ?? 'mobile',
      },
    ],
    [
      'expo-splash-screen',
      {
        // DS§2.2 `bg.DEFAULT` — was the P00 scaffold's brand blue, which
        // painted a light-feeling frame between splash and first React
        // paint (theme-tokens/04's "kill the white flash at every layer").
        backgroundColor: '#0A0D12',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    // theme-tokens/03 — embeds the five faces natively at prebuild so
    // there is no runtime load and no flash of a fallback face. A native
    // change: adding a sixth weight needs a rebuild, never an OTA.
    [
      'expo-font',
      {
        fonts: [
          // `DESIGN.md` §1.2 — two families, no third. Instrument Sans
          // speaks, Space Grotesk counts (chosen for its tabular figures,
          // which is why a running timer never jitters). Both SIL OFL.
          './assets/fonts/InstrumentSans-Regular.ttf',
          './assets/fonts/InstrumentSans-Medium.ttf',
          './assets/fonts/InstrumentSans-SemiBold.ttf',
          './assets/fonts/SpaceGrotesk-Medium.ttf',
          './assets/fonts/SpaceGrotesk-SemiBold.ttf',
          './assets/fonts/SpaceGrotesk-Bold.ttf',
        ],
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
    // `component-gallery/01`. The real exclusion is `metro.config.js`'s
    // blockList — the gallery's files are simply not in a production bundle.
    // This flag is the second layer: the route refuses to render if it ever
    // survives that block (a hand-edited Metro config, a future resolver
    // change), so "dev tooling never ships" does not rest on one mechanism.
    devGalleryEnabled: isDevGalleryEnabled(),
  },
});
