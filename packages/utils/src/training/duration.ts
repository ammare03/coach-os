// How long a session took — one rule, one implementation.
//
// It existed in two places before this file: `useCompleteSession`'s
// `durationSeconds` (the figure `workout_completed` reports) and
// `useTodaySession`'s `resolvePhase` (the figure the completed Today card
// prints), and the two disagreed — one floored, the other rounded. Either
// is defensible alone; both together mean the analytics event and the card
// can state a different number for the same session. `session-summary/01`
// would have made it three, so the rule moved here instead
// (`code-conventions` §1: a formula that exists twice is already wrong in
// one place).
//
// **Floor wins.** A session is never longer than it actually was, and a
// figure the client reads next to a gym clock must not round up past it.

const MS_PER_SECOND = 1_000;

/**
 * Whole seconds from `started_at` to `completed_at`, floored, never below
 * zero.
 *
 * Zero for a non-finite instant, and zero for a finish that precedes its own
 * start — a device clock that moved backwards mid-session reports the
 * latter, and a negative duration is not one. The server clamps the stored
 * column the same way, so the row and the device agree.
 *
 * Both arguments are epoch milliseconds, which is what `local_workout_sessions`
 * stores and what `Date.getTime()` returns.
 */
export function sessionDurationSeconds(startedAtMs: number, completedAtMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) return 0;
  return Math.max(0, Math.floor((completedAtMs - startedAtMs) / MS_PER_SECOND));
}
