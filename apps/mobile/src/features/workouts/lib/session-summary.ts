import {
  countWorkingSets,
  formatLocalDate,
  formatWeight,
  sessionDurationSeconds,
  sessionVolumeKg,
  totalTargetSets,
  type WeightUnit,
} from '@coachos/utils';
import { eq, inArray } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import {
  localExercisesCache,
  localSetLogs,
  localWorkoutSessions,
} from '../../../db/schema/local-training.ts';
import { readSessionPayload } from '../../../lib/prefetch/sessions.ts';
import type { SessionRecord } from '../store/session-records-store.ts';

import { buildCelebration } from './pr-celebration.ts';
import { speakWeight } from './target-line-copy.ts';

// `phase-09-workout-logger/session-summary/01` — everything the summary
// screen states, and where each figure comes from.
//
// Six decisions, in the order they matter:
//
// (a) **Every figure is computed on the device, from local rows.** The task
//     document says to read `total_volume_kg` and `duration_seconds` off
//     `local_workout_sessions`; those columns do not exist
//     (`db/schema/local-training.ts`) and never did — `session-runtime/07`
//     writes `status` and `completed_at` and nothing else. The columns are
//     the SERVER's, computed inside `workouts.complete`. Waiting for them
//     would put a round trip on the last screen of an offline-first flow,
//     which this task's own Risks section forbids, so the two rules run
//     here instead: `sessionVolumeKg` over this session's set logs and
//     `sessionDurationSeconds` over the two instants on its row. Both are
//     the same `packages/utils` rules the server and the Today card use, so
//     the device and the stored row cannot disagree by a rule.
//
// (b) **One pass, three queries, no query in a loop.** The session row, its
//     set logs, and the names of the exercises those logs reference — the
//     last by `inArray` over the ids the second returned
//     (`code-conventions` §7).
//
// (c) **A figure that cannot be computed is `null`, never `0`.**
//     `sessionVolumeKg` already returns `null` when no working set carried
//     both a weight and a rep count, and this preserves it: a bodyweight
//     session did not lift nothing (`COPY.md` CO§2). Duration is `null` for
//     a row with no `started_at`, and `targetSets` is `0` for a session with
//     nothing prescribed — the component drops the cell in each case rather
//     than printing a dash.
//
// (d) **The exercise name is resolved from the payload, then the cache.**
//     The payload is the prescription the client actually saw, so it wins;
//     the cache is what makes an ad-hoc session — which has no prescription
//     at all — still able to name the lift a record was taken on.
//
// (e) **Records are worded by `buildCelebration`, not by a second copy of
//     it.** Heaviest-ever first, the exercise always named, the other types
//     collapsed to a count, a type with no value skipped — four product
//     decisions with tests, in `lib/pr-celebration.ts`. The summary states
//     the same facts in a calmer surface; restating the rules here is how
//     the pill and the list start disagreeing about what a client beat.
//
// (f) **This module reads and never writes.** The summary is the terminal
//     screen of the session lifecycle; nothing it does may touch
//     `sync_state` or `updated_at`, which are `offline-sync` §5's record of
//     what the device still owes the server.

/**
 * One figure as the screen prints it, and as a screen reader says it.
 *
 * The spoken form is part of the figure rather than the component's, because
 * a stat carries its value AND its unit (`accessibility` §2) and the unit is
 * decided here — "4280 kilograms", never "4280 kay gee", and never the
 * digits alone.
 */
export interface SummaryFigure {
  value: string;
  unit?: string;
  /** The whole cell as one utterance. */
  label: string;
}

/** Everything one pass over the device found, in the shape the screen renders. */
export interface SessionSummaryRead {
  sessionLocalId: string;
  /** The session's own name, the program day's, or `null` — the header falls back. */
  name: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Working sets only. Warm-ups are ramp-up work, not progress through the plan. */
  setsLogged: number;
  /** `0` for a session with nothing prescribed — an ad-hoc one. Decision (c). */
  targetSets: number;
  /** Kilograms. `null` when no working set carried both a weight and reps. */
  volumeKg: number | null;
  /** `null` when the row has no `started_at`. */
  durationSeconds: number | null;
  /** `exercises.id` → library name, for every exercise this session logged against. */
  exerciseNames: ReadonlyMap<string, string>;
}

