import { schema, type ClientOverview, type DbClient } from '@coachos/db';
import {
  adherenceState,
  computeOverallAdherence,
  computeTrainingAdherence,
  type AdherenceState,
} from '@coachos/utils';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

// `coach.clients.overview` (`phase-10-coach-review-surfaces/client-detail/01`)
// — §8.3's Overview tab: "weight trend chart, adherence sparkline, current
// program + week, upcoming check-in, pinned notes, injuries banner."
//
// **One procedure, six statements, none of them in a loop.** The task's
// Risks section names the alternative outright: five separate network calls
// assembled on the device, which is the natural way to write this
// incrementally and directly undermines the one-glance premise of the
// screen. The six run concurrently and the count does not move with the
// client's history — pinned by `routers/__tests__/coach.client-overview.test.ts`.
//
// Guarded by `ownsResource('client', …)` at the router, never here
// (`api-conventions` §3). Nothing below re-checks `coach_id`, with one
// deliberate exception: the pinned-notes read, which is scoped to the
// CALLER's own notes rather than to the client's coach — see `pinnedNotesQuery`.

/**
 * How far back the weight chart looks. DB§22's own window, restated as a
 * constant only so the test and the query cannot disagree about it.
 */
export const WEIGHT_TREND_MONTHS = 6;

/** The adherence sparkline's window, in whole weeks. */
export const ADHERENCE_TREND_WEEKS = 8;

/**
 * One row of `client_profiles.injuries` — a `jsonb` array with no `CHECK`
 * and no Zod schema behind it (DB§5.1), so every field is validated here
 * rather than trusted. A malformed element is dropped, not rendered: the
 * banner is safety information and a half-parsed one is worse than one
 * fewer row.
 */
export interface ClientInjury {
  area: string;
  notes: string | null;
  /** Free text as stored — `"2025-11"`, `"Jan 2026"`. Never parsed as a date. */
  since: string | null;
  severity: string | null;
}

/** A point on the weight chart: a local calendar week, and its average. */
export interface WeightTrendPoint {
  /** `yyyy-MM-dd`, the Monday of the week. A string, never a `Date` (DB§22, `packages/ui`'s chart contract). */
  weekStartISO: string;
  weightKg: number;
}

/** A point on the adherence sparkline: one week, and the share of it that happened. */
export interface AdherenceTrendPoint {
  weekStartISO: string;
  /** 0–100, or `null` for a week with nothing scheduled — never 0 (`adherence-engine/01`). */
  trainingAdherence: number | null;
}

export interface CurrentProgramSummary {
  assignmentId: string;
  programId: string;
  name: string;
  currentWeek: number;
  durationWeeks: number;
  /** `yyyy-MM-dd`. */
  startDate: string;
}

export interface UpcomingCheckin {
  checkinId: string;
  /** `yyyy-MM-dd`. */
  periodStart: string;
  periodEnd: string;
  status: 'pending' | 'submitted';
}

export interface PinnedNote {
  noteId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientOverviewDetail {
  clientId: string;
  name: string;
  status: ClientOverview['status'];
  goal: ClientOverview['goal'];
  avatarAssetId: string | null;
  /** When the CURRENT coaching relationship began; null for a first-ever coach (DB§5.1). */
  coachSince: Date | null;
  /** Empty array means no injuries. The banner renders iff this is non-empty (§8.3 AC). */
  injuries: ClientInjury[];
  weightTrend: WeightTrendPoint[];
  adherence: {
    sessionsCompleted7d: number;
    sessionsScheduled7d: number;
    trainingAdherence: number | null;
    nutritionAdherence: number | null;
    overallAdherence: number | null;
    /** The word, resolved once server-side so the detail screen and the dashboard dot cannot drift. */
    state: AdherenceState;
    trend: AdherenceTrendPoint[];
  };
  program: CurrentProgramSummary | null;
  nextCheckin: UpcomingCheckin | null;
  pinnedNotes: PinnedNote[];
}

/** Drizzle hands `numeric` back as a string (`code-conventions` §3) — parsed once, here. */
function parseNumericOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * `injuries` is `jsonb` — Drizzle types it `unknown`, and it genuinely is:
 * nothing in the database constrains its shape. `area` is the one required
 * field, because a row that cannot name the body part is not a row a coach
 * can act on.
 */
export function parseInjuries(value: unknown): ClientInjury[] {
  if (!Array.isArray(value)) return [];
  const injuries: ClientInjury[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const area = optionalString(entry.area);
    if (area === null) continue;
    injuries.push({
      area,
      notes: optionalString(entry.notes),
      since: optionalString(entry.since),
      severity: optionalString(entry.severity),
    });
  }
  return injuries;
}

/**
 * Statement 1 of 6 — identity and the seven-day adherence facts.
 *
 * Reads `v_client_overview` rather than recomputing the counts, so the
 * figure on this screen and the dot beside the same client's name on the
 * dashboard are the same number by construction (`adherence-engine/02`).
 * `client_profiles` is joined for the two fields the view does not carry —
 * `injuries` and `coach_since` — which keeps this one statement instead of
 * two round trips for one row.
 */
export function identityQuery(db: DbClient, clientProfileId: string) {
  return db
    .select({
      clientId: schema.vClientOverview.clientId,
      name: schema.vClientOverview.name,
      status: schema.vClientOverview.status,
      goal: schema.vClientOverview.goal,
      avatarAssetId: schema.vClientOverview.avatarAssetId,
      sessionsCompleted7d: schema.vClientOverview.sessionsCompleted7d,
      sessionsScheduled7d: schema.vClientOverview.sessionsScheduled7d,
      nutritionAdherence7d: schema.vClientOverview.nutritionAdherence7d,
      injuries: schema.clientProfiles.injuries,
      coachSince: schema.clientProfiles.coachSince,
    })
    .from(schema.vClientOverview)
    .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.vClientOverview.clientId))
    .where(eq(schema.vClientOverview.clientId, clientProfileId))
    .limit(1);
}

