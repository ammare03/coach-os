import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { HEARTBEAT_INTERVAL_MS, useSessionHeartbeat } from '../useSessionHeartbeat.ts';

// `session-runtime/08` approach step 5. The heartbeat is what makes the
// server's fifteen-minute staleness rule safe in both directions, so what is
// asserted here is when it fires and — more importantly — when it does not:
// offline, backgrounded, or for a session this device is not logging. Each of
// those is a way a phone in a pocket holds a session it has no business
// holding.

const mockMutateAsync = jest.fn<Promise<{ outcome: string }>, [unknown]>(async () => ({
  outcome: 'renewed',
}));

jest.mock('../../../../lib/trpc.ts', () => ({
  api: { workouts: { heartbeat: { useMutation: () => ({ mutateAsync: mockMutateAsync }) } } },
}));

let mockIsConnected = true;
jest.mock('../../../../lib/connectivity/useConnectivity.ts', () => ({
  useConnectivity: () => ({ isConnected: mockIsConnected }),
}));

const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';

function Probe(props: { serverId: string | null; isActive: boolean }) {
  useSessionHeartbeat(props);
  return null;
}

function mount(props: { serverId?: string | null; isActive?: boolean } = {}) {
  // `??` would swallow an explicitly-passed `null`, which is the case one of
  // these tests exists to cover.
  const serverId = 'serverId' in props ? (props.serverId ?? null) : SERVER_ID;
  return render(<Probe serverId={serverId} isActive={props.isActive ?? true} />);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockMutateAsync.mockClear();
  mockIsConnected = true;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('while the logger is open', () => {
  it('claims immediately rather than waiting out the first interval', () => {
    // A device that started offline never got to claim; its first heartbeat
    // after the signal returns is when it records that it is the one logging.
    mount();

    // The session id and nothing else. A heartbeat that carried its own
    // instant would let a skewed device clock decide the staleness rule the
    // server owns (`packages/schemas/src/workouts.ts`).
    expect(mockMutateAsync).toHaveBeenCalledWith({ workoutSessionId: SERVER_ID });
  });

  it('keeps touching the claim on an interval well inside the staleness window', () => {
    mount();
    mockMutateAsync.mockClear();

    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(3);
    // Three ticks fit inside the server's fifteen minutes, so two can be
    // lost outright before a healthy device starts to look dead.
    expect(HEARTBEAT_INTERVAL_MS * 3).toBeLessThan(15 * 60 * 1_000);
  });

  it('re-asserts the claim the moment the app is foregrounded', () => {
    // The interval does not run reliably while an app is asleep, and the
    // client may have been away longer than the staleness window.
    //
    // The handler is captured off `addEventListener` rather than emitted on
    // `AppState`: jest-expo's mock has no event emitter, and driving the
    // subscription the hook actually registered is the more direct check.
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
        onChange = handler;
        return { remove: jest.fn() } as unknown as NativeEventSubscription;
      });

    mount();
    mockMutateAsync.mockClear();

    act(() => {
      onChange?.('active');
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('does not re-assert while the app is going to the background', () => {
    // A phone in a pocket is not a client logging sets, and holding the
    // session from there is the drawer-phone case.
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
        onChange = handler;
        return { remove: jest.fn() } as unknown as NativeEventSubscription;
      });

    mount();
    mockMutateAsync.mockClear();

    act(() => {
      onChange?.('background');
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('stops ticking entirely while the app is backgrounded, and resumes on return', () => {
    // The interval is not suspended on every platform — Android keeps firing
    // it for a backgrounded app — so a pocketed phone would go on asserting
    // a claim it has no business holding, and the fifteen-minute staleness
    // rule would never release the session to the client's other device.
    let onChange: ((state: AppStateStatus) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
        onChange = handler;
        return { remove: jest.fn() } as unknown as NativeEventSubscription;
      });

    mount();
    act(() => {
      onChange?.('background');
    });
    mockMutateAsync.mockClear();

    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();

    act(() => {
      onChange?.('active');
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('carries on when a tick fails, because a heartbeat is bookkeeping', () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('network request failed'));
    mount();

    expect(() =>
      act(() => {
        jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      }),
    ).not.toThrow();
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });
});

describe('when there is nothing to hold', () => {
  it('sends nothing while the device is offline', () => {
    // Offline is the logger's normal state. A tick that fires anyway just
    // queues a rejected promise every interval.
    mockIsConnected = false;
    mount();

    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('sends nothing for a session the server has never seen', () => {
    mount({ serverId: null });

    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('sends nothing for a session this device is not logging', () => {
    // The drawer-phone case, seen from the other side: a completed or paused
    // session must stop being held so another device can take it.
    mount({ isActive: false });

    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('stops as soon as the logger unmounts', () => {
    // Otherwise the claim outlives the screen and the six-hour ceiling
    // becomes the only thing that ever releases it.
    const view = mount();
    mockMutateAsync.mockClear();

    view.unmount();
    act(() => {
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});

describe('losing the claim', () => {
  it('does not interrupt the client mid-set', () => {
    // Set logs are device-wins and merge by their own keys (DB§14.3), so a
    // client whose other phone took over keeps logging. There is no state to
    // read here at all, and that is the point.
    mockMutateAsync.mockResolvedValue({ outcome: 'held_elsewhere' });

    const view = mount();

    expect(view.toJSON()).toBeNull();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});
