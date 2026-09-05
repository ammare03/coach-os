import { type PropsWithChildren, useEffect } from 'react';

import { useAuthStore } from '../../features/auth/store.ts';

import type { AnalyticsRole } from './events.ts';
import { initAnalytics, setAnalyticsIdentity } from './posthog.ts';

// Mounts PostHog at the root layout's outermost slot and keeps the
// analytics identity in step with the session.
//
// **This is not PostHog's own `<PostHogProvider>`, and that is deliberate.**
// Mounting theirs would do two things this task exists to prevent: it
// installs autocapture (AN§2.2 — it captures screen text), and it publishes
// the raw client through `usePostHog()`, which is precisely the escape
// hatch `track-event.ts` is the alternative to. Without their provider
// mounted there is no PostHog context in the tree, so `usePostHog()` has
// nothing to hand out and autocapture has nowhere to run.
//
// It renders no UI and holds no state, so it never re-renders the tree
// beneath it.

function toIdentity(
  state: ReturnType<typeof useAuthStore.getState>,
): { userId: string; role: AnalyticsRole } | null {
  if (state.status !== 'authenticated' || state.userId === null || state.role === null) {
    return null;
  }
  return { userId: state.userId, role: state.role };
}

export function AnalyticsProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    // Fire and forget: initialisation reads the OS tracking permission,
    // and nothing below may wait on analytics to render (AN§0.6).
    void initAnalytics();

    setAnalyticsIdentity(toIdentity(useAuthStore.getState()));
    // An imperative subscription rather than a selector hook: this
    // component wraps the whole app, and re-rendering the tree on every
    // auth transition to attach an id would be a cost with no output.
    return useAuthStore.subscribe((state) => {
      setAnalyticsIdentity(toIdentity(state));
    });
  }, []);

  return <>{children}</>;
}