/**
 * Statement 2 of 6 — DB§22's weight-trend cookbook query, verbatim in
 * shape: weekly averages over six months.
 *
 * **Weekly, not daily, and that is the whole point.** A raw daily plot of
 * body weight is mostly water: a coach reading it sees a 1.2kg "gain"
 * that is a salty dinner. DB§22 averages the week to make the line say
 * what a coach thinks it says. Served by `body_metrics_client_date`.
 *
 * `weight_kg IS NOT NULL` is the one addition to DB§22's text: the column
 * is nullable (a waist-only measurement is a valid `body_metrics` row) and
 * `avg()` over an all-null week returns `NULL`, which would reach the chart
 * as a point with no value rather than as an absent week.
 */
export function weightTrendQuery(db: DbClient, clientProfileId: string) {
  return db.execute<{ week_start: string; weight_kg: string | null }>(sql`
    SELECT date_trunc('week', recorded_date)::date::text AS week_start,
           avg(weight_kg)::numeric(5,2) AS weight_kg
      FROM coaching.body_metrics
     WHERE client_id = ${clientProfileId}
       AND weight_kg IS NOT NULL
       AND recorded_date >= current_date - make_interval(months => ${WEIGHT_TREND_MONTHS})
     GROUP BY 1
     ORDER BY 1
  `);
}

/**
 * Statement 3 of 6 — the adherence sparkline's underlying values: one
 * completed/scheduled pair per week for eight weeks.
 *
 * The ratio itself is NOT computed here. It is handed to
 * `computeTrainingAdherence` in `packages/utils` alongside every other
 * adherence figure in the product, because a week with nothing scheduled is
 * `null` and not 0 — and SQL's `completed::numeric / count(*)` would have to
 * re-decide that (`adherence-engine/01`).
 */
export function adherenceTrendQuery(db: DbClient, clientProfileId: string) {
  return db.execute<{ week_start: string; completed: number; scheduled: number }>(sql`
    SELECT date_trunc('week', scheduled_date)::date::text AS week_start,
           count(*) FILTER (WHERE status = 'completed')::int AS completed,
           count(*)::int AS scheduled
      FROM training.workout_sessions
     WHERE client_id = ${clientProfileId}
       AND deleted_at IS NULL
       AND scheduled_date >= date_trunc('week', current_date - make_interval(weeks => ${ADHERENCE_TREND_WEEKS}))::date
     GROUP BY 1
     ORDER BY 1
  `);
}

/**
 * Statement 4 of 6 — the one active assignment, and the program behind it.
 *
 * `assignments_one_active` makes "at most one" an index guarantee rather
 * than an assumption, so this is a single-row read with no ordering to
 * decide. A paused or completed assignment is deliberately not surfaced:
 * §8.3 asks for the CURRENT program, and a paused one is a thing the coach
 * paused, not a thing the client is doing this week.
 */
export function currentProgramQuery(db: DbClient, clientProfileId: string) {
  return db
    .select({
      assignmentId: schema.assignments.id,
      programId: schema.programs.id,
      name: schema.programs.name,
      currentWeek: schema.assignments.currentWeek,
      durationWeeks: schema.programs.durationWeeks,
      startDate: schema.assignments.startDate,
    })
    .from(schema.assignments)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.assignments.programId))
    .where(
      and(
        eq(schema.assignments.clientId, clientProfileId),
        eq(schema.assignments.status, 'active'),
      ),
    )
    .limit(1);
}

/**
 * Statement 5 of 6 — the next check-in the coach's week turns on.
 *
 * `pending` and `submitted` both, ordered by the period they close: a
 * submitted check-in is the coach's work and an unsubmitted one is the
 * client's, and Overview's job is to say which is next either way. A
 * `reviewed` or `missed` one is neither. Served by `checkins_coach_pending`'s
 * partial predicate, which names exactly these two statuses.
 */
export function nextCheckinQuery(db: DbClient, clientProfileId: string) {
  return db
    .select({
      checkinId: schema.checkins.id,
      periodStart: schema.checkins.periodStart,
      periodEnd: schema.checkins.periodEnd,
      status: schema.checkins.status,
    })
    .from(schema.checkins)
    .where(
      and(
        eq(schema.checkins.clientId, clientProfileId),
        inArray(schema.checkins.status, ['pending', 'submitted']),
      ),
    )
    .orderBy(schema.checkins.periodEnd)
    .limit(1);
}

