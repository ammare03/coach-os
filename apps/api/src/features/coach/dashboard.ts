import { schema, type ClientOverview, type DbClient } from '@coachos/db';
import {
  adherenceColor,
  computeOverallAdherence,
  computeTrainingAdherence,
  type AdherenceColor,
} from '@coachos/utils';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

// `coach.dashboard` (`phase-10-coach-review-surfaces/adherence-engine/02`) —
// §8.2's three counters and the client list, in three statements whatever
// the coach's client count is.
//
// The shape is the point. Off-track is derived in one pass over the rows
// the client list already fetched, never from a per-client query: the
// readable wrong version calls an adherence procedure in a loop, is correct,
// and is the N+1 §8.2's acceptance criterion exists to forbid. The count is
// pinned by `routers/__tests__/coach.dashboard.test.ts`.
//
// The three queries are exported individually so that test can `EXPLAIN`
// exactly the statement the resolver runs, rather than a re-typed copy of it
// that could drift.

/**
 * `client_profiles_active_seats`-shaped: the roster is the clients a coach
 * is actually carrying (§15.5). Paused and archived clients are off it —
 * they cost the coach nothing and reviewing them is not this week's work.
 * `deleted_at IS NULL` is already in the view (DB§9).
 */
const ROSTER_STATUSES = ['active', 'invited'] as const;

/** §8.2's amber/red boundary, read through `adherenceColor` and never re-stated. */
const OFF_TRACK_COLOR: AdherenceColor = 'red';

/**
 * DB§22's coach inbox is `LIMIT 50`, so the inbox holds at most fifty items
 * and a counter over it can honestly promise no more — the UI renders
 * "50+" past this (`api-conventions` §6: cap a badge, never `count(*)` an
 * unbounded table). Counting the capped set also keeps the counter and the
 * list that follows it from disagreeing.
 */
export const NEEDS_REVIEW_CAP = 50;

export interface ClientOverviewRow {
  clientId: string;
  name: string;
  status: ClientOverview['status'];
  lastActiveAt: Date | null;
  sessionsCompleted7d: number;
  sessionsScheduled7d: number;
  unreviewedSessions: number;
  unreviewedVideos: number;
  latestWeightKg: number | null;
  /** `completed / scheduled`, or `null` when nothing was scheduled. */
  trainingAdherence: number | null;
  /** The view's already-averaged 7-day figure, not a recomputation. */
  nutritionAdherence: number | null;
  overallAdherence: number | null;
  adherenceColor: AdherenceColor;
}

export interface CoachDashboard {
  needsReview: number;
  offTrack: number;
  checkinsDue: number;
  clients: ClientOverviewRow[];
}

/** Query 1 of 3 — the client list, and the only source the off-track count reads. */
export function clientOverviewQuery(db: DbClient, coachProfileId: string) {
  return db
    .select({
      clientId: schema.vClientOverview.clientId,
      name: schema.vClientOverview.name,
      status: schema.vClientOverview.status,
      lastActiveAt: schema.vClientOverview.lastActiveAt,
      sessionsCompleted7d: schema.vClientOverview.sessionsCompleted7d,
      sessionsScheduled7d: schema.vClientOverview.sessionsScheduled7d,
      unreviewedSessions: schema.vClientOverview.unreviewedSessions,
      unreviewedVideos: schema.vClientOverview.unreviewedVideos,
      nutritionAdherence7d: schema.vClientOverview.nutritionAdherence7d,
      latestWeightKg: schema.vClientOverview.latestWeightKg,
    })
    .from(schema.vClientOverview)
    .where(
      and(
        eq(schema.vClientOverview.coachId, coachProfileId),
        inArray(schema.vClientOverview.status, ROSTER_STATUSES),
      ),
    )
    .orderBy(schema.vClientOverview.name);
}

