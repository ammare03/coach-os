import { colors } from '@coachos/ui/theme';
import * as Notifications from 'expo-notifications';
import {
  AppState,
  Platform,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

import { useRestTimerStore, type RestTimerState } from '../store/rest-timer-store.ts';

// `phase-09-workout-logger/rest-timer/03` — the rest a client can read
// without unlocking their phone. Task 02 made the countdown survive the lock
// screen; until this file it survived it invisibly, which answers §8.4's
// "survives backgrounding" and not its "runs in a live activity /
// notification".
//
// Seven decisions, in the order they matter:
//
// (a) **A notification, not a Live Activity — and that is a stack decision,
//     not a shortfall.** `expo-notifications` 57.0.17, the version installed,
//     exposes no ActivityKit surface at all: no `LiveActivity` export, and no
//     mention of Live Activities in the SDK 57 reference (checked against the
//     package's own `build/index.d.ts`, not from memory). `expo-widgets` does,
//     it went stable in SDK 56, and it is the right eventual answer — but it
//     is a new dependency with no `CLAUDE.md` §3.1 row, it generates a second
//     native target, and its views may only be written in `@expo/ui/swift-ui`,
//     the package `workspace-scaffold/03` deliberately stripped so there would
//     not be two ways to render a button (§3.1.1). Adopting it is a §3 entry
//     and a prebuild, which is more than this task is scoped to spend.
//     Task 03's own acceptance criterion names this fallback, and the design
//     for the Live Activity is specified alongside it so that adopting it
//     later is a build rather than a redesign.
//
// (b) **A relative countdown that cannot be updated is a false statement; an
//     absolute end time is not.** iOS suspends JS the moment the screen
//     locks, so a body reading "1:30 left" is wrong by however long the phone
//     stayed in a pocket — and wrong in the direction that matters, because
//     it claims rest remains when the set is already late. So the surface
//     always carries `until 10:42`, an instant derived from the same
//     `startedAtMs + targetSeconds` the in-app timer derives from and
//     therefore never stale, and **iOS carries nothing else**. Android, which
//     can keep re-posting, carries the countdown as well. Neither platform
//     ever shows a number it cannot keep true.
//
// (c) **It exists only while the app does not.** Nothing is posted while the
//     logger is on screen: the in-app countdown is the surface there, and a
//     banner over the set composer would cover the confirm control the client
//     is reaching for. Posting on the transition to `background` and
//     dismissing on the return to `active` also means this file never touches
//     `setNotificationHandler`, which is app-global and `phase-15-notifications`'s,
//     and that Android re-posts nothing at all while anyone is watching.
//
// (d) **One identifier, re-used.** Re-scheduling `REST_SURFACE_NOTIFICATION_ID`
//     replaces the card in place on both platforms. A fresh identifier every
//     five seconds would stack eighteen notifications across a ninety-second
//     rest.
//
// (e) **A silent, low-importance channel, and a `passive` interruption
//     level.** This is a surface to glance at. The alert at zero is
//     `rest-timer/04` and has to be the only thing in this feature that makes
//     a sound — a default-importance channel re-posted every five seconds
//     would buzz a client's pocket eighteen times per rest.
//
// (f) **Completed and skipped dismiss identically.** Task 04 distinguishes
//     them, because one earns an alert and the other must not (a natural
//     completion leaves `startedAtMs` set; `stopRest` returns the store to
//     full idle). This file does not: in both cases the rest is over and the
//     card has stopped being true. {@link selectRestSurfaceState} reads
//     `isRunning` and nothing else.
//
// (g) **The permission is read, never requested.** A permission sheet in the
//     middle of a set is the worst available moment to ask, and
//     `features/onboarding/notification-permission.ts` already asked at the
//     moment the value was explained. If the answer was no, this surface
//     silently does not exist and the workout is unaffected.
//
// **The known limitation, stated rather than hidden:** between zero and the
// next moment JS is alive, the iOS card lingers. It reads "until 10:42" at
// 10:45 — stale but not false — and clears on the next foreground, or on the
// cold-start restore, which `rest-timer-persistence.ts` already reports as
// `{ kind: 'expired' }`. That is the strongest single argument for decision
// (a) being revisited.
//
// ⚠️ `expo-notifications` is a NATIVE module. Everything here needs a
// dev-client rebuild and can never arrive over OTA (`CLAUDE.md` §25.1,
// §25.11). It is also the second file in the app to import it: the first,
// `features/onboarding/notification-permission.ts`, owns *requesting* the
// permission; this one owns *presenting* with it. Two named entry points for
// two capabilities, which is the point of that file's single-import rule
// rather than an exception to it.

/** DB-free singleton id — decision (d). */
export const REST_SURFACE_NOTIFICATION_ID = 'coachos.rest-timer';

/** The Android channel this surface owns, and the only one it posts to — decision (e). */
export const REST_SURFACE_CHANNEL_ID = 'rest-timer';

/**
 * The one token either OS will accept from us; the rest of the card is the
 * system's, which is why nothing else here is styled. Scheme-invariant by
 * necessity — a notification has no theme to read.
 */
const BRAND_ACCENT = colors.brand.DEFAULT;

const SECOND_MS = 1_000;
const COARSE_UPDATE_MS = 5_000;
const FINE_UPDATE_MS = 1_000;

/**
 * Below this, the Android re-post cadence tightens to once a second.
 *
 * Cadence tracks consequence: a five-second-stale "1:30" costs nothing, and a
 * five-second-stale "0:05" is the difference between standing up in time and
 * not.
 */
const FINE_UPDATE_THRESHOLD_SECONDS = 15;

/** What the surface should be showing, or that it should not exist. */
export type RestSurfaceState =
  | { kind: 'absent' }
  | {
      kind: 'present';
      /** Whole seconds left at the instant asked, never the store's last tick. */
      remainingSeconds: number;
      /** `startedAtMs + targetSeconds` — the value decision (b) rests on. */
      endsAtMs: number;
    };

/** The two strings the OS typesets. Everything else on the card is the system's. */
export interface RestSurfaceContent {
  title: string;
  body: string;
}

/** Platforms this app builds for, as `Platform.OS` reports them. */
export type SurfacePlatform = typeof Platform.OS;

/**
 * What the surface should be, given the timer, whether the app is
 * backgrounded, and the clock.
 *
 * `nowMs` rather than `rest.remainingSeconds` deliberately: a background
 * transition lands wherever it lands inside the store's one-second tick, and
 * the criterion is that this surface matches the timestamp computation
 * *exactly*. The arithmetic is the store's `tick` verbatim — ceiling, not
 * floor, so a rest reads "1" until the last second has actually elapsed.
 *
 * `inactive` never reaches here — see {@link ensureRestTimerLiveActivity}.
 */
export function selectRestSurfaceState(
  rest: RestTimerState,
  isBackgrounded: boolean,
  nowMs: number,
): RestSurfaceState {
  // Decision (c).
  if (!isBackgrounded) return { kind: 'absent' };
  // Decision (f) — one field, both endings.
  if (!rest.isRunning || rest.startedAtMs === null) return { kind: 'absent' };

  const remainingSeconds = Math.ceil(rest.targetSeconds - (nowMs - rest.startedAtMs) / SECOND_MS);
  // A rest whose last second elapsed between the store's tick and this call.
  // Nothing is gained by posting a countdown that reads zero.
  if (remainingSeconds <= 0) return { kind: 'absent' };

  return {
    kind: 'present',
    remainingSeconds,
    endsAtMs: rest.startedAtMs + rest.targetSeconds * SECOND_MS,
  };
}

/**
 * `m:ss`, with the seconds always two digits so the figure does not change
 * width as it counts (`DESIGN.md` §1.2's tabular rule, in the one place we
 * cannot set a font).
 */
export function formatRestRemaining(remainingSeconds: number): string {
  const total = Math.max(0, Math.ceil(remainingSeconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The wall-clock instant the rest ends, in the device's own locale and its
 * own 12/24-hour setting.
 *
 * `Intl` rather than a formatter of ours: this is a clock time, not a
 * quantity, so `packages/utils`' unit rules do not reach it, and hardcoding
 * `HH:mm` would show a 24-hour clock to a client whose phone is set to 12
 * (`COPY.md` §CO6 — never a hardcoded format).
 */
export function formatRestEndTime(endsAtMs: number): string {
  return new Date(endsAtMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The one line of copy this feature puts on a lock screen.
 *
 * No exercise name, no load, no rep count, nothing about the client — a lock
 * screen is public (`COPY.md` §CO5). The rest period is the only fact this
 * surface needs and the only one it carries. Sentence case, numerals, noun
 * first, and nothing that diagnoses, prescribes, promises, or counts a miss.
 */
export function buildRestSurfaceContent(
  state: Extract<RestSurfaceState, { kind: 'present' }>,
  platform: SurfacePlatform,
  formatEndTime: (endsAtMs: number) => string = formatRestEndTime,
): RestSurfaceContent {
  const endsAt = formatEndTime(state.endsAtMs);
  // Decision (b) — the countdown only where it can be kept true.
  if (platform === 'android') {
    return {
      title: 'Rest',
      body: `${formatRestRemaining(state.remainingSeconds)} left · until ${endsAt}`,
    };
  }
  return { title: 'Rest', body: `Until ${endsAt}` };
}

/**
 * How long until the card needs re-posting, or `null` when it never does.
 *
 * `null` on iOS because decision (b) leaves nothing there that changes: the
 * body is one instant, fixed for the life of the rest. Scheduling a timer for
 * a body that cannot change would be scheduling it for a runtime that is
 * suspended anyway.
 */
export function nextRestSurfaceUpdateMs(
  remainingSeconds: number,
  platform: SurfacePlatform,
): number | null {
  if (platform !== 'android') return null;
  if (remainingSeconds <= 0) return null;
  return remainingSeconds <= FINE_UPDATE_THRESHOLD_SECONDS ? FINE_UPDATE_MS : COARSE_UPDATE_MS;
}

/**
 * The OS side of this file, behind one interface so the rules above are
 * testable without a device — the `restoreRestTimer(deps)` precedent next
 * door.
 */
export interface RestSurfacePresenter {
  present: (content: RestSurfaceContent) => Promise<void>;
  dismiss: () => Promise<void>;
}

export interface RestTimerLiveActivityDeps {
  presenter?: RestSurfacePresenter;
  platform?: SurfacePlatform;
  /** Injected only so the countdown is testable; the app never passes it. */
  now?: () => number;
  /** Injected only so the first evaluation is testable; the app reads `AppState`. */
  initialAppState?: AppStateStatus;
  formatEndTime?: (endsAtMs: number) => string;
}

let started = false;
let storeUnsubscribe: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let isBackgrounded = false;
/** The content actually on screen, so an unchanged second is not a second post. */
let postedContent: RestSurfaceContent | null = null;

/**
 * One chain for the whole app, the `rest-timer-persistence.ts` idiom: present
 * and dismiss must not interleave, or a stale post lands after the dismiss
 * that ended it and resurrects a rest that is over. Failures are swallowed
 * into the chain so one rejection cannot strand what is queued behind it.
 */
let pendingCall: Promise<void> = Promise.resolve();

function enqueue(run: () => Promise<void>): void {
  pendingCall = pendingCall.then(run).catch((error: unknown) => {
    // Decision (g)'s sibling: a surface that will not post costs a glance,
    // and the client's sets are durable regardless. A code and the shape of
    // the failure, never its contents (`observability-ops` §1).
    console.warn('workouts.rest_surface_failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  });
}

/**
 * Registers the store subscription and the one `AppState` listener this file
 * has, and never a second of either however many times it is called — the
 * same module-scope, idempotent shape `ensureRestTimerPersistence` and
 * `ensureConnectivityTracking` use. There is no matching stop: the listeners
 * live as long as the app does.
 *
 * This is a *second* `AppState` listener alongside the store's, deliberately.
 * The store's ignores everything but `active` because its job is to tick;
 * this one's job is to know which side of the foreground boundary the app is
 * on, and it never ticks anything, so there is no shared state for two
 * listeners to advance twice.
 */
export function ensureRestTimerLiveActivity(deps: RestTimerLiveActivityDeps = {}): void {
  if (started) return;
  started = true;

  const platform = deps.platform ?? Platform.OS;
  const now = deps.now ?? Date.now;
  const presenter = deps.presenter ?? createNotificationPresenter();
  const formatEndTime = deps.formatEndTime ?? formatRestEndTime;

  isBackgrounded = (deps.initialAppState ?? AppState.currentState) === 'background';

  const evaluate = (): void => {
    if (updateTimer !== null) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }

    const desired = selectRestSurfaceState(useRestTimerStore.getState(), isBackgrounded, now());

    if (desired.kind === 'absent') {
      if (postedContent === null) return;
      postedContent = null;
      enqueue(() => presenter.dismiss());
      return;
    }

    const content = buildRestSurfaceContent(desired, platform, formatEndTime);
    if (
      postedContent === null ||
      postedContent.title !== content.title ||
      postedContent.body !== content.body
    ) {
      postedContent = content;
      enqueue(() => presenter.present(content));
    }

    const delayMs = nextRestSurfaceUpdateMs(desired.remainingSeconds, platform);
    if (delayMs !== null) updateTimer = setTimeout(evaluate, delayMs);
  };

  storeUnsubscribe = useRestTimerStore.subscribe(evaluate);
  appStateSubscription = AppState.addEventListener('change', (state) => {
    // `inactive` is the transient iOS state — the app switcher, an incoming
    // call, a pulled-down Notification Center. Treating it as either side of
    // the boundary would post and dismiss a card on every peek; the `active`
    // or `background` that follows is what decides.
    if (state === 'inactive') return;
    isBackgrounded = state === 'background';
    evaluate();
  });

  evaluate();
}

/**
 * The default presenter: one `expo-notifications` card, replaced in place.
 *
 * The permission read and the channel write are memoised per process — both
 * are idempotent, and re-asking on every five-second re-post would put two
 * native round-trips inside a loop that runs eighteen times a rest.
 */
function createNotificationPresenter(): RestSurfacePresenter {
  let permission: Promise<boolean> | null = null;
  let channel: Promise<void> | null = null;

  // Decision (g).
  const isPermitted = async (): Promise<boolean> => {
    permission ??= Notifications.getPermissionsAsync().then(
      (status) => status.granted,
      // A simulator with no entitlement, a module in a state we do not expect
      // — none of it is the client's problem, and none of it may reach them.
      () => false,
    );
    return permission;
  };

  // Decision (e).
  const ensureChannel = async (): Promise<void> => {
    if (Platform.OS !== 'android') return;
    channel ??= Notifications.setNotificationChannelAsync(REST_SURFACE_CHANNEL_ID, {
      name: 'Rest timer',
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      enableLights: false,
      showBadge: false,
      // The card says "Rest" and an end time. There is nothing on it to hide,
      // and hiding it would defeat the one place it is read from.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }).then(() => undefined);
    return channel;
  };

  return {
    present: async (content) => {
      if (!(await isPermitted())) return;
      await ensureChannel();
      await Notifications.scheduleNotificationAsync({
        identifier: REST_SURFACE_NOTIFICATION_ID,
        content: {
          title: content.title,
          body: content.body,
          sound: false,
          // Android: ongoing, so a swipe does not lose the countdown
          // mid-rest. It is removed by us, never by the client's cuff.
          sticky: true,
          priority: Notifications.AndroidNotificationPriority.LOW,
          color: BRAND_ACCENT,
          // iOS: added to the list without lighting the screen or making a
          // sound — decision (e).
          interruptionLevel: 'passive',
        },
        trigger: Platform.OS === 'android' ? { channelId: REST_SURFACE_CHANNEL_ID } : null,
      });
    },
    dismiss: async () => {
      if (!(await isPermitted())) return;
      await Notifications.dismissNotificationAsync(REST_SURFACE_NOTIFICATION_ID);
    },
  };
}

/** Test-only teardown — drops both subscriptions, the pending re-post, and the posted state. */
export function resetRestTimerLiveActivityForTests(): void {
  if (updateTimer !== null) clearTimeout(updateTimer);
  updateTimer = null;
  storeUnsubscribe?.();
  storeUnsubscribe = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  started = false;
  isBackgrounded = false;
  postedContent = null;
  pendingCall = Promise.resolve();
}
