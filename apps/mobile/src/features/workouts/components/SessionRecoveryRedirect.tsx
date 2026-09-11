import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuthStore } from '../../auth/store.ts';
import {
  checkForInProgressSession,
  LOGGER_ROUTE,
  type SessionRecovery,
} from '../lib/session-recovery.ts';

// `session-runtime/06`'s mount side. `PendingDeepLinkReplay` is the
// precedent for the shape and the position: mounted at the root, after
// `<Stack>`, rendering nothing.
//
// It is a component rather than a hook called from `_layout.tsx` for that
// file's own stated reason — its position in the tree, and therefore its
// effect ordering against the other two root redirects, is visible at the
// mount site instead of implied by a line number.
//
// Five rules, in the order they matter:
//
// (a) **It runs once per app launch and never again.** The ref is set
//     before the read resolves, so the check cannot re-enter. A second run
//     is not a harmless retry: a client who deliberately left the logger
//     would be dragged back into it, which is worse than never recovering
//     at all.
//
// (b) **It is mounted BEFORE `PendingDeepLinkReplay`, so an explicit deep
//     link wins.** Sibling effects flush in tree order, so the replay's
//     `router.replace` is the last word. A client who tapped a link asked
//     for that destination; an automatic resume did not.
//
// (c) **`push`, never `replace`.** The logger's own way out prefers
//     `router.back()` and only falls back to Today
//     (`app/(client)/workout/[sessionId].tsx`), so pushing leaves the stack
//     the client expects — Today behind the session they were in. Replacing
//     would empty the history and make the exit take the fallback branch.
//
// (d) **It waits for the schema-version check, and cannot check that
//     itself.** `local-database/04` may drop and re-fetch the whole mirror,
//     and this task's interface puts the recovery read strictly after it —
//     a read that beat it would resume into a row about to be discarded and
//     land the client on the logger's not-found state. `_layout.tsx` keeps
//     rendering `<Stack>` and this component while that check is still in
//     flight (only `'confirm-required'` replaces the tree), so the gate has
//     to arrive as a prop. Calling `useSchemaVersionGate()` here would run
//     a SECOND `checkSchemaVersion()`, which is the opposite of waiting for
//     the first.
//
// (e) **A failure is a console line and nothing else.** The client lands on
//     Today, which already ranks an in-progress session first and offers
//     Continue (`useTodaySession`'s `pickTodaySession`). There is no screen
//     worth showing for "we could not check", and one taken away from the
//     first thing they see would be worse than the one tap it costs.

export interface SessionRecoveryRedirectProps {
  /**
   * Whether `local-database/04`'s schema-version check has answered — rule
   * (d). Required rather than defaulted, so the mount site has to say.
   */
  isLocalDatabaseReady: boolean;
  /** Injected only by tests; the app always uses the real local read. */
  check?: () => Promise<SessionRecovery>;
}

/** Renders nothing. Re-enters a session the client was mid-way through when the app died. */
export function SessionRecoveryRedirect({
  isLocalDatabaseReady,
  check,
}: SessionRecoveryRedirectProps): null {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  // `undefined` until the root navigator has mounted; an imperative
  // navigation before that is dropped silently.
  const navigationKey = useRootNavigationState()?.key;

  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current || navigationKey === undefined) return;
    // Rule (d).
    if (!isLocalDatabaseReady) return;
    // The logger lives under `(client)`, and a client still in onboarding is
    // being redirected out of it by the gate — landing them in a fullscreen
    // focus mode would fight that. Each condition is a reason there is
    // nothing to recover into, never a reason to drop the row.
    if (status !== 'authenticated' || role !== 'client' || !isOnboarded) return;

    // Rule (a) — before the await, so a re-render inside the read cannot
    // start a second one.
    hasChecked.current = true;

    // No cancellation flag, deliberately. This is a one-shot navigation with
    // nothing to undo, and cancelling it on a dependency change would throw
    // away the only attempt this launch gets (rule (a)). After unmount the
    // app is going away and `router.push` is a no-op.
    void (check ?? checkForInProgressSession)().then(
      (recovery) => {
        if (recovery.kind !== 'resume') return;
        router.push({
          pathname: LOGGER_ROUTE,
          params: { sessionId: recovery.sessionLocalId },
        });
      },
      (error: unknown) => {
        // Rule (d). A code and the shape of the failure, never the message
        // and never the session id's contents (`observability-ops` §1).
        console.warn('workouts.session_recovery_failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      },
    );
  }, [check, isLocalDatabaseReady, status, role, isOnboarded, navigationKey]);

  return null;
}
