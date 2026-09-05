import type { Href } from 'expo-router';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '../../auth/store.ts';

import { resolveDeepLink } from './link-table.ts';
import { takePendingDeepLink } from './pending.ts';

// `phase-05-app-shell/deep-linking/04`, the other half of `pending.ts`.
//
// Mounted in `src/app/_layout.tsx` AFTER `<Stack>`, and both of those matter.
// At the root, because it has to run whichever group the gate lands on; after
// the `<Stack>`, because sibling effects flush in tree order and the gate's
// redirect lives inside that subtree — the replay has to be the last word or
// the gate overwrites it, which is the exact bug this task exists to prevent.

/**
 * Renders nothing. It is a component rather than a hook called from
 * `_layout.tsx` so that its position in the tree — and therefore its effect
 * ordering against the gate — is visible at the mount site instead of
 * implied by a line number.
 */
export function PendingDeepLinkReplay(): null {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  // The root navigator's key is `undefined` until it has mounted; an
  // imperative navigation before that is dropped silently.
  const navigationKey = useRootNavigationState()?.key;

  useEffect(() => {
    if (status === 'loading' || navigationKey === undefined) {
      return;
    }

    const link = takePendingDeepLink();
    if (link === null) {
      return;
    }

    const target = resolveDeepLink(link, role);
    if (target.status !== 'resolved') {
      // Still unresolvable with a settled session — a client's `/client/{id}`,
      // or a link parked before a sign-in that never came. Dropped rather
      // than held, so it cannot surface later in someone else's session.
      return;
    }

    // `replace`, never `push`: the deep link IS the entry point, so there is
    // no group root behind it that a back gesture should return to.
    //
    // The cast is the one place a built path meets `Href`. Every href comes
    // from the §9.3 table, and that each one is a real route is asserted in
    // `__tests__/link-table-9-3.test.ts` — a check `Href` cannot do for a
    // string assembled at runtime.
    router.replace(target.href as Href);
  }, [status, role, navigationKey]);

  return null;
}
