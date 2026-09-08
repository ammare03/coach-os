import { addCalendarDays, toLocalDate, type CalendarDate } from '@coachos/utils';
import type {
  ClientHistory,
  HistoryComment,
  HistoryMeal,
  HistoryMealItem,
  HistorySession,
  HistorySetLog,
} from 'api/src/features/clientApp/history.ts';
import { eq, inArray } from 'drizzle-orm';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localComments } from '../../db/schema/local-feedback.ts';
import { localMeals } from '../../db/schema/local-nutrition.ts';
import { localWorkoutSessions } from '../../db/schema/local-training.ts';

import { resolveDeviceTimeZone } from './sessions.ts';
import { prefetchQuery } from './trpc-client.ts';

// `prefetch/02` — the trailing 30 days of sessions, meals, and coach
// comments on the device, which is what makes `offline-sync` §1's "reading
// the last 30 days of history and all coach comments" actually true with no
// signal (`CLAUDE.md` §11.1, §11.2).
//
// Four rules this file exists to get right:
//
// (a) The window boundary comes from `@coachos/utils` and nowhere else.
//     `toLocalDate` + `addCalendarDays`, never `toISOString().slice(0, 10)`
//     — `CLAUDE.md` §25.5, and the same rule `./sessions.ts` (a) states.
//     The zone is a parameter defaulted to the device's, for the reason
//     `./sessions.ts` (b) gives.
//
// (b) Today and tomorrow belong to task 01. `local_workout_sessions` has
//     one `payload_json` per row, and the two prefetchers put different
//     things in it: `./sessions.ts` writes the live prescription the
//     logger needs, this writes the sets that were actually logged. So
//     this one stops at yesterday, deterministically, rather than
//     depending on which prefetcher ran last.
//
// (c) A row the device has not synced is never overwritten — the same rule
//     as `./sessions.ts` (c), applied to meals as well. `offline-sync` §5
//     makes `set_logs`, `meals`, and a session's own status device-wins;
//     a background refresh that clobbered them would delete work nobody
//     can get back.
//
// (d) `local_comments` is WRITE-ONLY-FROM-HERE. It has no `client_local_id`
//     and no `sync_state` because nothing on the device ever originates a
//     comment: P12 creates them through the ordinary online tRPC path,
//     never through the outbox (`src/db/schema/local-feedback.ts`, DB§13).
//     That makes an unconditional refresh safe here — and it is only safe
//     while that stays true. If a comment ever becomes offline-writable,
//     this function needs rule (c) and that table needs the two columns.

/** `CLAUDE.md` §11.1's window. */
export const HISTORY_DAYS = 30;

export interface HistoryRange {
  from: CalendarDate;
  to: CalendarDate;
}

/** The 30 days ending on the client's local today, inclusive. Rule (a) lives here. */
export function historyRange(now: Date, timeZone: string): HistoryRange {
  const to = toLocalDate(now, timeZone);
  return { from: addCalendarDays(to, -(HISTORY_DAYS - 1)), to };
}

export type HistoryFetcher = (range: HistoryRange) => Promise<ClientHistory>;

const fetchViaTrpc: HistoryFetcher = async (range) =>
  (await prefetchQuery('clientApp.history', range)) as ClientHistory;

/** Everything a past session renders from, with no join and no network. */
export interface LocalHistoryPayload {
  session: HistorySession;
  setLogs: HistorySetLog[];
}

export function serialiseHistoryPayload(payload: LocalHistoryPayload): string {
  // superjson, not `JSON.stringify`, for the reason `./sessions.ts`'s
  // `serialiseSessionPayload` gives: `loggedAt`/`completedAt` are real
  // `Date`s and must still be `Date`s after an app restart.
  return superjsonStringify(payload);
}

/**
 * The matching reader. The presence of `setLogs` is what distinguishes a
 * history payload from task 01's `{ session, exercises }` one — rule (b)
 * keeps a single row from ever carrying both.
 */
