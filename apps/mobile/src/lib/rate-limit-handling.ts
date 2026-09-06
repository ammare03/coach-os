import { getErrorCode, getErrorDetails } from './error-code.ts';

export interface RateLimitInfo {
  retryAfterSeconds: number;
}

/** `null` for anything that isn't a `RATE_LIMITED` rejection. */
export function getRateLimitInfo(error: unknown): RateLimitInfo | null {
  if (getErrorCode(error) !== 'RATE_LIMITED') {
    return null;
  }
  return getErrorDetails(error, 'RATE_LIMITED');
}

/**
 * The seam `phase-04-design-system/screen-states/03`'s Toast component
 * plugs into (`03-per-route-config-and-429-handling.md`'s "surfaces a
 * toast" requirement) — `packages/ui` has no components yet (its own
 * barrel is still empty), so this can't call a real one today.
 * `setRateLimitNotifier` is how that phase swaps this default for the real
 * toast, in one line, with no change to `query/client.ts` or this file's
 * other exports. Until then, dev-only console output keeps a rate limit
 * observable during development instead of silently swallowed — CLAUDE.md
 * §7.5: a failed action gets a designed state, not nothing.
 */
export let notifyRateLimited: (info: RateLimitInfo) => void = (info) => {
  if (__DEV__) {
    console.warn(`Rate limited — retry in ${info.retryAfterSeconds}s`);
  }
};

export function setRateLimitNotifier(notifier: (info: RateLimitInfo) => void): void {
  notifyRateLimited = notifier;
}

/**
 * Wired into `query/client.ts`'s `QueryCache`/`MutationCache` `onError` —
 * every query and mutation passes through here, so a `RATE_LIMITED`
 * rejection is caught centrally instead of requiring each feature to check
 * for it itself. Every other error is left alone; the generic error path
 * (loading/empty/error states, `ui-conventions`) still handles those.
 *
 * This file used to export the two caches themselves. `guardian-consent/06`
 * moved their construction into `query/client.ts`, because a cache takes
 * exactly one `onError` and there are now two codes with a central answer —
 * a `rateLimitCaches` here would have had to grow a second, unrelated
 * handler to keep its name honest.
 */
export function handleRateLimitError(error: unknown): void {
  const info = getRateLimitInfo(error);
  if (info) {
    notifyRateLimited(info);
  }
}
