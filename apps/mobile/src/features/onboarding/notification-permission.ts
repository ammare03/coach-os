// `client-onboarding/05` — the OS permission request, and the one file in
// the app that imports `expo-notifications`.
//
// The single-import rule is the same one `packages/ui/src/haptics/index.ts`
// and `lib/analytics/posthog.ts` follow: a capability with a user-visible
// consequence gets one named entry point, so a second call site is visible
// in review instead of arriving one defensible import at a time.
//
// **It never blocks onboarding.** Granted, denied, or thrown — this resolves
// and the flow completes (`client-onboarding/05`'s stated risk: many people
// decline notification prompts reflexively, and the flow must finish
// regardless).
//
// ⚠️ Registering a device token is NOT here. `phase-15-notifications/
// push-infrastructure/01` owns that, and does not exist yet — so a grant
// currently has no registration consumer. That is expected, not an omission:
// permission and registration are legitimately separable, and asking for
// permission at the moment the value is explained is the whole point of
// this step.
//
// ⚠️ `expo-notifications` is a NATIVE module. It needs a dev-client rebuild
// and can never arrive over OTA (`CLAUDE.md` §25.1, §25.11).
import * as Notifications from 'expo-notifications';

export type NotificationPermissionOutcome = 'granted' | 'denied';

/**
 * Asks the OS, once. If the OS has already been asked on this device and
 * will not ask again (`canAskAgain: false`), this reports the standing
 * answer rather than pretending to have asked — the app cannot re-prompt,
 * only Settings can.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionOutcome> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return 'granted';
    if (!existing.canAskAgain) return 'denied';

    const result = await Notifications.requestPermissionsAsync();
    return result.granted ? 'granted' : 'denied';
  } catch {
    // A simulator without a push entitlement, a device in a state the
    // module does not expect — none of it is the client's problem, and
    // none of it may stop them finishing setup.
    return 'denied';
  }
}
