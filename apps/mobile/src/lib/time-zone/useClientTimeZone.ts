import { useEffect } from 'react';

import { api } from '../trpc.ts';

import {
  ensureClientTimeZoneHydrated,
  publishClientTimeZone,
  resolveDeviceTimeZone,
  useClientTimeZoneStore,
} from './store.ts';

/**
 * The component-side half of `./store.ts` — the same value
 * `resolveClientTimeZone()` gives background code, and the one publisher
 * that keeps the two in step.
 *
 * `me.get` is a shared TanStack Query cache entry the rest of the app
 * already subscribes to, so this is a subscription rather than a round
 * trip, and it is what makes the returned value reactive: when the stored
 * zone arrives (or changes), every screen using this re-renders on the
 * client's real day boundary.
 *
 * The freshly-answered `me.get` value is preferred over the store for the
 * one render before the publish effect flushes. Reading `me.get` a tick
 * late would move a screen's day boundary for one frame, and the store is
 * about to hold exactly this value anyway.
 */
export function useClientTimeZone(): string {
  const me = api.me.get.useQuery();
  const stored = useClientTimeZoneStore((state) => state.stored);
  const fromServer = me.data?.timezone;

  // So a screen opened before any prefetch pass still gets the persisted
  // zone rather than the device's. Idempotent and memoised; every call
  // after the first is a resolved promise.
  useEffect(() => {
    void ensureClientTimeZoneHydrated();
  }, []);

  useEffect(() => {
    if (fromServer) publishClientTimeZone(fromServer);
  }, [fromServer]);

  return fromServer ?? stored ?? resolveDeviceTimeZone();
}
