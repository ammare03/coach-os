import { formatWeightTarget, type WeightUnit } from '@coachos/utils';

import type { AnalyticsRecordType } from '../../../lib/analytics/events.ts';
import type { OutboxSendResult } from '../../../lib/outbox/results.ts';

import { speakWeight } from './target-line-copy.ts';

// `personal-records/03` — every word the PR pill says and every decision
// about which record it says it about. Kept out of the component for the
// reason `target-line-copy.ts` gives: copy fused into a render is copy you
// can only test by rendering, and this line is the one a client reads
// between two working sets.
//
// Five decisions, in the order they matter:
//
// (a) **One pill, never four.** A heavy single usually takes `max_weight`,
//     `1rm_estimated` and `max_volume` in the same tap. Four stacked pills
//     would cover the log list entirely and say nothing the first one did
//     not. {@link PR_PRIORITY} names one — heaviest-ever first, because it
//     is the record a lifter recognises without arithmetic — and the rest
//     become a `+N`. The full list is on the progress screen, which has a
//     Personal records section for exactly this.
//
// (b) **The sub-line ALWAYS names the exercise.** Detection is server-side
//     inside the write transaction, so an offline-logged set has no record
//     to celebrate until it syncs — and it can sync while the client is two
//     exercises further on (design frame D). "Heaviest ever, 92.5kg" with
//     no subject is at best confusing and at worst a lie about the exercise
//     on screen. Naming it costs one word and makes the line true whenever
//     it arrives.
//
// (c) **No superlative, no second person, no exclamation mark.** "Personal
//     record" and a fact. `COPY.md` §CO2's no-shame rule cuts both ways: a
//     product that cheers a good day has implied a verdict on a bad one,
//     and this is the client app, where the reader is the person being
//     judged (`product-copy` §3).
//
// (d) **A type it cannot name a value for is skipped, not printed empty.**
//     A bodyweight set has no weight, so `max_weight` has no value — the
//     pill falls to the next type it CAN complete rather than rendering
//     "heaviest ever, ". Null all the way down means no pill, which is
//     correct: nothing is better than a sentence with a hole in it.
//
// (e) **The record types are restated here, not imported.** The mobile app
//     never depends on `@coachos/db` (`lib/analytics/events.ts`), and the
//     ORDER below is this surface's own product decision rather than the
//     column's. `__tests__/pr-celebration.test.ts` pins the membership
//     against `PERSONAL_RECORD_TYPES` so the two cannot drift.

/**
 * The four record types `personal_records.record_type` holds, in the order
 * the pill prefers to name them — decision (a).
 */
export const PR_PRIORITY = ['max_weight', '1rm_estimated', 'max_reps', 'max_volume'] as const;

export type PersonalRecordType = (typeof PR_PRIORITY)[number];

/**
 * The record type as PostHog spells it.
 *
 * `AnalyticsRecordType`'s literals are deliberately not the column's, and a
 * `Record` rather than a lookup function so a fifth record type is a
 * compile error here rather than an event that silently carries nothing
 * (`analytics-events` §3).
 */
export const PR_ANALYTICS_TYPE: Record<PersonalRecordType, AnalyticsRecordType> = {
  max_weight: 'weight',
  '1rm_estimated': 'estimated_1rm',
  max_reps: 'reps',
  max_volume: 'volume',
};

export const PR_COPY = {
  /** Always these two words, whatever was beaten — decision (c). */
  title: 'Personal record',
  /** The `+N` badge's whole text. Never rendered at 0 (decision (a)). */
  moreLabel: (count: number) => `+${String(count)}`,
} as const;

/**
 * The tRPC path this surface listens for.
 *
 * Restated rather than imported from `hooks/useLogSet.ts`, which exports the
 * same literal: that module reaches SQLite, the outbox and the rest-timer
 * store, and this one is pure so it can be tested without any of them.
 */
const LOG_SET_PROCEDURE = 'workouts.logSet';

/** The `—` between the exercise and what it did. Spoken as a comma. */
const DASH = '—';

/** One set, as the server confirmed it and as this surface needs it. */
export interface ConfirmedRecordSet {
  /** `set_logs.client_local_id` — the dedup key, stable across every replay. */
  setLocalId: string;
  /** `local_workout_sessions.client_local_id`, from the outbox entry's own input. */
  sessionLocalId: string;
  exerciseId: string;
  reps: number;
  /** Kilograms, always (`CLAUDE.md` §0). `null` is a bodyweight set. */
  weightKg: number | null;
  /** Epley, as the server computed it. `null` for a bodyweight or zero-rep set. */
  estimated1rmKg: number | null;
  /** Non-empty, in the server's own order. */
  types: readonly PersonalRecordType[];
}

