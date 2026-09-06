import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { setGuardianConsentNotifier } from '../../lib/guardian-consent-handling.ts';

// `guardian-consent/06` Approach step 5, mount side. `PendingDeepLinkReplay`
// is the precedent for the shape and the position: mounted at the root,
// after `<Stack>`, rendering nothing.
//
// It exists because `lib/guardian-consent-handling.ts` cannot navigate on
// its own — it is imported by `lib/query/client.ts` at module scope, long
// before a navigator exists, and a navigation issued from there is dropped
// silently. So that module holds a settable notifier and this component
// installs the real one once the root navigator has mounted.

export const GUARDIAN_CONSENT_PENDING_ROUTE = '/(client-onboarding)/guardian-consent-pending';

/** The route's own segment, as `useSegments()` reports it. */
const PENDING_SEGMENT = 'guardian-consent-pending';

/**
 * Renders nothing. A component rather than a hook called from `_layout.tsx`
 * so its position in the tree is visible at the mount site.
 */
export function GuardianConsentRedirect(): null {
  // `undefined` until the root navigator has mounted; navigating before
  // that is a no-op, so the notifier stays the dev-only warning until then.
  const navigationKey = useRootNavigationState()?.key;
  // `useSegments()` and not `usePathname()`: a pathname has the group
  // segment stripped, so it could never be compared against the href above.
  const segments = useSegments();
  const segmentsRef = useRef<readonly string[]>(segments);
  // In an effect, not during render: the notifier below is installed once
  // and reads this on every later rejection, so it has to see the CURRENT
  // route rather than the one at install time.
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (navigationKey === undefined) {
      return;
    }
    setGuardianConsentNotifier(() => {
      // A screen can fire several gated calls in one batch, and the pending
      // screen's own `me.get` is not one of them — but a stale cached
      // screen behind it might be. Re-navigating to the route already
      // showing would remount it and restart its query, so this checks
      // first.
      if (!segmentsRef.current.includes(PENDING_SEGMENT)) {
        router.replace(GUARDIAN_CONSENT_PENDING_ROUTE);
      }
    });
    // Deliberately not restored on unmount: this component unmounts only
    // when the whole app is going away, and an uninstalled notifier would
    // leave a window where a gated call renders a dead Retry again.
  }, [navigationKey]);

  return null;
}
