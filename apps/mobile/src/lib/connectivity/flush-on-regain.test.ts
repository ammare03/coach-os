import type { NetworkState, NetworkStateEvent } from 'expo-network';

import type { FlushOutboxResult } from '../outbox/flush.ts';

import { ensureFlushOnRegain, resetFlushOnRegainForTests } from './flush-on-regain.ts';
import { CONNECTIVITY_DEBOUNCE_MS, resetConnectivityForTests } from './store.ts';

// Same stand-in as `store.test.ts` — `expo-network` reaches a native module
// with no Jest-side implementation, and this is what lets a test drive a
// genuine offline period without a radio.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

// The flush itself opens SQLite and a tRPC client. What this task owns is the
// trigger, so `outbox/02` is a seam here and is tested on its own.
jest.mock('../outbox/flush.ts', () => ({ flushOutbox: jest.fn() }));

const network = jest.requireMock('expo-network') as {
  addNetworkStateListener: jest.Mock;
  getNetworkStateAsync: jest.Mock;
};
const outbox = jest.requireMock('../outbox/flush.ts') as { flushOutbox: jest.Mock };

const OFFLINE: NetworkStateEvent = { isConnected: false, isInternetReachable: false };
const ONLINE: NetworkStateEvent = { isConnected: true, isInternetReachable: true };
const NOTHING_FLUSHED: FlushOutboxResult = { claimed: 0, sent: 0, failed: 0 };

let listeners: ((event: NetworkStateEvent) => void)[] = [];

function emit(event: NetworkStateEvent): void {
  for (const listener of listeners) listener(event);
}

/** Emits a change and lets the store's debounce window elapse. */
function settle(event: NetworkStateEvent): void {
  emit(event);
  jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  listeners = [];
  network.addNetworkStateListener.mockReset().mockImplementation((listener: () => void) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  // Never resolves: these tests drive the listener, not the cold-start probe.
  network.getNetworkStateAsync.mockReset().mockReturnValue(new Promise<NetworkState>(() => {}));
  outbox.flushOutbox.mockReset().mockResolvedValue(NOTHING_FLUSHED);
});

afterEach(() => {
  resetFlushOnRegainForTests();
  resetConnectivityForTests();
  jest.useRealTimers();
});

describe('ensureFlushOnRegain', () => {
  it('flushes the outbox exactly once when connectivity returns after an offline period', () => {
    ensureFlushOnRegain();

    settle(OFFLINE);
    settle(ONLINE);

    expect(outbox.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('registers the network listener itself, so app start needs no second call', () => {
    ensureFlushOnRegain();

    expect(network.addNetworkStateListener).toHaveBeenCalledTimes(1);
  });

  it('does not flush while the device is merely already online', () => {
    ensureFlushOnRegain();

    settle(ONLINE);
    settle(ONLINE);

    expect(outbox.flushOutbox).not.toHaveBeenCalled();
  });

  it('does not flush when connectivity is lost', () => {
    ensureFlushOnRegain();

    settle(OFFLINE);

    expect(outbox.flushOutbox).not.toHaveBeenCalled();
  });

  it('does not flush on a flap that settles back where it started', () => {
    ensureFlushOnRegain();

    emit(OFFLINE);
    emit(ONLINE);
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);

    expect(outbox.flushOutbox).not.toHaveBeenCalled();
  });

  it('does not flush again while the device stays online after a regain', () => {
    ensureFlushOnRegain();

    settle(OFFLINE);
    settle(ONLINE);
    settle(ONLINE);

    expect(outbox.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('subscribes once however many times it is called', () => {
    ensureFlushOnRegain();
    ensureFlushOnRegain();
    ensureFlushOnRegain();

    settle(OFFLINE);
    settle(ONLINE);

    expect(outbox.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('calls flushOutbox again on a second regain rather than holding a guard of its own', () => {
    // `outbox/02` is single-flight: a call landing on a running flush joins it.
    // A guard here would instead DROP the second regain, which is the one
    // trigger that knows the radio just came back.
    let releaseFirstFlush: () => void = () => {};
    outbox.flushOutbox.mockReturnValueOnce(
      new Promise<FlushOutboxResult>((resolve) => {
        releaseFirstFlush = () => resolve(NOTHING_FLUSHED);
      }),
    );
    ensureFlushOnRegain();

    settle(OFFLINE);
    settle(ONLINE);
    settle(OFFLINE);
    settle(ONLINE);

    expect(outbox.flushOutbox).toHaveBeenCalledTimes(2);
    releaseFirstFlush();
  });

  it('warns with a code and stays unrejected when the flush fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    outbox.flushOutbox.mockRejectedValue(new Error('local database unavailable'));
    ensureFlushOnRegain();

    settle(OFFLINE);
    settle(ONLINE);
    await flushMicrotasks();

    expect(warn).toHaveBeenCalledWith(
      'connectivity.flush_on_regain_failed',
      expect.objectContaining({ errorCode: 'UNEXPECTED' }),
    );
    warn.mockRestore();
  });
});
