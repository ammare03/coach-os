// The single definition of the adherence-state thresholds
// (`CLAUDE.md` §8.2, DESIGN-SYSTEM.md DS§2.5). `theme-tokens/05` owns only
// this mapping from an already-computed score to a state name — P10
// `coach-review-surfaces/adherence-engine` extends this module with the
// score formula itself, never replaces it. Nowhere else in the repo may
// restate these numbers.
export type AdherenceState = 'on-track' | 'drifting' | 'off-track' | 'no-data';

// The DS§2.5 colour token each state maps to. The mapping from state to
// colour happens once, here — a component reads `ADHERENCE_TOKEN[state]`,
// it never re-decides what "on track" looks like.
export const ADHERENCE_TOKEN: Record<
  AdherenceState,
  'onTrack' | 'drifting' | 'offTrack' | 'noData'
> = {
  'on-track': 'onTrack',
  drifting: 'drifting',
  'off-track': 'offTrack',
  'no-data': 'noData',
};

/**
 * `null` is not an edge case to coalesce away — `ui-conventions` §2 is
 * explicit that a brand-new client with no logged sessions must never
 * render as failing. A caller that writes `adherenceState(score ?? 0)`
 * upstream of this function has already lost the distinction; this
 * function takes `null` itself so that mistake is harder to make.
 */
export function adherenceState(score: number | null): AdherenceState {
  if (score === null) return 'no-data';
  if (score >= 85) return 'on-track';
  if (score >= 70) return 'drifting';
  return 'off-track';
}
