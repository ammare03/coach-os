import Constants from 'expo-constants';

// apps/api's default PORT (apps/api/.env.example). Only used in
// development, where the host is derived below rather than configured.
const DEV_API_PORT = 3000;

export interface ApiUrlEnvironment {
  isDev: boolean;
  /** `Constants.expoConfig?.hostUri` — the Metro/dev-server address Expo resolved for this session. */
  hostUri: string | undefined;
  /** `process.env.EXPO_PUBLIC_API_URL` — an origin only, no path, no trailing slash. */
  configuredUrl: string | undefined;
}

// Pure so it's testable without mocking `__DEV__`/`expo-constants` — see
// `getApiUrl` below for the real call site.
export function resolveApiUrl(env: ApiUrlEnvironment): string {
  if (env.isDev) {
    // `hostUri` is "192.168.1.5:8081" on a physical device, "localhost:8081"
    // (or similar) in a simulator — Expo already solved "the phone can't
    // reach the Mac's localhost" (`configuration` skill §9.3), so nothing
    // here reads a LAN IP out of `.env`.
    const host = env.hostUri?.split(':')[0];
    if (host) {
      return `http://${host}:${DEV_API_PORT}/trpc`;
    }
  }

  if (!env.configuredUrl) {
    throw new Error('EXPO_PUBLIC_API_URL is not set — see apps/mobile/.env.example');
  }
  // Origin only, per the interface contract (03-mobile-trpc-client.md) —
  // stripped defensively so a trailing slash never produces `//trpc`.
  return `${env.configuredUrl.replace(/\/+$/, '')}/trpc`;
}

export function getApiUrl(): string {
  return resolveApiUrl({
    isDev: __DEV__,
    hostUri: Constants.expoConfig?.hostUri,
    configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  });
}
