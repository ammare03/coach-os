import * as Sentry from '@sentry/react-native';
import type { ErrorEvent, ReactNativeOptions } from '@sentry/react-native';

import { env } from '../env.ts';

/**
 * Mobile crash reporting (`phase-05-app-shell/providers-and-gates/05`). The
 * counterpart to `apps/api/src/lib/sentry.ts`, and deliberately built to the
 * same shape: one module-private `init`, a `beforeSend` that rebuilds the
 * event from an allowlist, and no export of the Sentry client itself.
 *
 * The two SDKs bill against **one** Sentry project quota — CLAUDE.md §3.4.3:
 * 5,000 errors/month, one user, free tier. Every sampling decision in
 * `buildSentryOptions()` is a decision about a budget the server is also
 * spending, which is why they are written down rather than left to defaults.
 *
 * `EXPO_PUBLIC_SENTRY_DSN` is optional (`../env.ts`). Unset, the SDK's own
 * documented behaviour is to no-op every capture, which is what lets a fresh
 * clone and CI run with no Sentry account — the same call apps/api makes.
 *
 * **Source maps.** Two halves, and this task wires only the first: the Expo
 * config plugin (`app.config.ts`) writes `sentry.properties` and the native
 * upload build phase, and `pnpm --filter mobile sentry:sourcemaps` uploads an
 * `expo export` bundle's maps. **Still missing, deliberately:** OTA/EAS Update
 * bundles need Debug IDs injected by wrapping `metro.config.js` in
 * `getSentryExpoConfig` from `@sentry/react-native/metro`, and the EAS hook
 * that calls either path. Both belong to
 * `phase-22-release-engineering/build-profiles/`, which owns the pipeline.
 */

// ---------------------------------------------------------------------------
// What this module refuses to collect, and why it is typed rather than
// commented (CLAUDE.md §21.1, `security-and-privacy` §5).
//
// A React Native Sentry event can carry a screenshot, a view hierarchy, and a
// session replay. On CoachOS those are not "extra context": the progress-photo
// screen, the body-metrics screen, and the food diary are all ordinary screens,
// so any one of the three is a direct capture of the highest-sensitivity data
// in the product. `false`/`0` here are literal types, so turning one on is a
// compile error rather than a working config change — the same guardrail
// `lib/analytics/posthog.ts` puts around session replay.
// ---------------------------------------------------------------------------
type ScreenCaptureForbidden = {
  readonly attachScreenshot: false;
  readonly attachViewHierarchy: false;
  readonly replaysSessionSampleRate: 0;
  readonly replaysOnErrorSampleRate: 0;
};

type SentryOptions = ReactNativeOptions & ScreenCaptureForbidden;

/**
 * Tags that may reach Sentry. `requestId` is OB§2's correlation id — the one
 * that makes a mobile crash and its server-side cause one search apart. It is
 * allowlisted here so that wiring it (`lib/request-id.ts`'s deferral note, in
 * `trpc-links.ts`) is a call site change and not a change to this file.
 */
const ALLOWED_TAGS = ['requestId', 'procedure', 'errorCode'] as const;

// The context types, derived from `ErrorEvent` rather than imported —
// `@sentry/react-native` re-exports `ErrorEvent` but not the context
// interfaces underneath it.
type Contexts = NonNullable<ErrorEvent['contexts']>;
type OsContext = NonNullable<Contexts['os']>;
type DeviceContext = NonNullable<Contexts['device']>;
type AppContext = NonNullable<Contexts['app']>;

function isPopulated(context: Record<string, unknown>): boolean {
  return Object.keys(context).length > 0;
}

/** The OS name and version. Never `build` or `kernel_version`. */
function scrubOs(source: OsContext | undefined): OsContext | undefined {
  if (!source) return undefined;
  const os: OsContext = {};
  if (typeof source.name === 'string') os.name = source.name;
  if (typeof source.version === 'string') os.version = source.version;
  return isPopulated(os) ? os : undefined;
}

/**
 * Enough to answer `observability-ops` §5's "the app is slow" with a device
 * class. **Never `name`**, which on iOS is routinely the owner's own name
 * ("Ammar's iPhone"), and never `device_unique_identifier`.
 */