/** What the pill renders and what it says out loud. */
export interface PRCelebrationView {
  /**
   * Bumped once per celebration. The pill's dwell timer keys on it, so a
   * second record inside the 2.6s replaces the first in place and restarts
   * the clock rather than stacking (design, "Non-blocking means three
   * things": no queue).
   */
  token: number;
  /** The row that earned it — kept so the log row can keep its mark after the pill goes. */
  setLocalId: string;
  exerciseId: string;
  /** Always {@link PR_COPY.title}. */
  title: string;
  /**
   * `Bench press — heaviest ever,` — everything up to the figure.
   *
   * Split from the figure because the design sets them in different faces:
   * the words are Instrument Sans, the value is Space Grotesk with tabular
   * numerals, so a `92.5` cannot jitter against a `115`. Joining them here
   * as well keeps one string to assert copy against.
   */
  detailLead: string;
  /** `92.5kg` · `5`. Rendered through `Metric`, never `Text`. */
  detailValue: string;
  /** Types beaten beyond the one named. `0` hides the badge. */
  moreCount: number;
  /** The whole pill as one utterance, for `accessibilityLiveRegion="polite"`. */
  label: string;
  /** Every type this set took, for `personal_record_hit`. */
  types: readonly PersonalRecordType[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPersonalRecordType(value: unknown): value is PersonalRecordType {
  return (PR_PRIORITY as readonly string[]).includes(value as string);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A `workouts.logSet` response that took at least one record, or `null`.
 *
 * Null-returning rather than throwing for every way this can not apply: a
 * different procedure, an ordinary set, a warm-up (which the server never
 * credits), a body the transport mangled, an older server with no such
 * field. None of those is an error — the flush loop already succeeded, and
 * a celebration is the most optional thing in the product.
 */
export function readConfirmedRecords(sent: OutboxSendResult): ConfirmedRecordSet | null {
  if (sent.procedure !== LOG_SET_PROCEDURE) return null;
  if (!isRecord(sent.result)) return null;

  const raw: unknown = sent.result.newPersonalRecords;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(isPersonalRecordType)) return null;

  // The session comes from the outbox entry's own input, not the response:
  // the server answers with `workoutSessionId`, a server id an ad-hoc
  // session started in a basement does not have (`apps/api/.../log-set.ts`
  // decision (b)). The device's key is the only one both sides agree on.
  const sessionLocalId = sent.input.sessionClientLocalId;
  if (typeof sessionLocalId !== 'string' || sessionLocalId.length === 0) return null;

  const exerciseId = sent.result.exerciseId;
  if (typeof exerciseId !== 'string' || exerciseId.length === 0) return null;

  const reps = readNumber(sent.result.reps);
  if (reps === null) return null;

  return {
    setLocalId: sent.clientLocalId,
    sessionLocalId,
    exerciseId,
    reps,
    weightKg: readNumber(sent.result.weightKg),
    estimated1rmKg: readNumber(sent.result.estimated1rmKg),
    types: raw,
  };
}

interface RecordPhrase {
  /** `heaviest ever` · `most reps at 92.5kg`. */
  phrase: string;
  /** Printed: `92.5kg` · `5`. */
  value: string;
  /** Spoken: `92.5 kilograms` · `5`. */
  spokenValue: string;
}

/**
 * One record type, worded — or `null` when this set carries no value for it
 * (decision (d)).
 */
function phraseFor(
  type: PersonalRecordType,
  set: ConfirmedRecordSet,
  unit: WeightUnit,
): RecordPhrase | null {
  switch (type) {
    case 'max_weight':
      return set.weightKg === null
        ? null
        : {
            phrase: 'heaviest ever',
            value: formatWeightTarget(set.weightKg, unit),
            spokenValue: speakWeight(set.weightKg, unit),
          };

    case '1rm_estimated':
      return set.estimated1rmKg === null
        ? null
        : {
            phrase: 'best estimated 1RM',
            value: formatWeightTarget(set.estimated1rmKg, unit),
            spokenValue: speakWeight(set.estimated1rmKg, unit),
          };

    case 'max_reps': {
      // "Most reps" is only a record AT a load, so the load is part of the
      // phrase rather than the value — the value is the rep count. A
      // bodyweight set has no load and reads `most reps, 12`.
      const at = set.weightKg === null ? '' : ` at ${formatWeightTarget(set.weightKg, unit)}`;
      const reps = String(set.reps);
      return { phrase: `most reps${at}`, value: reps, spokenValue: reps };
    }

    case 'max_volume': {
      // Load × reps, the same product `packages/utils`' `sessionVolumeKg`
      // sums. A bodyweight set has no volume.
      if (set.weightKg === null) return null;
      const volumeKg = set.weightKg * set.reps;
      return {
        phrase: 'biggest set',
        value: formatWeightTarget(volumeKg, unit),
        spokenValue: speakWeight(volumeKg, unit),
      };
    }
  }
}

export interface CelebrationContext {
  /** From the session payload the device already holds — never from the response. */
  exerciseName: string;
  unit: WeightUnit;
  token: number;
}

/**
 * The pill, or `null` when nothing about this set can be worded.
 *
 * The count badge counts every OTHER type beaten, including ones that could
 * not have been named — "you also took two more" is true whether or not
 * this surface could have printed them.
 */
export function buildCelebration(
  set: ConfirmedRecordSet,
  context: CelebrationContext,
): PRCelebrationView | null {
  // Decision (d): the first priority that this set can complete, not
  // simply the first priority present.
  let named: { type: PersonalRecordType; phrase: RecordPhrase } | null = null;
  for (const candidate of PR_PRIORITY) {
    if (!set.types.includes(candidate)) continue;
    const phrase = phraseFor(candidate, set, context.unit);
    if (phrase !== null) {
      named = { type: candidate, phrase };
      break;
    }
  }
  if (named === null) return null;

  const { phrase, value, spokenValue } = named.phrase;
  // No trailing space: the two halves are separate nodes in a wrapping row,
  // so the gap between them is layout rather than a character a line break
  // could swallow.
  const detailLead = `${context.exerciseName} ${DASH} ${phrase},`;

  return {
    token: context.token,
    setLocalId: set.setLocalId,
    exerciseId: set.exerciseId,
    title: PR_COPY.title,
    detailLead,
    detailValue: value,
    moreCount: set.types.length - 1,
    // One sentence, polite, glyphs as words — the `—` becomes the comma a
    // screen reader can actually pause on (`target-line-copy.ts`'s rule).
    label: `${PR_COPY.title}. ${context.exerciseName}, ${phrase}, ${spokenValue}.`,
    types: set.types,
  };
}
