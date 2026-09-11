import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { SESSION_KEEP_AWAKE_TAG, useSessionKeepAwake } from '../useSessionKeepAwake.ts';

// `session-runtime/05`. Two failures are worth real tests here and they pull
// in opposite directions: a screen that sleeps mid-rest is the frustration the
// task exists to remove, and a lock that outlives the session is a battery
// regression against `CLAUDE.md` §19's 90-minute/<25% budget. Everything below
// is one or the other.

const mockActivate = jest.fn<Promise<void>, [string]>(async () => {});
const mockDeactivate = jest.fn<Promise<void>, [string]>(async () => {});

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (tag: string) => mockActivate(tag),
  deactivateKeepAwake: (tag: string) => mockDeactivate(tag),
}));

/** Drains the hook's promise chain. A macrotask, so every queued microtask has run by the time it resolves. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

/**
 * Captures the handler the hook registers rather than emitting on `AppState`:
 * jest-expo's mock has no event emitter, and driving the subscription the hook
 * actually registered is the more direct check (`useSessionHeartbeat.test.tsx`
 * does the same).
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

function Probe({ isActive }: { isActive: boolean }) {
  useSessionKeepAwake({ isActive });
  return null;
}

function mount(isActive = true) {
  return render(<Probe isActive={isActive} />);
}

beforeEach(() => {
  mockActivate.mockClear();
  mockDeactivate.mockClear();
  mockActivate.mockImplementation(async () => {});
  mockDeactivate.mockImplementation(async () => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('while a session is being logged', () => {
  it('holds the screen awake', async () => {
    mount();
    await settle();

    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('holds it under a named tag, so nothing else can release it by accident', async () => {
    // `expo-keep-awake` reference-counts by tag: a release only drops the lock
    // it names. Taking the default tag would let any future holder — a live
    // call, a video — release this one mid-set, and be released by it.
    mount();
    await settle();

    expect(mockActivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);
    expect(SESSION_KEEP_AWAKE_TAG).not.toBe('ExpoKeepAwakeDefaultTag');
  });

  it('renders nothing and returns nothing', () => {
    // The logger has the tightest frame budget in the product (`CLAUDE.md`
    // §19); a lock that reported its state would cost it a render for nothing.
    const view = mount();

    expect(view.toJSON()).toBeNull();
  });
});

describe('every way out of the logger', () => {
  it('releases on unmount — the exit button, a deep link, a back gesture alike', async () => {
    // The cleanup is the only release path, which is what makes it cover all
    // of them: none of those routes is special-cased, so none can be missed.
    const view = mount();
    await settle();

    view.unmount();
    await settle();

    expect(mockDeactivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);
  });

  it('releases when the session stops being logged, without unmounting', async () => {
    // Completion (task 07) flips `isActive` while the screen is still up. The
    // client reading their summary does not need the screen pinned awake.
    const view = render(<Probe isActive />);
    await settle();

    view.rerender(<Probe isActive={false} />);
    await settle();

    expect(mockDeactivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);
  });

  it('releases even when the exit beats the activation', async () => {
    // The real leak this hook exists to prevent. `activateKeepAwakeAsync` is
    // async, so a fast open-then-leave can resolve the activate AFTER a
    // cleanup that ran first — leaving a lock nothing will ever release. The
    // operations are serialised for exactly this case.
    let resolveActivate: (() => void) | undefined;
    mockActivate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveActivate = resolve;
        }),
    );

    const view = mount();
    await settle();
    expect(mockActivate).toHaveBeenCalledTimes(1);

    view.unmount();
    await settle();

    // Cleanup has run, but the activate it must follow is still in flight, so
    // the release is queued rather than lost.
    expect(mockDeactivate).not.toHaveBeenCalled();

    await act(async () => {
      resolveActivate?.();
    });
    await settle();

    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).toHaveBeenCalledTimes(1);
    expect(mockActivate.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeactivate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stops listening to app state once it has let go', async () => {
    // A listener left behind would re-acquire the lock on the next foreground,
    // for a screen that is no longer there.
    const appState = captureAppState();
    const view = mount();
    await settle();

    view.unmount();

    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});

describe('a phone that goes in a pocket', () => {
  it('releases on background and takes the lock again on return', async () => {
    // Task 08's lesson, in reverse. A session left holding the screen from a
    // pocket is the battery regression `CLAUDE.md` §19 budgets against, and it
    // is not safe to assume the platform releases it — this asserts we do.
    const appState = captureAppState();
    mount();
    await settle();
    mockActivate.mockClear();

    await act(async () => {
      appState.onChange?.('background');
    });
    await settle();
    expect(mockDeactivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);

    await act(async () => {
      appState.onChange?.('active');
    });
    await settle();
    expect(mockActivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);
  });

  it('keeps the lock through `inactive`, which is not backgrounded', async () => {
    // The transient iOS state — the app switcher, an incoming call, a
    // notification banner. Releasing here would let the screen dim the moment
    // a banner appeared mid-set, and `useSessionHeartbeat` draws the same line.
    const appState = captureAppState();
    mount();
    await settle();

    await act(async () => {
      appState.onChange?.('inactive');
    });
    await settle();

    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('takes no lock at all when the screen mounts already backgrounded', async () => {
    // A session resumed by a notification tap while the app is still settling.
    //
    // Swapped by descriptor rather than `jest.replaceProperty`, which refuses
    // it: jest-expo stubs `currentState` as a mock *function*, not the string
    // the real AppState exposes.
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      value: 'background',
      configurable: true,
      writable: true,
    });

    try {
      mount();
      await settle();

      expect(mockActivate).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(AppState, 'currentState', original);
    }
  });
});

describe('when there is nothing to hold', () => {
  it('takes no lock for a session that is not being logged', async () => {
    // A completed or paused session opened for review. Pinning the screen
    // awake for it is pure battery cost (`frontend-performance` §8).
    mount(false);
    await settle();

    expect(mockActivate).not.toHaveBeenCalled();
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('registers no app-state listener it would never use', async () => {
    const appState = captureAppState();
    mount(false);
    await settle();

    expect(appState.onChange).toBeUndefined();
  });
});

describe('when the platform refuses', () => {
  it('does not take down the logger, and never blocks a release behind a failure', async () => {
    // Keep-awake is a comfort, not the workout. A rejected activate must not
    // surface to a client mid-set — and must not poison the chain, or the
    // release that follows it would never run and the lock would leak.
    mockActivate.mockRejectedValueOnce(new Error('unavailable'));

    const view = mount();
    await settle();

    view.unmount();
    await settle();

    expect(mockDeactivate).toHaveBeenCalledWith(SESSION_KEEP_AWAKE_TAG);
    expect(console.warn).toHaveBeenCalledWith(
      'workouts.keep_awake_failed',
      expect.objectContaining({ errorName: 'Error' }),
    );
  });
});
