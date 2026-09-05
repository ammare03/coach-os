import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  ANALYTICS_EVENT_NAMES,
  asUuid,
  type AnalyticsEventName,
  type AnalyticsProperties,
} from './events.ts';
import { captureAnalyticsEvent, getAnalyticsIdentity } from './posthog.ts';

// `trackEvent()` — the only sanctioned way to send a PostHog event
// (`ANALYTICS.md` AN§1). There is no `track(name: string, props:
// Record<string, unknown>)` escape hatch and no exported client; adding
// either is a blocking review comment.
//
// Two layers, deliberately:
//
//   1. **The type layer**, which is the real guardrail. `AnalyticsProperties<N>`
//      names each event's exact properties, and none of the permitted value
//      types is a free-form `string` (`events.ts`). Sending a food name, an
//      email address, a message body, or a media URL does not fail at
//      runtime — it fails to compile.
//   2. **The runtime layer** below, which is a backstop for the places
//      types cannot reach: a value that arrives through an `as`, an
//      untyped boundary, or a JS caller. It is deliberately paranoid about
//      strings, since a string is the only shape a leak can take.

/**
 * Rejects a property object that carries keys the event does not declare.
 *
 * TypeScript's excess-property check already catches this for an object
 * literal, which is how essentially every call site is written. This makes
 * it hold for a variable too: an undeclared key is typed `never`, so there
 * is no value that can be put there.
 */
type Exact<TActual, TExpected> = TActual & Record<Exclude<keyof TActual, keyof TExpected>, never>;

/**
 * A value that may be sent.
 *
 * Strings must look like an identifier or an enum token — hex, digits,
 * letters, and the four separators an id or a snake_case token uses. A
 * space, an `@`, a `/`, or anything over 64 characters is prose, an
 * address, or a URL, and none of those may reach PostHog (AN§2.1).
 */
const SAFE_STRING = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function isSafeValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    return SAFE_STRING.test(value);
  }
  return false;
}

const KNOWN_EVENT_NAMES = new Set<string>(ANALYTICS_EVENT_NAMES);

/**
 * `app_version` is AN§3.0's one permitted non-branded string, and only
 * because the emitter produces it — a caller can never supply it.
 */
function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** AN§3.0's base properties, added here and never passed by a caller. */
function baseProperties(): Record<string, string | number | boolean> {
  const who = getAnalyticsIdentity();
  return {
    ...(who === null ? {} : { user_id: asUuid(who.userId), role: who.role }),
    // The app ships to exactly two platforms; the web bundle is the
    // dev-only component gallery, which never initialises analytics.
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    app_version: appVersion(),
    // Always false today: there is no offline outbox yet, so nothing is
    // buffered on device and flushed later. The task that builds it
    // (`offline-sync`) sets this from the outbox item, and until then a
    // constant `false` is accurate rather than aspirational.
    is_offline_queued: false,
  };
}

/**
 * Loud in development so the call site is fixed before it ships; a dropped
 * property and a warning in a release build, because analytics may never
 * break a user action (AN§0.6). This is the only place analytics throws,
 * and it cannot happen in a release build.
 */
function reject(message: string): void {
  if (__DEV__) {
    throw new Error(message);
  }
  console.warn(message);
}

function reportUnsafeProperty(name: string, key: string): void {
  // The key, never the value. The value is the thing that might be a food
  // name or an email address, and a warning is still a log (CLAUDE.md §21.1).
  reject(
    `trackEvent("${name}"): property "${key}" is not a permitted analytics value and was dropped (ANALYTICS.md AN§2.1).`,
  );
}

function reportUndeclaredEvent(name: string): void {
  reject(`trackEvent("${name}"): no such event in ANALYTICS.md AN§3 — nothing was sent.`);
}

/**
 * Sends an analytics event.
 *
 * Fire-and-forget by contract (AN§0.6): it returns `void`, never throws in
 * a release build, and must never be awaited or placed on the critical
 * path of a user action.
 *
 * @example
 * trackEvent('set_logged', {
 *   session_id: asUuid(session.id),
 *   exercise_id: asUuid(exercise.id),
 *   set_number: 3,
 *   is_warmup: false,
 *   had_rpe: true,
 *   was_offline: false,
 *   entry_ms: 84,
 * });
 */
export function trackEvent<
  TName extends AnalyticsEventName,
  TProperties extends AnalyticsProperties<TName>,
>(name: TName, properties: Exact<TProperties, AnalyticsProperties<TName>>): void {
  if (!KNOWN_EVENT_NAMES.has(name)) {
    // Unreachable from typed code; reachable from an untyped boundary. An
    // event absent from `ANALYTICS.md` does not exist (AN§0.2).
    reportUndeclaredEvent(name);
    return;
  }

  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (isSafeValue(value)) {
      safe[key] = value;
      continue;
    }
    reportUnsafeProperty(name, key);
  }

  // Base properties last: a caller cannot shadow `user_id`, `role`,
  // `platform`, or `app_version` even by declaring one (AN§3.0).
  captureAnalyticsEvent(name, { ...safe, ...baseProperties() });
}
