// `account-actions/02` — the client-side twin of `pendingDeletionGate`,
// and the exact shape `guardian-consent-handling.ts` already uses for
// `GUARDIAN_CONSENT_PENDING`.
//
// Without it, any call made while the grace period is open — from a screen
// restored out of the persisted query cache, a notification tap, a deep
// link — renders `UI-UX.md` §UX8's generic error state with a Retry button
// that can never succeed, because the thing being waited on is the user's
// own decision to restore.
//
// **Never a toast.** `ACCOUNT_PENDING_DELETION` is a state, not an event:
// a screen can fire several gated calls in one batch, and a toast per
// rejection would stack three copies of the same sentence over a screen the
// person is already being moved away from (`ERRORS.md` ER§1.1 classes it
// Blocking, which is a screen, not a notification).
//
// This decides which screen a refusal lands on and nothing more. The server
// gate is what actually refuses the call (`CLAUDE.md` §6.2) — a patched app
// that ignored this would find every coach and client procedure closed
// anyway.
import { getErrorCode } from './error-code.ts';

/** `true` for an `ACCOUNT_PENDING_DELETION` rejection and nothing else. */
export function isAccountPendingDeletion(error: unknown): boolean {
  return getErrorCode(error) === 'ACCOUNT_PENDING_DELETION';
}

/**
 * Replaced once, at the root, by `PendingDeletionRedirect`. A settable
 * notifier rather than an `expo-router` import here for the same reason
 * `guardian-consent-handling.ts` has one: this module is pulled in by
 * `query/client.ts` at module scope, before any navigator exists, and a
 * navigation issued from that point is dropped silently.
 */
export let notifyAccountPendingDeletion: () => void = () => {
  if (__DEV__) {
    console.warn('ACCOUNT_PENDING_DELETION with no redirect installed — the call was refused.');
  }
};

export function setPendingDeletionNotifier(notifier: () => void): void {
  notifyAccountPendingDeletion = notifier;
}

/**
 * Wired into `query/client.ts`'s `QueryCache`/`MutationCache` `onError`
 * alongside the rate-limit and guardian-consent handlers, so every query and
 * mutation in the app passes through it. Every other error is left alone.
 *
 * The error carries no date — `ERRORS.md` ER§1.1 gives it an empty
 * `details` — so the screen it routes to reads `deletionScheduledFor` from
 * `me.get`, which the notifier invalidates before navigating.
 */
export function handlePendingDeletionError(error: unknown): void {
  if (isAccountPendingDeletion(error)) {
    notifyAccountPendingDeletion();
  }
}
