import * as Notifications from 'expo-notifications';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { resetRestTimerForTests, useRestTimerStore } from '../../store/rest-timer-store.ts';
import {
  buildRestSurfaceContent,
  ensureRestTimerLiveActivity,
  formatRestRemaining,
  nextRestSurfaceUpdateMs,
  resetRestTimerLiveActivityForTests,
  selectRestSurfaceState,
  type RestSurfaceContent,
  type RestSurfacePresenter,
} from '../rest-timer-live-activity.ts';

// `phase-09-workout-logger/rest-timer/03`. Five things have to be true, and
// four of them are ways a client reads a rest that is not the one they are
// taking:
//
//  - the surface only exists while the app does not (decision (c));
//  - what it shows is derived from the anchor at the instant asked, and
//    agrees exactly with what the store's own tick would say (the acceptance
//    criterion);
//  - iOS never shows a countdown it cannot keep true (decision (b));
//  - a completed rest and a skipped one both dismiss it (decision (f));
//  - and nothing it does can throw into the logger.

// The real `expo-notifications` index registers a push-token listener at
// import time and warns about Expo Go for its trouble — noise in every suite
// that touches this file, for a module these tests never call for real. The
// same reason `jest.setup.ts` mocks Sentry.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { LOW: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { LOW: 'low' },
}));

const timer = () => useRestTimerStore.getState();

const STARTED_AT_MS = 1_757_000_000_000; // a fixed instant; the clock is injected everywhere
const TARGET_SECONDS = 90;
const ENDS_AT_MS = STARTED_AT_MS + TARGET_SECONDS * 1_000;

/** Deterministic stand-in for the device's locale clock. */
const formatEndTime = (endsAtMs: number): string => (endsAtMs === ENDS_AT_MS ? '10:42' : '??:??');

/**
 * Captures the handler the module registers rather than emitting on
 * `AppState`: jest-expo's mock has no event emitter, and driving the
 * subscription that was actually registered is the more direct check
 * (`store/__tests__/rest-timer-store.test.ts` does the same).
 */
function captureAppState() {
  const listener: { onChange?: (state: AppStateStatus) => void; remove: jest.Mock } = {
    remove: jest.fn(),
  };
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
      listener.onChange = handler;
      return { remove: listener.remove } as unknown as NativeEventSubscription;
    });
  return listener;
}