/**
 * One pass over the device for one session, or `null` when it holds no such
 * row.
 *
 * `null` is the summary's not-found state and is a real answer: a deep link
 * to a session this device never had, or one cleared by a schema-version
 * drop. A local-mirror fault still throws — that is `ERRORS.md` ER§1.4's
 * `LOCAL_READ_FAILED`, and the screen renders it as an error with a retry.
 */
export async function readSessionSummary(
  sessionLocalId: string,
  db?: LocalDb,
): Promise<SessionSummaryRead | null> {
  const database = db ?? (await getLocalDb());

  const [row] = await database
    .select()
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, sessionLocalId))
    .limit(1);
  if (!row) return null;

  const sets = await database
    .select({
      exerciseId: localSetLogs.exerciseId,
      reps: localSetLogs.reps,
      weightKg: localSetLogs.weightKg,
      isWarmup: localSetLogs.isWarmup,
    })
    .from(localSetLogs)
    .where(eq(localSetLogs.sessionLocalId, sessionLocalId));

  const payload = readSessionPayload(row.payloadJson);
  const exerciseNames = await resolveExerciseNames(database, sets, payload?.exercises ?? []);

  return {
    sessionLocalId: row.clientLocalId,
    name: row.name ?? payload?.session.name ?? payload?.session.dayName ?? null,
    startedAt: row.startedAt === null ? null : new Date(row.startedAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
    setsLogged: countWorkingSets(sets),
    targetSets: totalTargetSets(payload?.session.exercises ?? []),
    volumeKg: sessionVolumeKg(sets),
    durationSeconds:
      row.startedAt === null || row.completedAt === null
        ? null
        : sessionDurationSeconds(row.startedAt, row.completedAt),
    exerciseNames,
  };
}