export function parseHistorySessionPayload(payloadJson: string): LocalHistoryPayload {
  return superjsonParse<LocalHistoryPayload>(payloadJson);
}

export function serialiseMealItems(items: HistoryMealItem[]): string {
  // Plain JSON, unlike the session payload: a meal item is names and
  // numbers with no `Date` in it, and `local_meals.items_json` is read by
  // P13's diary exactly as `cues_json` is read by the logger.
  return JSON.stringify(items);
}

export function parseMealItems(itemsJson: string): HistoryMealItem[] {
  return JSON.parse(itemsJson) as HistoryMealItem[];
}

/** Same fallback as `./sessions.ts`: the server id when a session carries no local key. */
function localKeyFor(session: HistorySession): string {
  return session.clientLocalId ?? session.id;
}

function sessionRow(session: HistorySession): typeof localWorkoutSessions.$inferInsert {
  return {
    id: session.id,
    clientLocalId: localKeyFor(session),
    serverId: session.id,
    scheduledDate: session.scheduledDate,
    programDayId: session.programDayId,
    name: session.name ?? session.dayName,
    status: session.status,
    startedAt: session.startedAt ? session.startedAt.getTime() : null,
    completedAt: session.completedAt ? session.completedAt.getTime() : null,
    payloadJson: serialiseHistoryPayload({ session, setLogs: session.setLogs }),
    syncState: 'synced',
    updatedAt: session.updatedAt.getTime(),
  };
}

export interface WriteHistorySessionsResult {
  inserted: number;
  updated: number;
  /** Left alone because the device holds unsynced changes — rule (c). */
  skippedUnsynced: number;
  /** Left to `./sessions.ts`, which owns today and tomorrow — rule (b). */
  skippedToUpcoming: number;
}

export interface WriteHistorySessionsOptions {
  /** The first calendar date task 01's prefetch owns — normally the client's local today. */
  upcomingOwnsFrom: CalendarDate;
}

export async function writeHistorySessions(
  db: LocalDb,
  sessions: HistorySession[],
  options: WriteHistorySessionsOptions,
): Promise<WriteHistorySessionsResult> {
  let inserted = 0;
  let updated = 0;
  let skippedUnsynced = 0;
  let skippedToUpcoming = 0;

  for (const session of sessions) {
    if (session.scheduledDate >= options.upcomingOwnsFrom) {
      skippedToUpcoming += 1;
      continue;
    }
    const key = localKeyFor(session);
    const [existing] = await db
      .select({ syncState: localWorkoutSessions.syncState })
      .from(localWorkoutSessions)
      .where(eq(localWorkoutSessions.clientLocalId, key))
      .limit(1);

    if (!existing) {
      await db.insert(localWorkoutSessions).values(sessionRow(session));
      inserted += 1;
      continue;
    }
    if (existing.syncState !== 'synced') {
      skippedUnsynced += 1;
      continue;
    }
    const { clientLocalId: _key, ...columns } = sessionRow(session);
    await db
      .update(localWorkoutSessions)
      .set(columns)
      .where(eq(localWorkoutSessions.clientLocalId, key));
    updated += 1;
  }

  return { inserted, updated, skippedUnsynced, skippedToUpcoming };
}

export interface WriteHistoryMealsResult {
  inserted: number;
  updated: number;
  skippedUnsynced: number;
}

function mealRow(meal: HistoryMeal): typeof localMeals.$inferInsert {
  return {
    id: meal.id,
    clientLocalId: meal.clientLocalId,
    loggedDate: meal.loggedDate,
    mealType: meal.mealType,
    loggedAt: meal.loggedAt.getTime(),
    notes: meal.notes,
    itemsJson: serialiseMealItems(meal.items),
    syncState: 'synced',
  };
}

