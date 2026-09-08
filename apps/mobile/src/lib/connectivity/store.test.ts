import type { NetworkState, NetworkStateEvent } from 'expo-network';

import {
  CONNECTIVITY_DEBOUNCE_MS,
  ensureConnectivityTracking,
  resetConnectivityForTests,
  useConnectivityStore,
} from './store.ts';

// `expo-network` reaches a native module with no Jest-side implementation,
// so the listener and the probe are both stood in for here — which is also
// what lets a test emit a burst of transitions with no real radio involved.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const network = jest.requireMock('expo-network') as {
  addNetworkStateListener: jest.Mock;
  getNetworkStateAsync: jest.Mock;
};

const removeListener = jest.fn();
let listeners: ((event: NetworkStateEvent) => void)[] = [];

function emit(event: NetworkStateEvent): void {
  for (const listener of listeners) listener(event);
}

/** Lets the probe's `.then` run before assertions, without leaving fake timers. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  listeners = [];
  removeListener.mockClear();
  network.addNetworkStateListener.mockReset().mockImplementation((listener: () => void) => {
    listeners.push(listener);
    return { remove: removeListener };
  });
  // Never-resolving by default, so a test that cares about the listener is
  // not racing a probe it did not set up.
  network.getNetworkStateAsync.mockReset().mockReturnValue(new Promise<NetworkState>(() => {}));
});

afterEach(() => {
  resetConnectivityForTests();
  jest.useRealTimers();
});

describe('ensureConnectivityTracking', () => {
  it('registers exactly one expo-network listener however many times it is called', () => {
    ensureConnectivityTracking();
    ensureConnectivityTracking();
    ensureConnectivityTracking();

    expect(network.addNetworkStateListener).toHaveBeenCalledTimes(1);
  });

  it('applies the initial probe without waiting for the debounce window', async () => {
    network.getNetworkStateAsync.mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });

    ensureConnectivityTracking();
    await flushMicrotasks();

    expect(useConnectivityStore.getState().isConnected).toBe(false);
  });

  it('ignores the initial probe when a listener event already arrived', async () => {
    let resolveProbe: (state: NetworkState) => void = () => {};
    network.getNetworkStateAsync.mockReturnValue(
      new Promise<NetworkState>((resolve) => {
        resolveProbe = resolve;
      }),
    );

    ensureConnectivityTracking();
    emit({ isConnected: false, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
    resolveProbe({ isConnected: true, isInternetReachable: true });
    await flushMicrotasks();

    // The stale probe must not resurrect "online" over the newer event.
    expect(useConnectivityStore.getState().isConnected).toBe(false);
  });

  it('stays optimistic and warns when the initial probe rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    network.getNetworkStateAsync.mockRejectedValue(new Error('native module unavailable'));

    ensureConnectivityTracking();
    await flushMicrotasks();

    expect(useConnectivityStore.getState().isConnected).toBe(true);
    expect(warn).toHaveBeenCalledWith('connectivity.initial_probe_failed', expect.anything());
    warn.mockRestore();
  });
});

describe('connectivity state propagation', () => {
  it('propagates a settled change once the debounce window elapses', () => {
    ensureConnectivityTracking();

    emit({ isConnected: false, isInternetReachable: false });
    expect(useConnectivityStore.getState().isConnected).toBe(true);

    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
    expect(useConnectivityStore.getState().isConnected).toBe(false);
  });

  it('collapses a burst of flapping into a single notification carrying the final value', () => {
    ensureConnectivityTracking();
    const subscriber = jest.fn();
    const unsubscribe = useConnectivityStore.subscribe(subscriber);

    emit({ isConnected: false, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS / 4);
    emit({ isConnected: true, isInternetReachable: true });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS / 4);
    emit({ isConnected: false, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(useConnectivityStore.getState().isConnected).toBe(false);
    unsubscribe();
  });

  it('notifies nobody when a flap settles back where it started', () => {
    ensureConnectivityTracking();
    const subscriber = jest.fn();
    const unsubscribe = useConnectivityStore.subscribe(subscriber);

    emit({ isConnected: false, isInternetReachable: false });
    emit({ isConnected: true, isInternetReachable: true });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    // `connectivity/02` subscribes to this store to trigger a flush; a
    // no-op transition must not look like a regain.
    expect(subscriber).not.toHaveBeenCalled();
    expect(useConnectivityStore.getState().isConnected).toBe(true);
    unsubscribe();
  });

  it('reports a regain after a genuine offline period', () => {
    ensureConnectivityTracking();

    emit({ isConnected: false, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
    expect(useConnectivityStore.getState().isConnected).toBe(false);

    emit({ isConnected: true, isInternetReachable: true });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
    expect(useConnectivityStore.getState().isConnected).toBe(true);
  });
});

describe('reading a NetworkState', () => {
  it('trusts isInternetReachable over isConnected', () => {
    ensureConnectivityTracking();

    // A captive portal: attached to the network, no internet behind it.
    emit({ isConnected: true, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    expect(useConnectivityStore.getState().isConnected).toBe(false);
  });

  it('falls back to isConnected when reachability is unreported', () => {
    ensureConnectivityTracking();

    emit({ isConnected: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    expect(useConnectivityStore.getState().isConnected).toBe(false);
  });

  it('treats an entirely unknown state as connected', () => {
    ensureConnectivityTracking();
    emit({ isConnected: false, isInternetReachable: false });
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    emit({});
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    expect(useConnectivityStore.getState().isConnected).toBe(true);
  });
});
