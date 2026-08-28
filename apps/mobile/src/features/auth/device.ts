import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { getDeviceId } from './token-store.ts';

export interface DeviceFields {
  deviceId?: string;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string;
  osVersion?: string;
}

/**
 * The `deviceFields` every `auth.signUp`/`auth.signIn` call carries
 * (`packages/schemas/src/auth.ts`). `deviceId` is omitted on a device's
 * first sign-in — `auth-server/03` mints one and `open-session.ts` returns
 * it, at which point the caller persists it via `setDeviceId` so every
 * later call presents the same id. No new dependency for `osVersion`:
 * RN's own `Platform.Version` covers it without `expo-device`.
 */
export async function buildDeviceFields(): Promise<DeviceFields> {
  const deviceId = await getDeviceId();
  const appVersion = Application.nativeApplicationVersion;
  return {
    ...(deviceId !== null && { deviceId }),
    platform: Platform.OS as 'ios' | 'android' | 'web',
    ...(appVersion !== null && { appVersion }),
    osVersion: String(Platform.Version),
  };
}
