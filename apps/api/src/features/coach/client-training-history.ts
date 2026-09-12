import { schema, type DbClient } from '@coachos/db';
import type { coach as coachSchemas } from '@coachos/schemas';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

// `coach.clients.trainingHistory` (`phase-10-coach-review-surfaces/client-detail/02`)
// — §8.3's Training tab: "session history list → tap → full session with
// every set". This is the list; `session-review/` is what a row opens.
//
// **Two statements, neither of them per row.** The task's Risks section
// names the failure outright: computing a session's PR count on the device
// by fetching every set log for every visible row is the N+1 this phase's
// dashboard work already had to guard against. So the page is read first,
// then ONE grouped statement counts records across every session id on it —
// the same shape `features/programs/list-program-templates.ts` uses for
// `daysPerWeek`.
//
// Guarded by `ownsResource('client', …)` at the router, never here
// (`api-conventions` §3). Nothing below re-checks `coach_id`.

/**
 * The three statuses that are *history*.
 *
 * `scheduled` is deliberately absent, and it is the only judgement this
 * query makes. A scheduled session has no duration, no volume, and no sets
 * to open — tapping one would land on an empty session-review screen — and
 * a future one is the program rather than the past. That a past scheduled
 * session never happened is already what the adherence figure on Overview
 * reports, so omitting it here states nothing new and invents no second
 * place for "missed" to be defined (`adherence-engine/01`).
 */
export const SESSION_HISTORY_STATUSES = ['completed', 'in_progress', 'skipped'] as const;

export type SessionHistoryStatus = (typeof SESSION_HISTORY_STATUSES)[number];

export interface SessionHistoryItem {
  sessionId: string;
  /** `yyyy-MM-dd` — the CLIENT's local training day, never an instant (DB§5.3, `CLAUDE.md` §25.5). */
  scheduledDate: string;
  /**
   * The session's own name, else the program day's, else `null`. Resolved
   * here rather than on the device so a row never has to decide, and never
   * has to fetch a second row to find out.
   */
  name: string | null;
  status: SessionHistoryStatus;
  /** The client's own words. `null` unless `status === 'skipped'`. */
  skipReason: string | null;
  durationSeconds: number | null;
  /** Kilograms, always — display conversion happens on the device (`CLAUDE.md` §0). */
  totalVolumeKg: number | null;
  /** Records this session set and that the client still holds. Never computed per row on the client. */
  personalRecordCount: number;
  /** `null` = the coach has not opened it — the dashboard's "Needs review" signal, per session. */
  reviewedAt: Date | null;
}

export interface ClientTrainingHistoryPage {
  items: SessionHistoryItem[];
  nextCursor: string | null;
}

/**
 * ASCII unit separator — the same character `services/exercises/cursor.ts`
 * encodes with, and one neither a `yyyy-MM-dd` nor a uuid can contain.
 */
const SEPARATOR = '\u001f';

interface HistoryCursor {
  /** `yyyy-MM-dd`. */
  scheduledDate: string;
  sessionId: string;
}

