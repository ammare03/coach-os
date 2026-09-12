import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { setPendingDeletionNotifier } from '../../lib/pending-deletion-handling.ts';
import { api } from '../../lib/trpc.ts';

import { useAuthStore } from './store.ts';

// `account-actions/02` — routing the blocking state, the same way
// `GuardianConsentRedirect` routes the guardian-consent one: mounted at the
// root, after `<Stack>`, rendering nothing.
//
// It has two triggers, and it needs both:
//
//   1. **`me.get` reports a `deletionScheduledFor`.** The authoritative
//      read, and the only one that works on a cold start — a person who
//      requested deletion on another device, or a week ago, opens the app
//      into this state with no error to react to.
//   2. **Any call was refused with `ACCOUNT_PENDING_DELETION`.** The state
//      changed while the app was open. The notifier invalidates `me.get`,
//      which feeds trigger 1 with the date the screen needs — the error
//      itself carries none (`ERRORS.md` ER§1.1's empty `details`).
//
// It is NOT mounted around `<Stack>`. Substituting a redirect for the root
// navigator changes its route key and remounts every provider beneath it —
// `AuthGate`'s own header comment measured that and the same cost applies
// here.

export const PENDING_DELETION_ROUTE = '/pending-deletion';

/** The route's own segment, as `useSegments()` reports it. */
const PENDING_SEGMENT = 'pending-deletion';

/**
 * The one route a pending-deletion session may still reach: exporting is
 * one of the three exits, and `me.requestExport` is deliberately left
 * reachable by where the server gate is attached. Redirecting off it would
 * close a door this state is required to leave open (`CLAUDE.md` §15.4:
 * data export is never gated).
 */
const EXPORT_SEGMENT = 'your-data';

/**
 * Renders nothing. A component rather than a hook called from `_layout.tsx`
 * so its position in the tree is visible at the mount site.
 */
export function PendingDeletionRedirect(): null {
  // `undefined` until the root navigator has mounted; navigating before
  // that is a no-op.
  const navigationKey = useRootNavigationState()?.key;
  const isAuthenticated = useAuthStore((state) => state.status === 'authenticated');
  const utils = api.useUtils();

  // `useSegments()` and not `usePathname()`: a pathname has the group
  // segment stripped, so a grouped route could never be compared against
  // an href.
  const segments = useSegments();
  const segmentsRef = useRef<readonly string[]>(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  // A subscription, not a round trip: `me.get` is a shared cache entry half
  // the app already reads, so this costs one more subscriber and no
  // request. Disabled while signed out, where there is no profile to fetch
  // and a 401 would be the only possible answer.
  const scheduledFor = api.me.get.useQuery(undefined, { enabled: isAuthenticated }).data
    ?.deletionScheduledFor;

  useEffect(() => {
    if (navigationKey === undefined) {
      return;
    }
    setPendingDeletionNotifier(() => {
      // The error has no date on it; `me.get` does. Invalidating first is
      // what makes the screen's date correct on arrival rather than one
      // render later.
      void utils.me.get.invalidate();
    });
    // Deliberately not restored on unmount: this unmounts only when the
    // whole app is going away, and an uninstalled notifier would leave a
    // window where a refused call renders a dead Retry.
  }, [navigationKey, utils]);

  useEffect(() => {
    if (navigationKey === undefined || !isAuthenticated || !scheduledFor) {
      return;
    }
    const active = segmentsRef.current;
    if (active.includes(PENDING_SEGMENT) || active.includes(EXPORT_SEGMENT)) {
      return;
    }
    // `replace`, never `push`: the tabs this leaves behind are refused by
    // the server anyway, and a back stack into them is a stack of error
    // states.
    router.replace(PENDING_DELETION_ROUTE);
  }, [navigationKey, isAuthenticated, scheduledFor, segments]);

  return null;
}