function scrubDevice(source: DeviceContext | undefined): DeviceContext | undefined {
  if (!source) return undefined;
  const device: DeviceContext = {};
  if (typeof source.model === 'string') device.model = source.model;
  if (typeof source.family === 'string') device.family = source.family;
  if (typeof source.brand === 'string') device.brand = source.brand;
  if (typeof source.arch === 'string') device.arch = source.arch;
  if (typeof source.simulator === 'boolean') device.simulator = source.simulator;
  return isPopulated(device) ? device : undefined;
}

/**
 * The app version and build — the first question of every production
 * investigation. Never `device_app_hash`, which is a per-install device
 * identifier.
 */
function scrubApp(source: AppContext | undefined): AppContext | undefined {
  if (!source) return undefined;
  const app: AppContext = {};
  if (typeof source.app_name === 'string') app.app_name = source.app_name;
  if (typeof source.app_version === 'string') app.app_version = source.app_version;
  if (typeof source.app_identifier === 'string') app.app_identifier = source.app_identifier;
  // Not a declared field on Sentry's `AppContext`, but one both native SDKs
  // send — hence the `unknown` read and the guard.
  if (typeof source.app_build === 'string') app.app_build = source.app_build;
  return isPopulated(app) ? app : undefined;
}

/**
 * The event allowlist, rebuilt field by field — never `{ ...event }` with a
 * few keys deleted, which is a denylist wearing an allowlist's name and fails
 * open the moment an SDK upgrade adds a field. This is
 * `apps/api/src/lib/sentry.ts`'s `scrubEvent`, extended by exactly the fields
 * a mobile event needs and the server's has no analogue for.
 *
 * Three whole sections are dropped outright because no safe subset of them
 * exists on this platform:
 *
 * - **`breadcrumbs`** — on mobile these carry console output, fetch URLs
 *   (including signed R2 media URLs, which are live credentials —
 *   `security-and-privacy` §4), navigation params, and touch targets labelled
 *   with whatever text is on screen. `requestId` replaces them as the way to
 *   reconstruct a story (OB§2).
 * - **`request`** — headers (the `Authorization` bearer), cookies, query string.
 * - **`extra`** / anything a future call site invents — the point of an
 *   allowlist is that a new field is invisible until someone adds it here.
 *
 * `release`, `dist`, and `debug_meta` are kept **because** they are what makes
 * an uploaded source map match a stack trace. Dropping them would leave the
 * symbolication half of this task delivering minified gibberish.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const tags: Record<string, string> = {};
  for (const key of ALLOWED_TAGS) {
    const value = event.tags?.[key];
    if (typeof value === 'string') {
      tags[key] = value;
    }
  }

  const contexts: Contexts = {};
  const os = scrubOs(event.contexts?.os);
  if (os) contexts.os = os;
  const device = scrubDevice(event.contexts?.device);
  if (device) contexts.device = device;
  const app = scrubApp(event.contexts?.app);
  if (app) contexts.app = app;

  const userId = event.user?.id;

  return {
    // `ErrorEvent.type` is a required field whose only valid value is
    // literally `undefined` — Sentry's own discriminant between an error
    // event and every other event kind.
    type: undefined,
    ...(event.event_id !== undefined ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.level !== undefined ? { level: event.level } : {}),
    ...(event.message !== undefined ? { message: event.message } : {}),
    ...(event.exception !== undefined ? { exception: event.exception } : {}),
    ...(event.environment !== undefined ? { environment: event.environment } : {}),
    ...(event.platform !== undefined ? { platform: event.platform } : {}),
    ...(event.sdk !== undefined ? { sdk: event.sdk } : {}),
    // Symbolication inputs. Without these an uploaded source map has nothing
    // to bind to.
    ...(event.release !== undefined ? { release: event.release } : {}),
    ...(event.dist !== undefined ? { dist: event.dist } : {}),
    ...(event.debug_meta !== undefined ? { debug_meta: event.debug_meta } : {}),
    tags,
    ...(isPopulated(contexts) ? { contexts } : {}),
    ...(typeof userId === 'string' ? { user: { id: userId } } : {}),
  };
}

/**
 * The SDK configuration, in one frozen object so there is no seam through
 * which a caller passes options in — the same discipline
 * `lib/analytics/posthog.ts` applies to PostHog's.
 *
 * **Sampling, against the shared 5,000-errors/month budget (§3.4.3):**
 *
 * | Dial | Rate | Why |
 * |---|---|---|
 * | errors (`sampleRate`) | **1.0**, left unset | A dropped crash is an invisible bug. Same call apps/api makes and for the same reason. |
 * | `tracesSampleRate` | **0** | Transactions are the largest event source in any mobile SDK and have their own quota. Turning tracing on is a deliberate future decision, not a default. |
 * | `profilesSampleRate` | **0** | Follows tracing; profiles are meaningless without it. |
 * | replays | **0** | Also banned outright by CLAUDE.md §20 and typed shut above. |
 *
 * The budget is not actually defended by a fractional `sampleRate` — it is
 * defended by not *generating* events for things that are not bugs, which is
 * what `enableCaptureFailedRequests` and `enableAppHangTracking` below are.
 */