/** Opaque on the wire — base64url, so nothing about the sort key invites a client to assemble one. */
export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(`${cursor.scheduledDate}${SEPARATOR}${cursor.sessionId}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Returns `null` for anything that does not decode to a `yyyy-MM-dd`, one
 * separator, and a non-empty id. A malformed cursor restarts the list from
 * the top rather than throwing: it is never a state the client can recover
 * from by retrying, and a 400 in the middle of an infinite scroll is worse
 * than a rewind (`exercises/cursor.ts`'s own reasoning).
 */
export function decodeHistoryCursor(raw: string): HistoryCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separatorAt = decoded.indexOf(SEPARATOR);
  if (separatorAt < 0) return null;
  const scheduledDate = decoded.slice(0, separatorAt);
  const sessionId = decoded.slice(separatorAt + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return null;
  if (sessionId.length === 0) return null;
  return { scheduledDate, sessionId };
}

/** Drizzle hands `numeric` back as a string (`code-conventions` §3) — parsed once, here. */
function parseNumericOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHistoryStatus(value: string): value is SessionHistoryStatus {
  return (SESSION_HISTORY_STATUSES as readonly string[]).includes(value);
}

/**
 * Statement 1 of 2 — one keyset page of the client's session history.
 *
 * `(scheduled_date, id)` as a row comparison, not two OR'd inequalities:
 * Postgres compares the tuple left-to-right, which is exactly
 * `ORDER BY scheduled_date DESC, id DESC`, and expressing it longhand is
 * the classic way to get this subtly wrong. `id` is in the key because
 * `scheduled_date` is a `date` — two sessions on one day are ordinary (a
 * morning lift and an evening conditioning block), and a keyset on the
 * date alone would skip one at a page boundary.
 *
 * `limit + 1` tells the last row of a page from the last row there is.
 * Served by `workout_sessions_client_id_idx`.
 */
export function historyPageQuery(
  db: DbClient,
  clientProfileId: string,
  input: coachSchemas.ClientTrainingHistoryInput,
) {
  const cursor = input.cursor === undefined ? null : decodeHistoryCursor(input.cursor);

  const filters = [
    eq(schema.workoutSessions.clientId, clientProfileId),
    isNull(schema.workoutSessions.deletedAt),
    inArray(schema.workoutSessions.status, [...SESSION_HISTORY_STATUSES]),
  ];
  if (cursor !== null) {
    filters.push(
      sql`(${schema.workoutSessions.scheduledDate}, ${schema.workoutSessions.id}) < (${cursor.scheduledDate}::date, ${cursor.sessionId}::uuid)`,
    );
  }

  return (
    db
      .select({
        sessionId: schema.workoutSessions.id,
        scheduledDate: schema.workoutSessions.scheduledDate,
        sessionName: schema.workoutSessions.name,
        programDayName: schema.programDays.name,
        status: schema.workoutSessions.status,
        skipReason: schema.workoutSessions.skipReason,
        durationSeconds: schema.workoutSessions.durationSeconds,
        totalVolumeKg: schema.workoutSessions.totalVolumeKg,
        reviewedAt: schema.workoutSessions.reviewedAt,
      })
      .from(schema.workoutSessions)
      // LEFT, not INNER: an ad-hoc session has no `program_day_id` at all
      // (§8.4 allows one), and a program day can be deleted out from under a
      // logged session (`ON DELETE SET NULL`). Either way the session is
      // still history and still opens.
      .leftJoin(schema.programDays, eq(schema.programDays.id, schema.workoutSessions.programDayId))
      .where(and(...filters))
      .orderBy(desc(schema.workoutSessions.scheduledDate), desc(schema.workoutSessions.id))
      .limit(input.limit + 1)
  );
}

/**
 * Statement 2 of 2 — the per-session PR count, for the whole page at once.
 *
 * **"Records this session set and that the client still holds", not
 * "records beaten on the day".** `personal_records` holds only the CURRENT
 * record per `(client, exercise, record_type)` (DB§5.2), credited to the
 * `set_log` that reached it — so joining through `set_logs.workout_session_id`
 * answers the first question and cannot answer the second. That is the right
 * question for this row: a coach scanning history wants the sessions that
 * still stand as a client's best, not the ones that were briefly a best in
 * March. `personal-records/02` fixed the same meaning for the client's own
 * session summary, and the two surfaces must not count differently.
 *
 * Scoped by `client_id` as well as by session id — redundant against the
 * page (every session on it is this client's), and it is what puts the
 * planner on `personal_records_client_id_exercise_id_record_type_unique`
 * instead of scanning the table.
 *
 * `set_logs.deleted_at IS NULL` cannot under-count:
 * `recomputePersonalRecords` derives a record only from a non-withdrawn
 * set, so a live record never points at a withdrawn one. It is here so a
 * bug that broke that invariant shows up as a missing count rather than a
 * record attributed to a set the client took back.
 */
export function personalRecordCountQuery(
  db: DbClient,
  clientProfileId: string,
  sessionIds: string[],
) {
  return db
    .select({
      sessionId: schema.setLogs.workoutSessionId,
      recordCount: sql<number>`count(*)::int`,
    })
    .from(schema.personalRecords)
    .innerJoin(schema.setLogs, eq(schema.setLogs.id, schema.personalRecords.setLogId))
    .where(
      and(
        eq(schema.personalRecords.clientId, clientProfileId),
        inArray(schema.setLogs.workoutSessionId, sessionIds),
        isNull(schema.setLogs.deletedAt),
      ),
    )
    .groupBy(schema.setLogs.workoutSessionId);
}

export async function getClientTrainingHistory(
  db: DbClient,
  clientProfileId: string,
  input: coachSchemas.ClientTrainingHistoryInput,
): Promise<ClientTrainingHistoryPage> {
  const page = await historyPageQuery(db, clientProfileId, input);

  const hasMore = page.length > input.limit;
  const pageRows = hasMore ? page.slice(0, input.limit) : page;

  if (pageRows.length === 0) return { items: [], nextCursor: null };

  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeHistoryCursor({ scheduledDate: last.scheduledDate, sessionId: last.sessionId })
      : null;

  const recordRows = await personalRecordCountQuery(
    db,
    clientProfileId,
    pageRows.map((row) => row.sessionId),
  );
  const recordsBySession = new Map(recordRows.map((row) => [row.sessionId, row.recordCount]));

  const items: SessionHistoryItem[] = [];
  for (const row of pageRows) {
    // The `inArray` above already excluded `scheduled`; this narrows the
    // enum for TypeScript rather than filtering, so a status added to
    // `session_status` later fails the type check here instead of silently
    // widening what this list returns.
    if (!isHistoryStatus(row.status)) continue;

    items.push({
      sessionId: row.sessionId,
      scheduledDate: row.scheduledDate,
      name: row.sessionName ?? row.programDayName ?? null,
      status: row.status,
      // Carried only where it means something. `skip_reason` is NOT NULL
      // for a skipped session by `session_skip_reason`'s CHECK, and stale
      // on any other status.
      skipReason: row.status === 'skipped' ? row.skipReason : null,
      durationSeconds: row.durationSeconds,
      totalVolumeKg: parseNumericOrNull(row.totalVolumeKg),
      personalRecordCount: recordsBySession.get(row.sessionId) ?? 0,
      reviewedAt: row.reviewedAt,
    });
  }

  return { items, nextCursor };
}
