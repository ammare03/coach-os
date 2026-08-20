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
