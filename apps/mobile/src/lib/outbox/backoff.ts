// DB§14.4's retry curve, and nothing else. Kept local to the outbox rather
// than promoted to `packages/utils` (which the task offers as an option):
// the server never reschedules a device's mutation, so a shared copy would
// have exactly one consumer forever — and `packages/utils` is for formulas
// both sides compute, not for every pure function
// (`code-conventions` §1).

/** The delay after the first failed attempt. Every later one doubles from here. */
export const BACKOFF_FIRST_DELAY_MS = 1_000;

/** DB§14.4's ceiling on the delay itself — five minutes, never longer. */
export const BACKOFF_CAP_MS = 300_000;

/**
 * How long to wait before the next send attempt, in milliseconds.
 *
 * `attempts` is the number of attempts **made so far, including the one
 * that just failed** — which is what `flush.ts`'s `scheduleRetry` has in
 * hand at the moment it needs a delay. So the sequence reads 1s, 2s, 4s,
 * 8s… exactly as DB§14.4 states, with `computeBackoff(1)` being the wait
 * after the first failure.
 *
 * Deliberately no jitter: DB§14.4 specifies a curve, and one device
 * retrying its own queue is not a thundering herd. Adding jitter would
 * make the sequence untestable against the spec's literal numbers for a
 * benefit this client does not have.
 */
export function computeBackoff(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts < 1) return BACKOFF_FIRST_DELAY_MS;
  const doubled = BACKOFF_FIRST_DELAY_MS * 2 ** (Math.trunc(attempts) - 1);
  // `2 ** 1024` is Infinity, and `Math.min(Infinity, cap)` is the cap — the
  // order here is what keeps an absurd attempt count from producing a row
  // that is never due again.
  return Math.min(doubled, BACKOFF_CAP_MS);
}