export async function writeHistoryMeals(
  db: LocalDb,
  meals: HistoryMeal[],
): Promise<WriteHistoryMealsResult> {
  let inserted = 0;
  let updated = 0;
  let skippedUnsynced = 0;

  for (const meal of meals) {
    const [existing] = await db
      .select({ syncState: localMeals.syncState })
      .from(localMeals)
      .where(eq(localMeals.clientLocalId, meal.clientLocalId))
      .limit(1);

    if (!existing) {
      await db.insert(localMeals).values(mealRow(meal));
      inserted += 1;
      continue;
    }
    if (existing.syncState !== 'synced') {
      skippedUnsynced += 1;
      continue;
    }
    const { clientLocalId: _key, ...columns } = mealRow(meal);
    await db
      .update(localMeals)
      .set(columns)
      .where(eq(localMeals.clientLocalId, meal.clientLocalId));
    updated += 1;
  }

  return { inserted, updated, skippedUnsynced };
}

export interface WriteHistoryCommentsResult {
  inserted: number;
  updated: number;
}

function commentRow(comment: HistoryComment): typeof localComments.$inferInsert {
  return {
    id: comment.id,
    targetType: comment.targetType,
    targetId: comment.targetId,
    authorUserId: comment.authorUserId,
    body: comment.body,
    voiceNoteAssetId: comment.voiceNoteAssetId,
    videoReplyAssetId: comment.videoReplyAssetId,
    timestampMs: comment.timestampMs,
    // Null stays null rather than becoming the string "null" — a reader
    // checking the column for absence must not have to parse it first.
    annotationJson:
      comment.annotation === null || comment.annotation === undefined
        ? null
        : JSON.stringify(comment.annotation),
    parentCommentId: comment.parentCommentId,
    isAiGenerated: comment.isAiGenerated,
    createdAt: comment.createdAt.getTime(),
  };
}

/** Rule (d): unconditional refresh, because nothing else on the device writes this table. */
export async function writeHistoryComments(
  db: LocalDb,
  comments: HistoryComment[],
): Promise<WriteHistoryCommentsResult> {
  if (comments.length === 0) return { inserted: 0, updated: 0 };

  const existing = await db
    .select({ id: localComments.id })
    .from(localComments)
    .where(
      inArray(
        localComments.id,
        comments.map((comment) => comment.id),
      ),
    );
  const existingIds = new Set(existing.map((row) => row.id));

  let inserted = 0;
  let updated = 0;
  for (const comment of comments) {
    const row = commentRow(comment);
    if (existingIds.has(comment.id)) {
      const { id, ...columns } = row;
      await db.update(localComments).set(columns).where(eq(localComments.id, id));
      updated += 1;
    } else {
      await db.insert(localComments).values(row);
      inserted += 1;
    }
  }
  return { inserted, updated };
}

export interface PrefetchHistoryOptions {
  /** The client's zone. Defaults to the device's — `./sessions.ts` (b). */
  timeZone?: string;
  /** Injected so the window boundary is testable; `CLAUDE.md` §25.5 stays broken when it isn't. */
  now?: Date;
  fetchHistory?: HistoryFetcher;
  db?: LocalDb;
}

export interface PrefetchHistoryResult {
  range: HistoryRange;
  sessions: WriteHistorySessionsResult;
  meals: WriteHistoryMealsResult;
  comments: WriteHistoryCommentsResult;
}

/**
 * Fetches the trailing 30 days in one request and writes it across the
 * three local tables.
 *
 * One request, not three: `clientApp.history` returns sessions, meals, and
 * comments together precisely so this never becomes a query waterfall on
 * the connection prefetch exists to beat.
 */
export async function prefetchHistory(
  options: PrefetchHistoryOptions = {},
): Promise<PrefetchHistoryResult> {
  const range = historyRange(
    options.now ?? new Date(),
    options.timeZone ?? resolveDeviceTimeZone(),
  );
  const fetched = await (options.fetchHistory ?? fetchViaTrpc)(range);
  const db = options.db ?? (await getLocalDb());

  const sessions = await writeHistorySessions(db, fetched.sessions, {
    upcomingOwnsFrom: range.to,
  });
  const meals = await writeHistoryMeals(db, fetched.meals);
  const comments = await writeHistoryComments(db, fetched.comments);

  return { range, sessions, meals, comments };
}