function buildSentryOptions(): SentryOptions {
  return Object.freeze({
    // `null` (unset, or rejected by the schema) becomes `undefined`, which is
    // the SDK's documented "initialise but send nothing" state.
    dsn: env.EXPO_PUBLIC_SENTRY_DSN ?? undefined,
    environment: __DEV__ ? 'development' : 'production',

    // See the sampling table above. `sampleRate` is deliberately absent: a
    // global rate applies to genuine unhandled crashes too.
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // CLAUDE.md §21.1 — see `ScreenCaptureForbidden`. Both are already the
    // SDK defaults; both are stated because a default is not a decision.
    attachScreenshot: false,
    attachViewHierarchy: false,

    // Never let an integration decide to attach PII (IP address, user agent,
    // request bodies) on our behalf.
    sendDefaultPii: false,

    // The single biggest event-volume lever on mobile, and the one that would
    // be wrong even if it were free: a client logging sets in a gym basement
    // produces failed requests continuously. Those are expected, handled by
    // the offline outbox, and are not crashes (`code-conventions` §8).
    enableCaptureFailedRequests: false,

    // An app hang is a performance signal, not a crash, and at the SDK's 2s
    // default it is the easiest way to spend the shared 5,000-event budget on
    // something `frontend-performance` measures better on a real device
    // (CLAUDE.md §19). Turn it on deliberately when the budget has headroom.
    enableAppHangTracking: false,

    // Kept on: session events are Sentry's crash-free-rate input, which is
    // what `release-ops` §5 watches during a staged rollout, and they do not
    // count against the error quota.
    enableAutoSessionTracking: true,

    // Connectivity, not a bug. These reach the global handler as unhandled
    // rejections whenever a fetch escapes a query's own error handling, and
    // `offline-sync` owns the actual behaviour. Applied by the SDK's default
    // `eventFiltersIntegration`; if `integrations` is ever overridden here,
    // this list stops working silently.
    ignoreErrors: ['Network request failed', 'AbortError'],

    // Collect no breadcrumbs at all, rather than collecting them and dropping
    // them in `beforeSend`. This is not belt-and-braces, it is load-bearing:
    // JS breadcrumbs are synced down to the native SDKs, and a *native* crash
    // is captured natively on the next launch without ever passing through
    // this JS `beforeSend`. Refusing them at `addBreadcrumb` time is the only
    // point that covers both paths.
    beforeBreadcrumb: () => null,

    beforeSend: scrubEvent,
  });
}

let isInitialised = false;

/**
 * Called once, at module scope in `src/app/_layout.tsx`, before any provider
 * mounts — a crash during the provider stack's own startup is exactly what
 * this needs to catch, and a component that has to render first would miss it.
 *
 * There is deliberately no `Sentry.wrap()` and no Sentry component in the
 * tree: `init()` installs the global error and unhandled-rejection handlers on
 * its own, and the only things `wrap()` adds are the touch-event boundary
 * (which breadcrumbs whatever text is under the user's thumb) and the render
 * profiler (tracing, which is off).
 */
export function initSentry(): void {
  if (isInitialised) {
    return;
  }
  isInitialised = true;
  // Spread into a fresh object: `Sentry.init` assigns its own defaults onto
  // the options it is handed, which would throw against the frozen one.
  Sentry.init({ ...buildSentryOptions() });
}

/** Exposed for `__tests__/sentry.test.ts` — the config, never the client. */
export function __getSentryOptionsForTest(): SentryOptions {
  return buildSentryOptions();
}

/** Test seam — resets module state between cases. Not called by app code. */
export function __resetSentryForTest(): void {
  isInitialised = false;
}
