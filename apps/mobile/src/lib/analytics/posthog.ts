import { getTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { PostHog, type PostHogOptions } from 'posthog-react-native';

import { env } from '../../env.ts';

import type { AnalyticsRole } from './events.ts';

// PostHog initialisation and the consent gate around it (CLAUDE.md §20,
// `ANALYTICS.md` AN§2).
//
// **Nothing in this module exports the PostHog client.** That is the single
// structural defence the task's Risks section names: with a raw client in
// reach, the first feature that wants "just one more property type" calls
// `posthog.capture()` directly and every guardrail in `track-event.ts` is
// bypassed silently. `captureAnalyticsEvent` below is `@internal` and has
// exactly one caller.

// ---------------------------------------------------------------------------
// Session recording — CLAUDE.md §20, AN§2.2: never. Not behind a flag, not
// for a week.
//
// Four things have to fail at once for a recording to happen, and three of
// them are not config:
//
//   1. `enableSessionReplay` below is typed `false`, not `boolean`. Writing
//      `true` is a compile error, not a working change.
//   2. `buildAnalyticsOptions()` takes no arguments and the object it
//      returns is frozen — there is no seam through which a caller passes
//      options in, so this file is the only place the value can come from.
//   3. React Native session replay is implemented by a **separate native
//      package**, `posthog-react-native-session-replay`. It is not a
//      dependency of this app, so the native recorder does not exist in the
//      binary. Enabling replay therefore also requires a visible
//      `package.json` change and a dev-client rebuild — it cannot arrive in
//      a config tweak or an OTA update.
//   4. `__tests__/posthog-config.test.ts` asserts both the flag and the
//      absent package, so an SDK upgrade that changes the default (the risk
//      the task calls out) fails the build rather than starting to record.
//
// Autocapture (AN§2.2 — it captures screen text) is closed the same way:
// autocapture in this SDK lives entirely inside PostHog's own
// `<PostHogProvider>`, and `AnalyticsProvider.tsx` deliberately does not
// mount it. There is no autocapture code path in the app to disable.
// ---------------------------------------------------------------------------
type SessionRecordingForbidden = {
  readonly enableSessionReplay: false;
  readonly sessionReplayConfig?: never;
};

/**
 * What the OS says about tracking. iOS reports the App Tracking
 * Transparency status, which is also how the system-wide "Allow Apps to
 * Request to Track" switch surfaces (it reports `denied` for every app when
 * off). Android and the simulator always report `granted` — Expo exposes no
 * read of Android's limit-ad-tracking flag short of fetching the
 * advertising ID itself, which we will not do (see `readOsTrackingStatus`).
 */
export type OsTrackingStatus = 'allowed' | 'denied';

/**
 * The three states capture can be in.
 *
 * - `blocked` — nothing is sent at all. The account-level opt-out (AN§2.3)
 *   and a missing project key both land here.
 * - `anonymous` — events are sent, but no device identifier accompanies
 *   them and no person profile is ever created. This is AN§2.3's "if
 *   denied, analytics run without any device identifier", and it is
 *   deliberately *not* the same as `blocked`: ATT governs cross-app
 *   tracking against a device advertising identifier, which this app never
 *   reads. Treating it as a full opt-out would silently delete every metric
 *   in AN§4 for the majority of iOS users who leave the global switch off,
 *   which is not what the flag asks for.
 * - `full` — events are sent and the signed-in user may be identified.
 */
export type AnalyticsConsent = 'blocked' | 'anonymous' | 'full';

export interface AnalyticsConsentInputs {
  /** False when `EXPO_PUBLIC_POSTHOG_KEY` is unset — a fresh clone, or CI. */
  hasProjectKey: boolean;
  /** `users.analytics_opt_out` (DB§5.1), surfaced by `me.get`. */
  accountOptedOut: boolean;
  osTracking: OsTrackingStatus;
}

/** Pure, and therefore the thing worth testing. */
export function resolveAnalyticsConsent(inputs: AnalyticsConsentInputs): AnalyticsConsent {
  if (!inputs.hasProjectKey || inputs.accountOptedOut) {
    return 'blocked';
  }
  return inputs.osTracking === 'denied' ? 'anonymous' : 'full';
}

// PostHog attaches these itself. Both are device-scoped identifiers, so
// both come off in `anonymous` mode.
const DEVICE_IDENTIFIER_PROPERTIES = ['$device_id', '$anon_distinct_id'] as const;

let client: PostHog | null = null;
let consent: AnalyticsConsent = 'blocked';
let accountOptedOut = false;
let osTracking: OsTrackingStatus = 'allowed';
let identity: { userId: string; role: AnalyticsRole } | null = null;

// The SDK types `before_send` as one handler or an array of them; this
// picks the single-handler arm out so the hook can be written against the
// SDK's own event shape without importing @posthog/core, which is a
// transitive dependency this app does not declare.
type BeforeSendHandler = Extract<
  NonNullable<PostHogOptions['before_send']>,
  (...args: never[]) => unknown
>;

/**
 * The last gate before an event leaves the SDK.
 *
 * `optOut()` is asynchronous and the queue can already hold events when
 * consent changes mid-session, so the state is re-read here on the way out
 * rather than trusted from whenever `capture()` was called.
 */
const applyConsentToOutboundEvent: BeforeSendHandler = (event) => {
  if (event === null || consent === 'blocked') {
    return null;
  }
  if (consent === 'anonymous' && event.properties) {
    const properties = { ...event.properties };
    for (const key of DEVICE_IDENTIFIER_PROPERTIES) {
      delete properties[key];
    }
    return { ...event, properties };
  }
  return event;
};

function buildAnalyticsOptions(): PostHogOptions & SessionRecordingForbidden {
  return Object.freeze({
    host: env.EXPO_PUBLIC_POSTHOG_HOST,

    // CLAUDE.md §20 / AN§2.2 — see the block comment above. Do not change
    // this line; changing it is not sufficient to enable replay anyway.
    enableSessionReplay: false,

    // Consent decides, and consent is resolved asynchronously. Starting
    // opted out means an event cannot escape in the window between the
    // client existing and the OS permission read resolving.
    defaultOptIn: false,

    // AN§0.2: if an event is not in `ANALYTICS.md`, it does not exist. The
    // SDK's own ambient events are not in it, and they also cost quota
    // against the 1M/month free tier (AN§6).
    captureAppLifecycleEvents: false,
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    disableSurveys: true,

    // AN§2.1 — precise location, including IP-derived city, is never
    // collected. Geo-IP enrichment is exactly that, done server-side.
    disableGeoip: true,

    // A person profile exists only for a user we deliberately identified,
    // never for an anonymous device (AN§2.2's user-property limit).
    personProfiles: 'identified_only',

    before_send: applyConsentToOutboundEvent,
  });
}

/**
 * Reads the OS tracking permission without ever requesting it.
 *
 * We never call `requestTrackingPermissionsAsync()` and never call
 * `getAdvertisingId()`. CoachOS does not track users across apps and has no
 * use for an advertising identifier, so prompting for one would be both
 * dishonest and a store-review liability — and reading the Android
 * advertising ID (the only way to see Android's limit-ad-tracking flag)
 * would create the very identifier this check exists to avoid.
 */
async function readOsTrackingStatus(): Promise<OsTrackingStatus> {
  try {
    const permission = await getTrackingPermissionsAsync();
    // `undetermined` is the normal iOS state for an app that never
    // prompts — it is not a refusal, and is treated as allowed.
    return permission.status === 'denied' ? 'denied' : 'allowed';
  } catch {
    // The permission module is unavailable (web, an older binary). Failing
    // open matches the module's own contract, which reports `granted`
    // wherever the API does not exist.
    return 'allowed';
  }
}

function applyConsent(): void {
  const next = resolveAnalyticsConsent({
    hasProjectKey: env.EXPO_PUBLIC_POSTHOG_KEY !== null,
    accountOptedOut,
    osTracking,
  });
  consent = next;

  if (!client) {
    return;
  }
  // Order is load-bearing, and not obviously so: `reset()` clears **every**
  // persisted property, `OptedOut` among them. Resetting after `optOut()`
  // would quietly undo the opt-out, and resetting after `optIn()` would
  // quietly opt the SDK back out (the getter falls back to `!defaultOptIn`,
  // which is `true` here). So the reset always comes first.
  if (next === 'anonymous' || next === 'blocked') {
    // Clears the stored distinct id, so neither an opt-out nor an OS
    // refusal leaves a pseudonymous identifier behind on the device.
    // `personProfiles: 'identified_only'` then means simply not calling
    // `identify()` is enough to keep anonymous mode profile-free.
    client.reset();
  }

  if (next === 'blocked') {
    // Not just our own gate: this stops the SDK's own queue too (AN§2.3 —
    // opting out is immediate).
    void client.optOut();
    return;
  }

  void client.optIn();
  if (next === 'full' && identity) {
    identifyWithClient(client, identity);
  }
}

function identifyWithClient(posthog: PostHog, who: { userId: string; role: AnalyticsRole }): void {
  // AN§2.2 caps person properties at: user id, role, tier, account age,
  // platform, app version. Only the two this layer actually knows are sent
  // — never an email, never a name.
  posthog.identify(who.userId, { role: who.role });
}

/**
 * Creates the client and resolves consent. Called once, by
 * `AnalyticsProvider`. Safe to call again — later calls are no-ops.
 */
export async function initAnalytics(): Promise<void> {
  if (client) {
    return;
  }
  const key = env.EXPO_PUBLIC_POSTHOG_KEY;
  if (key === null) {
    // Not an error: a fresh clone and CI have no project key, and
    // analytics degrading to a no-op is the correct behaviour there
    // (`env.ts`). Every `trackEvent()` call stays a silent no-op.
    consent = 'blocked';
    return;
  }
  client = new PostHog(key, buildAnalyticsOptions());
  osTracking = await readOsTrackingStatus();
  applyConsent();
}

/**
 * The in-app analytics opt-out (CLAUDE.md §20, `account-lifecycle/02`).
 *
 * Call this with `users.analytics_opt_out` whenever `me.get` resolves or
 * the setting changes. The gate lives here rather than being read from a
 * query because this module initialises outside the query providers — the
 * root layout's outermost slot — so the preference is pushed in, not
 * pulled.
 */
export function setAnalyticsOptOut(optedOut: boolean): void {
  accountOptedOut = optedOut;
  applyConsent();
}

/**
 * Associates subsequent events with the signed-in user, or clears the
 * association on sign-out. Never called with anything but an id and a role.
 */
export function setAnalyticsIdentity(who: { userId: string; role: AnalyticsRole } | null): void {
  identity = who;
  if (!client) {
    return;
  }
  if (!who) {
    client.reset();
    return;
  }
  if (consent === 'full') {
    identifyWithClient(client, who);
  }
}

/** The base properties AN§3.0 attaches to every event, as far as this layer knows them. */
export function getAnalyticsIdentity(): { userId: string; role: AnalyticsRole } | null {
  return identity;
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return consent;
}

/**
 * The wire shape, after `track-event.ts` has validated the caller's
 * properties and added AN§3.0's base ones. Wider than
 * `AnalyticsPropertyValue` by exactly one thing — `app_version`, the
 * machine-generated string the emitter produces and a caller cannot supply.
 */
export type OutboundProperties = Readonly<Record<string, string | number | boolean>>;

/**
 * @internal — `track-event.ts` is the only sanctioned caller. Nothing here
 * or anywhere else exports the PostHog client itself.
 */
export function captureAnalyticsEvent(name: string, properties: OutboundProperties): void {
  if (!client || consent === 'blocked') {
    return;
  }
  // Fire and forget (AN§0.6). `capture` returns void and queues; an
  // analytics failure must never surface to a user or block an action.
  client.capture(name, { ...properties });
}

/** Test seam — resets module state between cases. Not called by app code. */
export function __resetAnalyticsForTest(): void {
  client = null;
  consent = 'blocked';
  accountOptedOut = false;
  osTracking = 'allowed';
  identity = null;
}

/** Exposed for `__tests__/posthog-config.test.ts` — the config, never the client. */
export function __getAnalyticsOptionsForTest(): PostHogOptions & SessionRecordingForbidden {
  return buildAnalyticsOptions();
}
