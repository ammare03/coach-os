import { act, render, renderHook } from '@testing-library/react-native';
import type { NetworkState, NetworkStateEvent } from 'expo-network';
import { Text } from 'react-native';

import { CONNECTIVITY_DEBOUNCE_MS, resetConnectivityForTests } from './store.ts';
import { useConnectivity } from './useConnectivity.ts';

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const network = jest.requireMock('expo-network') as {
  addNetworkStateListener: jest.Mock;
  getNetworkStateAsync: jest.Mock;
};

let listeners: ((event: NetworkStateEvent) => void)[] = [];

function emitAndSettle(event: NetworkStateEvent): void {
  act(() => {
    for (const listener of listeners) listener(event);
    jest.advanceTimersByTime(CONNECTIVITY_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  listeners = [];
  network.addNetworkStateListener.mockReset().mockImplementation((listener: () => void) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  network.getNetworkStateAsync.mockReset().mockReturnValue(new Promise<NetworkState>(() => {}));
});

afterEach(() => {
  resetConnectivityForTests();
  jest.useRealTimers();
});

describe('useConnectivity', () => {
  it('starts optimistic before the first reading lands', () => {
    const { result } = renderHook(() => useConnectivity());

    expect(result.current.isConnected).toBe(true);
  });

  it('re-renders the consumer when connectivity is lost and regained', () => {
    const { result } = renderHook(() => useConnectivity());

    emitAndSettle({ isConnected: false, isInternetReachable: false });
    expect(result.current.isConnected).toBe(false);

    emitAndSettle({ isConnected: true, isInternetReachable: true });
    expect(result.current.isConnected).toBe(true);
  });

  it('keeps a stable object identity while the value is unchanged', () => {
    const { result, rerender } = renderHook(() => useConnectivity());
    const first = result.current;

    rerender(undefined);

    expect(result.current).toBe(first);
  });

  it('registers one listener and reports one value across several consumers', () => {
    function Consumer({ label }: { label: string }) {
      const { isConnected } = useConnectivity();
      return <Text>{`${label}:${isConnected ? 'online' : 'offline'}`}</Text>;
    }

    const screen = render(
      <>
        <Consumer label="a" />
        <Consumer label="b" />
        <Consumer label="c" />
      </>,
    );

    // The whole point of the shared store: three consumers, one native listener.
    expect(network.addNetworkStateListener).toHaveBeenCalledTimes(1);

    emitAndSettle({ isConnected: false, isInternetReachable: false });

    expect(screen.getByText('a:offline')).toBeTruthy();
    expect(screen.getByText('b:offline')).toBeTruthy();
    expect(screen.getByText('c:offline')).toBeTruthy();
  });
});
