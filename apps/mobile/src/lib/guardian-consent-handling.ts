// `guardian-consent/06` Approach step 5 — the central handler, and the
// same shape `rate-limit-handling.ts` already uses for `RATE_LIMITED`.
//
// Without it, any gated call made from anywhere — a notification tap, a
// deep link, a screen restored from the persisted query cache — renders
// `UI-UX.md` §UX8's generic error state with a Retry button that can never
// succeed, because the thing being waited on is a parent opening an email.
// A dead Retry is worse than no Retry: it invites a fifteen-year-old to tap
// it until they close the app.
//
// This is the client-side twin of the server gate, not a substitute for it.
// `guardian-consent/03` is what actually refuses the call (`CLAUDE.md`
// §6.2); this only decides which screen the refusal lands on.
import { getErrorCode } from './error-code.ts';

/** `true` for a `GUARDIAN_CONSENT_PENDING` rejection and nothing else. */
export function isGuardianConsentPending(error: unknown): boolean {
  return getErrorCode(error) === 'GUARDIAN_CONSENT_PENDING';
}

/**
 * Replaced once, at the root, by `GuardianConsentRedirect`. A settable
 * notifier rather than an `expo-router` import here for the same reason
 * `rate-limit-handling.ts` has one: this module is pulled in by
 * `query/client.ts` at module scope, before any navigator exists, and a
 * navigation issued from that point is dropped silently.
 */
export let notifyGuardianConsentPending: () => void = () => {
  if (__DEV__) {
    console.warn('GUARDIAN_CONSENT_PENDING with no redirect installed — the call was refused.');
  }
};

export function setGuardianConsentNotifier(notifier: () => void): void {
  notifyGuardianConsentPending = notifier;
}

/**
 * Wired into `query/client.ts`'s `QueryCache`/`MutationCache` `onError`
 * alongside `handleRateLimitError`, so every query and mutation in the app
 * passes through it. Every other error is left alone — the generic error
 * path still handles those.
 */
export function handleGuardianConsentError(error: unknown): void {
  if (isGuardianConsentPending(error)) {
    notifyGuardianConsentPending();
  }
}
