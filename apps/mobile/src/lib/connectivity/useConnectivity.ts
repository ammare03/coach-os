import { useEffect, useMemo } from 'react';

import { ensureConnectivityTracking, useConnectivityStore } from './store.ts';

export interface Connectivity {
  isConnected: boolean;
}

/**
 * The one way a component asks whether the device is online
 * (`connectivity/01`). Every consumer reads the same store, fed by the same
 * single `expo-network` listener, so two components can never disagree about
 * the current state.
 *
 * Do not add an `expo-network` listener anywhere else — independent listeners
 * report the same change at slightly different times (that task's Risks).
 */
export function useConnectivity(): Connectivity {
  useEffect(() => {
    ensureConnectivityTracking();
  }, []);

  // A selector, never the bare store hook: this must not re-render on any
  // future field added alongside it (`frontend-performance` §3).
  const isConnected = useConnectivityStore((state) => state.isConnected);

  // Stable identity so a consumer can put the returned object in a dependency
  // array without looping.
  return useMemo(() => ({ isConnected }), [isConnected]);
}