/**
 * Statement 6 of 6 — the pinned notes §8.3 puts on Overview.
 *
 * **This read lives here, and `coach-notes` builds only CRUD on top of it.**
 * Overview needs the notes and the notes feature needs the writes; running
 * both would mean two queries for one list and two places to change when
 * pinning changes. The split is: this procedure owns the *pinned* read on
 * Overview; `coach-notes` owns `notes.listForClient`, create, update,
 * delete, and `setPinned`, and invalidates this key when it writes.
 *
 * Scoped to `coach_id = the caller` and not merely to the client, which is
 * the one place in this file that re-states an ownership condition
 * `ownsResource` has already checked. It is not the same condition: DB§5.4
 * makes a note private to the coach who wrote it, so a root coach opening
 * an assistant's client must see their own notes and none of the
 * assistant's (§2, `security-and-privacy` §5). Soft-deleted notes are
 * excluded — `coach_client_notes` carries `deleted_at`.
 */
export function pinnedNotesQuery(db: DbClient, coachProfileId: string, clientProfileId: string) {
  return db
    .select({
      noteId: schema.coachClientNotes.id,
      body: schema.coachClientNotes.body,
      createdAt: schema.coachClientNotes.createdAt,
      updatedAt: schema.coachClientNotes.updatedAt,
    })
    .from(schema.coachClientNotes)
    .where(
      and(
        eq(schema.coachClientNotes.coachId, coachProfileId),
        eq(schema.coachClientNotes.clientId, clientProfileId),
        eq(schema.coachClientNotes.isPinned, true),
        isNull(schema.coachClientNotes.deletedAt),
      ),
    )
    .orderBy(desc(schema.coachClientNotes.updatedAt));
}

export async function getClientOverview(
  db: DbClient,
  coachProfileId: string,
  clientProfileId: string,
): Promise<ClientOverviewDetail> {
  // Six independent reads, so they overlap rather than queue — §19 budgets
  // a coach screen at 800ms p75 and the slowest of six beats the sum of six.
  const [identityRows, weightRows, trendRows, programRows, checkinRows, noteRows] =
    await Promise.all([
      identityQuery(db, clientProfileId),
      weightTrendQuery(db, clientProfileId),
      adherenceTrendQuery(db, clientProfileId),
      currentProgramQuery(db, clientProfileId),
      nextCheckinQuery(db, clientProfileId),
      pinnedNotesQuery(db, coachProfileId, clientProfileId),
    ]);

  const identity = identityRows[0];
  // `ownsResource` answers *whose*, never *whether it is still there* — it
  // ignores `deleted_at` deliberately (`resource-registry.ts`). So a soft
  // deleted client passes the guard and falls out of the view here.
  // `NOT_YOUR_CLIENT`, not a distinct "no such client": the two must be
  // indistinguishable or the pair is an enumeration oracle (ER§2.1).
  if (identity === undefined) {
    throw appError('NOT_YOUR_CLIENT', "We couldn't find that client.", {});
  }

  const trainingAdherence = computeTrainingAdherence(
    identity.sessionsCompleted7d,
    identity.sessionsScheduled7d,
  );
  const nutritionAdherence = parseNumericOrNull(identity.nutritionAdherence7d);
  const overallAdherence = computeOverallAdherence(trainingAdherence, nutritionAdherence);

  const weightTrend: WeightTrendPoint[] = [];
  for (const row of weightRows) {
    const weightKg = parseNumericOrNull(row.weight_kg);
    if (weightKg === null) continue;
    weightTrend.push({ weekStartISO: row.week_start, weightKg });
  }

  const program = programRows[0];
  const checkin = checkinRows[0];

  return {
    clientId: identity.clientId,
    name: identity.name,
    status: identity.status,
    goal: identity.goal,
    avatarAssetId: identity.avatarAssetId,
    coachSince: identity.coachSince,
    injuries: parseInjuries(identity.injuries),
    weightTrend,
    adherence: {
      sessionsCompleted7d: identity.sessionsCompleted7d,
      sessionsScheduled7d: identity.sessionsScheduled7d,
      trainingAdherence,
      nutritionAdherence,
      overallAdherence,
      state: adherenceState(overallAdherence),
      trend: trendRows.map((row) => ({
        weekStartISO: row.week_start,
        trainingAdherence: computeTrainingAdherence(row.completed, row.scheduled),
      })),
    },
    program:
      program === undefined
        ? null
        : {
            assignmentId: program.assignmentId,
            programId: program.programId,
            name: program.name,
            currentWeek: program.currentWeek,
            durationWeeks: program.durationWeeks,
            startDate: program.startDate,
          },
    nextCheckin:
      checkin === undefined || (checkin.status !== 'pending' && checkin.status !== 'submitted')
        ? null
        : {
            checkinId: checkin.checkinId,
            periodStart: checkin.periodStart,
            periodEnd: checkin.periodEnd,
            status: checkin.status,
          },
    pinnedNotes: noteRows,
  };
}