/**
 * Query 2 of 3 — DB§22's coach-inbox union, counted rather than listed.
 *
 * DB§22's own `ORDER BY at DESC` is dropped: ordering cannot change how many
 * rows a `LIMIT 50` yields, so sorting the union only to discard the sort is
 * pure cost. Which fifty rows the *list* shows is `coach-dashboard/01`'s
 * problem, and it runs DB§22 in full.
 *
 * The `deleted_at IS NULL` clause inside the video branch's `NOT EXISTS` is
 * the one addition to DB§22's text, and it is load-bearing twice over: a
 * soft-deleted comment is not a review, and `comments_target` is a partial
 * index on exactly that predicate, so without repeating it Postgres cannot
 * use the index at all.
 */
export function needsReviewQuery(coachProfileId: string): SQL {
  return sql`
    SELECT count(*)::int AS count FROM (
      SELECT ws.id
        FROM training.workout_sessions ws
        WHERE ws.coach_id = ${coachProfileId}
          AND ws.status = 'completed'
          AND ws.reviewed_at IS NULL
      UNION ALL
      SELECT ma.id
        FROM coaching.media_assets ma
        WHERE ma.coach_id = ${coachProfileId}
          AND ma.processing_status = 'ready'
          AND ma.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM coaching.comments c
             WHERE c.target_type = 'media_asset'
               AND c.target_id = ma.id
               AND c.deleted_at IS NULL
          )
      UNION ALL
      SELECT c.id
        FROM coaching.checkins c
        WHERE c.coach_id = ${coachProfileId}
          AND c.status = 'submitted'
      LIMIT ${NEEDS_REVIEW_CAP}
    ) inbox
  `;
}

/**
 * Query 3 of 3 — check-ins the client still owes.
 *
 * `pending`, not DB§22's `submitted`: a submitted check-in is the coach's
 * work and is already one branch of needs-review above. These two counters
 * sit side by side on the dashboard and must never count the same row twice.
 * Served by `checkins_coach_pending`.
 */
export function checkinsDueQuery(db: DbClient, coachProfileId: string) {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.checkins)
    .where(and(eq(schema.checkins.coachId, coachProfileId), eq(schema.checkins.status, 'pending')));
}

/** Drizzle hands `numeric` back as a string (`code-conventions` §3) — parsed once, here. */
function parseNumeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCount(row: { count: number } | undefined): number {
  return row?.count ?? 0;
}

export async function getCoachDashboard(
  db: DbClient,
  coachProfileId: string,
): Promise<CoachDashboard> {
  // Three independent reads, so they overlap rather than queue — the count
  // is unchanged either way, and §19 budgets the dashboard at 800ms p75.
  const [overviewRows, needsReviewRows, checkinRows] = await Promise.all([
    clientOverviewQuery(db, coachProfileId),
    db.execute<{ count: number }>(needsReviewQuery(coachProfileId)),
    checkinsDueQuery(db, coachProfileId),
  ]);

  const clients: ClientOverviewRow[] = overviewRows.map((row) => {
    const trainingAdherence = computeTrainingAdherence(
      row.sessionsCompleted7d,
      row.sessionsScheduled7d,
    );
    const nutritionAdherence = parseNumeric(row.nutritionAdherence7d);
    const overallAdherence = computeOverallAdherence(trainingAdherence, nutritionAdherence);

    return {
      clientId: row.clientId,
      name: row.name,
      status: row.status,
      lastActiveAt: row.lastActiveAt,
      sessionsCompleted7d: row.sessionsCompleted7d,
      sessionsScheduled7d: row.sessionsScheduled7d,
      unreviewedSessions: row.unreviewedSessions,
      unreviewedVideos: row.unreviewedVideos,
      latestWeightKg: parseNumeric(row.latestWeightKg),
      trainingAdherence,
      nutritionAdherence,
      overallAdherence,
      adherenceColor: adherenceColor(overallAdherence),
    };
  });

  return {
    // A client with no data at all is grey, not red — `adherenceColor` is
    // what decides that, so the counter cannot drift from the dot beside
    // the client's name (`adherence-engine/01`).
    offTrack: clients.filter((client) => client.adherenceColor === OFF_TRACK_COLOR).length,
    needsReview: readCount(needsReviewRows[0]),
    checkinsDue: readCount(checkinRows[0]),
    clients,
  };
}