function fakePresenter(): RestSurfacePresenter & {
  present: jest.Mock<Promise<void>, [RestSurfaceContent]>;
  dismiss: jest.Mock<Promise<void>, []>;
} {
  return {
    present: jest.fn<Promise<void>, [RestSurfaceContent]>().mockResolvedValue(undefined),
    dismiss: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
}

/** Drains the fire-and-forget call chain the subscription queues. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  resetRestTimerLiveActivityForTests();
  resetRestTimerForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('formatRestRemaining', () => {
  it('pads the seconds so the figure does not change width as it counts', () => {
    expect(formatRestRemaining(90)).toBe('1:30');
    expect(formatRestRemaining(8)).toBe('0:08');
    expect(formatRestRemaining(605)).toBe('10:05');
  });

  it('never reads below zero', () => {
    expect(formatRestRemaining(-4)).toBe('0:00');
  });
});

describe('selectRestSurfaceState', () => {
  it('is absent while the app is foregrounded, however much rest is left', () => {
    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });

    expect(selectRestSurfaceState(timer(), false, STARTED_AT_MS + 10_000)).toEqual({
      kind: 'absent',
    });
  });

  it('is absent when no rest is running', () => {
    expect(selectRestSurfaceState(timer(), true, STARTED_AT_MS)).toEqual({ kind: 'absent' });
  });

  it('derives the countdown and the end instant from the anchor, not from the last tick', () => {
    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });

    // 30.4s in: the store's `remainingSeconds` still reads 90, because no
    // interval has fired. The surface must not.
    expect(timer().remainingSeconds).toBe(90);
    expect(selectRestSurfaceState(timer(), true, STARTED_AT_MS + 30_400)).toEqual({
      kind: 'present',
      remainingSeconds: 60,
      endsAtMs: ENDS_AT_MS,
    });
  });

  it("agrees exactly with the store's own tick at the same instant", () => {
    // The acceptance criterion, pinned: the two computations may never drift
    // apart, whatever either file does later.
    for (const elapsedMs of [1, 999, 1_000, 1_001, 45_500, 89_999]) {
      resetRestTimerForTests();
      timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });

      const nowMs = STARTED_AT_MS + elapsedMs;
      const surface = selectRestSurfaceState(timer(), true, nowMs);
      timer().tick(nowMs);

      expect(surface).toEqual({
        kind: 'present',
        remainingSeconds: timer().remainingSeconds,
        endsAtMs: ENDS_AT_MS,
      });
    }
  });

  it('is absent for a rest whose last second elapsed between the tick and the read', () => {
    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });

    expect(selectRestSurfaceState(timer(), true, ENDS_AT_MS + 1)).toEqual({ kind: 'absent' });
  });
});

describe('buildRestSurfaceContent', () => {
  const present = { kind: 'present', remainingSeconds: 90, endsAtMs: ENDS_AT_MS } as const;

  it('carries the countdown and the end instant on Android, which can keep both true', () => {
    expect(buildRestSurfaceContent(present, 'android', formatEndTime)).toEqual({
      title: 'Rest',
      body: '1:30 left · until 10:42',
    });
  });

  it('carries only the end instant on iOS, where a countdown would freeze and lie', () => {
    const content = buildRestSurfaceContent(present, 'ios', formatEndTime);

    expect(content).toEqual({ title: 'Rest', body: 'Until 10:42' });
    expect(content.body).not.toMatch(/left/);
  });

  it('names nothing about the client, the exercise, or the load — a lock screen is public', () => {
    const content = buildRestSurfaceContent(present, 'android', formatEndTime);
    const line = `${content.title} ${content.body}`;

    expect(line).not.toMatch(/kg|lb|rep|set |squat/i);
    // `COPY.md` §CO6 — sentence case, no exclamation mark.
    expect(line).not.toMatch(/!/);
  });
});

describe('nextRestSurfaceUpdateMs', () => {
  it('re-posts every five seconds on Android for a rest with time in hand', () => {
    expect(nextRestSurfaceUpdateMs(90, 'android')).toBe(5_000);
  });

  it('tightens to once a second inside the last fifteen', () => {
    expect(nextRestSurfaceUpdateMs(15, 'android')).toBe(1_000);
    expect(nextRestSurfaceUpdateMs(3, 'android')).toBe(1_000);
  });

  it('never schedules on iOS, where the body cannot change', () => {
    expect(nextRestSurfaceUpdateMs(90, 'ios')).toBeNull();
  });

  it('stops at zero', () => {
    expect(nextRestSurfaceUpdateMs(0, 'android')).toBeNull();
  });
});

describe('ensureRestTimerLiveActivity', () => {
  function start(presenter: RestSurfacePresenter, platform: 'ios' | 'android' = 'ios') {
    const appState = captureAppState();
    ensureRestTimerLiveActivity({
      presenter,
      platform,
      now: () => Date.now(),
      initialAppState: 'active',
      formatEndTime,
    });
    return appState;
  }

  it('posts nothing while the logger is on screen', async () => {
    const presenter = fakePresenter();
    start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    await flush();

    expect(presenter.present).not.toHaveBeenCalled();
  });

  it('posts the rest when the client locks the phone', async () => {
    const presenter = fakePresenter();
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS + 30_000);
    appState.onChange?.('background');
    await flush();

    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(presenter.present).toHaveBeenCalledWith({ title: 'Rest', body: 'Until 10:42' });
  });

  it('ignores the transient inactive state rather than churning a card on every peek', async () => {
    const presenter = fakePresenter();
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('inactive');
    await flush();

    expect(presenter.present).not.toHaveBeenCalled();
    expect(presenter.dismiss).not.toHaveBeenCalled();
  });

  it('dismisses when the rest runs out naturally', async () => {
    const presenter = fakePresenter();
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();
    expect(presenter.present).toHaveBeenCalledTimes(1);

    jest.spyOn(Date, 'now').mockReturnValue(ENDS_AT_MS);
    timer().tick(ENDS_AT_MS);
    await flush();

    // A natural completion leaves `startedAtMs` set for task 04 to alert on;
    // this surface still goes away.
    expect(timer().startedAtMs).toBe(STARTED_AT_MS);
    expect(presenter.dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses just as silently when the rest is skipped', async () => {
    const presenter = fakePresenter();
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();

    timer().stopRest();
    await flush();

    expect(timer().startedAtMs).toBeNull();
    expect(presenter.dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses when the client comes back to the app', async () => {
    const presenter = fakePresenter();
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();

    appState.onChange?.('active');
    await flush();

    expect(presenter.dismiss).toHaveBeenCalledTimes(1);
  });

  it('re-posts a fresh countdown on the Android cadence, and only when it changes', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const presenter = fakePresenter();
    const appState = start(presenter, 'android');
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();
    expect(presenter.present).toHaveBeenLastCalledWith({
      title: 'Rest',
      body: '1:30 left · until 10:42',
    });

    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS + 5_000);
    jest.advanceTimersByTime(5_000);
    await flush();

    expect(presenter.present).toHaveBeenLastCalledWith({
      title: 'Rest',
      body: '1:25 left · until 10:42',
    });
    // Two posts, not eleven: the store's own 1Hz interval fired five times in
    // that window and none of them may reach the OS.
    expect(presenter.present).toHaveBeenCalledTimes(2);
  });

  it('registers one set of listeners however many times it is called', () => {
    const presenter = fakePresenter();
    start(presenter);
    ensureRestTimerLiveActivity({ presenter, platform: 'ios', initialAppState: 'active' });

    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('swallows a presenter failure rather than letting it reach the logger', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const presenter = fakePresenter();
    presenter.present.mockRejectedValue(new Error('no permission'));
    const appState = start(presenter);
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);

    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();

    expect(warn).toHaveBeenCalledWith(
      'workouts.rest_surface_failed',
      expect.objectContaining({ errorName: 'Error' }),
    );
  });
});

describe('the default notification presenter', () => {
  const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
  const dismiss = Notifications.dismissNotificationAsync as jest.Mock;
  const permissions = Notifications.getPermissionsAsync as jest.Mock;

  beforeEach(() => {
    schedule.mockClear().mockResolvedValue('id');
    dismiss.mockClear().mockResolvedValue(undefined);
    permissions.mockClear().mockResolvedValue({ granted: true });
  });

  async function background(): Promise<void> {
    const appState = captureAppState();
    // Before the module captures it: `now` defaults to the `Date.now`
    // reference it holds at registration, not to a fresh lookup per call.
    jest.spyOn(Date, 'now').mockReturnValue(STARTED_AT_MS);
    ensureRestTimerLiveActivity({ initialAppState: 'active', formatEndTime });
    timer().startRest(TARGET_SECONDS, { sessionLocalId: 'local-1', nowMs: STARTED_AT_MS });
    appState.onChange?.('background');
    await flush();
  }

  it('posts one replaceable, silent, glanceable card', async () => {
    await background();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        // Decision (d) — one identifier, so a re-post replaces rather than stacks.
        identifier: 'coachos.rest-timer',
        content: expect.objectContaining({
          title: 'Rest',
          body: 'Until 10:42',
          // Decision (e) — the alert at zero is task 04's, and nothing here
          // may pre-empt it.
          sound: false,
          interruptionLevel: 'passive',
          sticky: true,
        }),
      }),
    );
  });

  it('removes exactly the card it posted when the rest ends', async () => {
    await background();

    timer().stopRest();
    await flush();

    expect(dismiss).toHaveBeenCalledWith('coachos.rest-timer');
  });

  it('reads the permission and never requests it', async () => {
    permissions.mockResolvedValue({ granted: false });

    await background();

    // Decision (g) — it asks the OS what the standing answer is, and a denied
    // answer costs a glance rather than a permission sheet mid-set.
    expect(permissions).toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});