/** Decision (d), and decision (b)'s third query. */
async function resolveExerciseNames(
  db: LocalDb,
  sets: readonly { exerciseId: string }[],
  fromPayload: readonly { id: string; name: string }[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  for (const exercise of fromPayload) names.set(exercise.id, exercise.name);

  const missing = [...new Set(sets.map((set) => set.exerciseId))].filter((id) => !names.has(id));
  if (missing.length === 0) return names;

  const cached = await db
    .select({ id: localExercisesCache.id, name: localExercisesCache.name })
    .from(localExercisesCache)
    .where(inArray(localExercisesCache.id, missing));
  for (const exercise of cached) names.set(exercise.id, exercise.name);

  return names;
}

const SECONDS_PER_MINUTE = 60;

/**
 * A session total, in the client's unit.
 *
 * `formatWeight` renders a lift to one decimal, which is right for a 62.5kg
 * bar and wrong for a four-figure session total: `4280.0` is three
 * characters of noise on a number nobody weighs. Stripped exactly as
 * `formatWeightTarget` strips it, and split from its unit so `Metric` can
 * set the two in their own faces (`DESIGN.md` §1.2).
 */
export function formatSessionVolume(volumeKg: number, unit: WeightUnit): SummaryFigure {
  return {
    value: Number(formatWeight(volumeKg, unit)).toString(),
    unit,
    label: `${SUMMARY_COPY.volume}, ${speakWeight(volumeKg, unit)}`,
  };
}

/**
 * Whole minutes. The same spelling the completed Today card uses, so the two
 * surfaces state one session's length one way.
 */
export function formatSessionDuration(seconds: number): SummaryFigure {
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  return {
    value: minutes.toString(),
    unit: 'min',
    label: `${SUMMARY_COPY.time}, ${plural(minutes, 'minute', 'minutes')}`,
  };
}

/**
 * `22 of 24` when the session was programmed, `9` when it was not.
 *
 * An ad-hoc session has no plan to be a fraction of, and `9 of 0` is a claim
 * about the client's workout that is simply false (the rule the Today card's
 * `describeContext` states for the same reason).
 */
export function formatSetsLogged(setsLogged: number, targetSets: number): SummaryFigure {
  const value = setsLogged.toString();
  return targetSets > 0
    ? {
        value,
        unit: `of ${String(targetSets)}`,
        label: `${SUMMARY_COPY.sets}, ${value} of ${String(targetSets)}`,
      }
    : { value, label: `${SUMMARY_COPY.sets}, ${value}` };
}

/**
 * `Sunday · finished 00:18` — in the CLIENT's zone, never the device's.
 *
 * A session finished at 00:18 IST finished on Sunday for the person who
 * trained it, whatever the phone is set to and wherever their coach is
 * reading it from (`CLAUDE.md` §25.5).
 */
export function describeFinishedAt(completedAt: Date, timeZone: string): string {
  const weekday = formatLocalDate(completedAt, timeZone, 'EEEE');
  const clock = formatLocalDate(completedAt, timeZone, 'HH:mm');
  return `${weekday} · finished ${clock}`;
}

/** One record as the summary lists it. `lib/pr-celebration.ts` words all of it. */
export interface SessionRecordLine {
  /** `set_logs.client_local_id` — the list key. */
  setLocalId: string;
  /** `Barbell back squat — heaviest ever,`. Instrument Sans. */
  lead: string;
  /** `102.5kg` · `12`. Space Grotesk, through `Metric`. */
  value: string;
  /** Other types this set took beyond the one named. `0` hides the badge. */
  moreCount: number;
  /** The whole row as one utterance, for a screen reader. */
  label: string;
}

/**
 * Every record of the session, in the order they were confirmed.
 *
 * A record whose exercise this device cannot name, and one whose only
 * wordable type has no value, are DROPPED rather than rendered incomplete —
 * `usePRCelebration` decision (e) and `pr-celebration.ts` decision (d), for
 * the same reason in a quieter place: a sentence with a hole in it says less
 * than no sentence.
 */
export function buildRecordLines(
  records: readonly SessionRecord[],
  exerciseNames: ReadonlyMap<string, string>,
  unit: WeightUnit,
): SessionRecordLine[] {
  const lines: SessionRecordLine[] = [];

  for (const [index, record] of records.entries()) {
    const exerciseName = exerciseNames.get(record.exerciseId);
    if (exerciseName === undefined) continue;

    const view = buildCelebration(
      {
        setLocalId: record.setLocalId,
        // Every record here already belongs to this session — the ledger is
        // scoped to it — so the field is satisfied rather than checked.
        sessionLocalId: '',
        exerciseId: record.exerciseId,
        reps: record.reps,
        weightKg: record.weightKg,
        estimated1rmKg: record.estimated1rmKg,
        types: record.types,
      },
      { exerciseName, unit, token: index },
    );
    if (view === null) continue;

    lines.push({
      setLocalId: record.setLocalId,
      lead: view.detailLead,
      value: view.detailValue,
      moreCount: view.moreCount,
      label: view.label,
    });
  }

  return lines;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Every word this screen says that is not already `pr-celebration.ts`'s.
 * Extracted for localisation (`product-copy` §6).
 *
 * **Nothing here judges.** A session with three skips is a different session
 * from one run exactly as written, and the summary says so — but it says it
 * as a count, in the client's own voice, with no "missed", no percentage and
 * no view about whether the workout was good enough (`COPY.md` CO§2, CO§3).
 */
export const SUMMARY_COPY = {
  /** The header's fallback when a session carries no name of its own. */
  untitled: 'Workout',
  volume: 'Volume',
  time: 'Time',
  sets: 'Sets',
  records: 'Personal records',
  changes: 'Changes',
  skipped: (count: number) => `${plural(count, 'exercise', 'exercises')} skipped`,
  swapped: (count: number) => `${plural(count, 'exercise', 'exercises')} swapped`,
  done: 'Done',
  /** The section heading a screen reader reads before the figures. */
  figuresLabel: 'Session totals',
  /**
   * `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`, in this screen's voice: what
   * happened, the thing the client actually fears, then what to do — the
   * same order `SessionFinish` uses for the same underlying fault.
   */
  errorTitle: 'Couldn’t open this summary',
  errorBody: 'Your sets are saved. Try again, or come back to it from Today.',
  retry: 'Try again',
  /** A session this device does not hold. Not an error, and not the client's fault. */
  missingTitle: 'This session isn’t on this device',
  missingBody: 'Nothing is lost. Open it from Today once your workouts have synced.',
  loading: 'Loading your session summary',
} as const;
