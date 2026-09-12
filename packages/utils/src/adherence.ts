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

// The adherence score itself (`CLAUDE.md` §8.2), added by
// `phase-10-coach-review-surfaces/adherence-engine/01`.
//
// Everything below is on a 0–100 percentage scale, never a 0–1 fraction —
// the same scale as §8.2's thresholds and as
// `daily_nutrition_summary.adherence_score` (`DATABASE.md` DB§5.3), so a
// caller never converts. `null` means "no data" and is distinct from `0`
// everywhere it appears; a brand-new client has not failed at anything.

/** One day's already-evaluated nutrition targets, per §8.2's definition. */
export type NutritionDay = {
  hasLogging: boolean;
  /** `|calories - target| <= 10%` */
  withinCalorieRange: boolean;
  /** `protein >= 90%` of target */
  meetsProteinTarget: boolean;
};

export type AdherenceColor = 'green' | 'amber' | 'red' | 'grey';

/**
 * `(completed / scheduled) * 100` over an already-windowed pair of counts —
 * selecting the 7-day window is the caller's job.
 *
 * Zero scheduled sessions is "no data", not "0% adherent", so it returns
 * `null`; zero *completed* against a real schedule is a true 0. Not capped
 * at 100 — a client who trained more often than programmed did.
 */
export function computeTrainingAdherence(
  completedSessions: number,
  scheduledSessions: number,
): number | null {
  if (!Number.isFinite(completedSessions) || !Number.isFinite(scheduledSessions)) return null;
  if (scheduledSessions <= 0) return null;

  return (completedSessions / scheduledSessions) * 100;
}

/**
 * The share of *logged* days that hit both targets. Days with no logging at
 * all leave the denominator rather than scoring zero, and a window with no
 * logged day is `null`.
 *
 * Distinct from `v_client_overview.nutrition_adherence_7d`, which is a SQL
 * `avg()` over per-day scores written by `phase-13-nutrition/nutrition-summary/01`
 * from the identical per-day booleans — two call sites that agree by rule,
 * not one shared path (`adherence-engine/02`).
 */
export function computeNutritionAdherence(days: readonly NutritionDay[]): number | null {
  const loggedDays = days.filter((day) => day.hasLogging);
  if (loggedDays.length === 0) return null;

  const adherentDays = loggedDays.filter(
    (day) => day.withinCalorieRange && day.meetsProteinTarget,
  ).length;

  return (adherentDays / loggedDays.length) * 100;
}

/**
 * `0.6 * training + 0.4 * nutrition` (§8.2). The weights are a product
 * decision, not a tunable.
 *
 * ⚠️ **Interpretive decision — `adherence-engine/01`, revisit via `CLAUDE.md` §27.**
 * §8.2's formula assumes both dimensions exist. When one is `null` this
 * weights only the dimension that has data, rather than zero-filling the
 * missing one: a client who trained perfectly and logged no food would
 * otherwise read as 60% adherent, which is a number nobody chose. The
 * product may instead want a missing dimension to make the whole score
 * grey — if so, that correction is recorded in §27 and changed here, the
 * one place it is computed.
 */
export function computeOverallAdherence(
  trainingPercent: number | null,
  nutritionPercent: number | null,
): number | null {
  if (trainingPercent === null && nutritionPercent === null) return null;
  if (nutritionPercent === null) return trainingPercent;
  if (trainingPercent === null) return nutritionPercent;

  return 0.6 * trainingPercent + 0.4 * nutritionPercent;
}

// A total mapping over `adherenceState`, never its own comparison: the
// thresholds are stated once at the top of this file and the feature's
// acceptance criterion is that they are never re-derived. Colour is what a
// coach scanning 30 cards actually reads, so it must not be able to
// disagree with the state name beside it.
const STATE_COLOR: Record<AdherenceState, AdherenceColor> = {
  'on-track': 'green',
  drifting: 'amber',
  'off-track': 'red',
  'no-data': 'grey',
};

/** §8.2's colour for an overall score: green ≥85, amber 70–84, red <70, grey for no data. */
export function adherenceColor(overallPercent: number | null): AdherenceColor {
  return STATE_COLOR[adherenceState(overallPercent)];
}
