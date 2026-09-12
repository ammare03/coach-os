import { ListRow, type Density } from '@coachos/ui';
import * as Application from 'expo-application';

export interface AppVersionRowProps {
  density?: Density;
}

/**
 * `1.0.0 (24)` — the one thing a support conversation always needs and a
 * person never knows (`SUPPORT.md`'s first question, every time).
 *
 * Reads `expo-application` exactly as `features/auth/device.ts` already
 * does: no new dependency, and no second version source. Deliberately NOT
 * `expo-updates`' runtime version or a string in `app.config.ts` — the
 * number a store shows and the number a build reports have to be the same
 * number, and only the native one is both.
 *
 * Static: no `onPress`, so `ListRow` gives it `accessibilityRole="text"`
 * and it is not a control. A row that did nothing on press would be a bug
 * (`settings-shell/01`, Risks); a row that is not pressable at all is a
 * fact on a screen.
 */
export function AppVersionRow({ density }: AppVersionRowProps) {
  return (
    <ListRow
      label="App version"
      trailing={{ kind: 'value', value: formatAppVersion() }}
      {...(density ? { density } : {})}
    />
  );
}

/**
 * Both numbers when both are there, the marketing version alone when the
 * build number is not, and `Unknown` when neither is — which happens on
 * web and in a test runner, never on a device.
 */
export function formatAppVersion(): string {
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  if (!version) return 'Unknown';
  return build ? `${version} (${build})` : version;
}
