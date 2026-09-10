import { addCalendarDays, toLocalDate, type CalendarDate } from '@coachos/utils';
import type {
  UpcomingContext,
  UpcomingDayContext,
  UpcomingExercise,
  UpcomingSession,
  UpcomingWorkouts,
} from 'api/src/features/workouts/upcoming.ts';
import { eq } from 'drizzle-orm';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localWorkoutSessions } from '../../db/schema/local-training.ts';
import { meta } from '../../db/schema/sync.ts';
import { ensureClientTimeZoneHydrated } from '../time-zone/store.ts';

import { collectReferencedExerciseIds, prefetchExercises } from './exercises.ts';
import { prefetchQuery } from './trpc-client.ts';

// `prefetch/01` — today's and tomorrow's sessions on the device before the
// signal disappears (`offline-sync` §2, `CLAUDE.md` §11.2). This module
// owns the fetch and the `local_workout_sessions` write; `./exercises.ts`
// owns the exercise cache; `prefetch/03` owns when any of it runs.
//
// The three rules this file exists to get right:
//
// (a) The today/tomorrow boundary comes from `@coachos/utils`'s
//     `toLocalDate`/`addCalendarDays`, never from `toISOString().slice(0,
//     10)` or from local `Date` getters. That is this task's named risk and
//     `CLAUDE.md` §25.5's named pitfall: a session logged at 00:30 belongs
//     to the client's local day, and every place that computes the boundary
//     independently is a place it gets computed differently.
//
// (b) The zone is a parameter, and its default is
//     `lib/time-zone/store.ts` — the client's stored `users.timezone`,
//     falling back to the device's only until something has resolved it.
//     **This rule used to say the device zone was the right default and
//     that is now superseded** (`docs/UNFORGET.md` S32): this module and
//     `./history.ts` each defaulted independently, and the Today card
//     resolved the day from the stored zone, so a client whose two zones
//     differ had the column's date division slip by a whole day. The
//     stored zone is also what the server means by this client's today —
//     `advance-assignment.ts` (b) materialises against it. `./scheduler.ts`
//     resolves the value once per pass and passes it to both prefetchers;
//     the parameter stays so the boundary is testable.
//
// (c) A local row with unsynced changes is never overwritten. Server truth
//     wins for the coach-authored prescription, but the session row also
//     carries the client's own `status`/`startedAt` — and `offline-sync` §5
//     is unambiguous that the device wins there. A refresh that clobbered a
//     started session would delete work nobody can get back, so a row whose
//     `sync_state` is anything but `'synced'` is skipped and reported.

/** Everything the logger renders for one session, with no join. */
export interface LocalSessionPayload {
  session: UpcomingSession;
  /** Only the exercises this session's blocks reference, including their swaps. */
  exercises: UpcomingExercise[];
}

export interface UpcomingRange {
  from: CalendarDate;
  to: CalendarDate;
}

/** Today and tomorrow as client-local calendar dates. Rule (a) lives here and nowhere else. */
export function upcomingRange(now: Date, timeZone: string): UpcomingRange {
  const from = toLocalDate(now, timeZone);
  return { from, to: addCalendarDays(from, 1) };
}

export type UpcomingFetcher = (range: UpcomingRange) => Promise<UpcomingWorkouts>;

const fetchViaTrpc: UpcomingFetcher = async (range) =>
  (await prefetchQuery('workouts.upcoming', range)) as UpcomingWorkouts;

export function serialiseSessionPayload(payload: LocalSessionPayload): string {
  // superjson, not `JSON.stringify`: `startedAt`/`completedAt`/`updatedAt`
  // are real `Date`s and must still be `Date`s after an app restart —
  // plain JSON degrades them to strings, which is the "everything
  // timestamped at reconnect" failure in `offline-sync` §10 wearing a
  // different hat. Same transformer the wire and the outbox already use.
  return superjsonStringify(payload);
}

/**
 * Deserialises `local_workout_sessions.payload_json`. Never `JSON.parse` —
 * the payload is superjson.
 *
 * Trusts the row to be one this module wrote, so it is the right reader for
 * a row you just wrote and the wrong one for a row you merely found:
 * `readSessionPayload` below is the narrowing version, and the one a
 * consumer should reach for.
 */
export function parseSessionPayload(payloadJson: string): LocalSessionPayload {
  return superjsonParse<LocalSessionPayload>(payloadJson);
}

/**
 * Whether a parsed payload is THIS module's and not `./history.ts`'s
 * `{ session, setLogs }`.
 *
 * The two prefetchers share one `payload_json` column and divide it by date
 * — `./history.ts` rule (b) stops at yesterday so today and tomorrow stay
 * this module's. `./scheduler.ts` now derives that date once per pass and
 * gives it to both, so the division no longer slips (`docs/UNFORGET.md`
 * S32). This stays anyway: it is what makes a row written by an older
 * build, or by a future third writer, degrade instead of throwing, and
 * prose in two files was never a discriminator
 * (`phase-09-workout-logger/today-card/02`).
 */
export function isSessionPayload(payload: unknown): payload is LocalSessionPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Partial<Record<keyof LocalSessionPayload, unknown>>;
  return (
    Array.isArray(candidate.exercises) &&
    typeof candidate.session === 'object' &&
    candidate.session !== null &&
    Array.isArray((candidate.session as Partial<UpcomingSession>).exercises)
  );
}

/**
 * `parseSessionPayload` for a row this module may not have written.
 *
 * `null` means "readable, but not a prescription" — the caller renders the
 * session without one rather than showing an error or, worse, a rest day
 * for a date that has a session on it. A payload that will not parse at all
 * still throws: that is genuine corruption, and `ERRORS.md` ER§1.4's
 * `LOCAL_READ_FAILED` is the honest answer to it.
 */
export function readSessionPayload(payloadJson: string): LocalSessionPayload | null {
  const payload: unknown = parseSessionPayload(payloadJson);
  return isSessionPayload(payload) ? payload : null;
}

// ── `workouts.upcoming`'s context object (`phase-09-workout-logger/today-card/01`) ──
//
// It is per CLIENT and per RANGE, not per session, so it has no row in
// `local_workout_sessions` to live on — and a rest day, which is the whole
// reason it exists, has no session row at all. `meta` is DB§13's existing
// home for exactly this shape of scalar (it already holds `schema_version`,
// `user_id`, `last_sync_at`), so this adds no table and inherits the two
// behaviours that matter: it is inside `coachos.db`, so the logout wipe and
// the schema-version drop both take it with them.
//
// Serialised with superjson for the same reason the session payload is —
// one transformer across the wire, the outbox, and this cache. The context
// carries no `Date` today; pinning the transformer now means a field that
// does can be added without a silent string-for-Date regression.

/** `meta.key` for the cached `UpcomingContext`. One row, overwritten each prefetch. */
export const UPCOMING_CONTEXT_META_KEY = 'upcoming_context';

export function serialiseUpcomingContext(context: UpcomingContext): string {
  return superjsonStringify(context);
}

export function parseUpcomingContext(value: string): UpcomingContext {
  return superjsonParse<UpcomingContext>(value);
}

export async function writeUpcomingContext(db: LocalDb, context: UpcomingContext): Promise<void> {
  await db
    .insert(meta)
    .values({ key: UPCOMING_CONTEXT_META_KEY, value: serialiseUpcomingContext(context) })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: serialiseUpcomingContext(context) },
    });
}

/**
 * `null` when nothing has been prefetched yet — a first launch, or a device
 * whose cache was just dropped. The caller must treat that as "unknown",
 * never as "no program": telling a client with a program that they have
 * none is the worse of the two wrong answers.
 *
 * A malformed row degrades to `null` rather than throwing, matching
 * `db/schema-version.ts`'s treatment of a corrupted `meta` value — a bad
 * cache entry must not be able to take the Today screen down.
 */
export async function readUpcomingContext(db: LocalDb): Promise<UpcomingContext | null> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, UPCOMING_CONTEXT_META_KEY))
    .limit(1);

  if (!row?.value) return null;
  try {
    return parseUpcomingContext(row.value);
  } catch {
    return null;
  }
}

/** The cached context's entry for one calendar date, or `null` if the range never covered it. */
export function upcomingDayContext(
  context: UpcomingContext | null,
  date: CalendarDate,
): UpcomingDayContext | null {
  return context?.days.find((day) => day.date === date) ?? null;
}

function payloadFor(session: UpcomingSession, exercises: UpcomingExercise[]): LocalSessionPayload {
  const referenced = new Set(collectReferencedExerciseIds([session]));
  return { session, exercises: exercises.filter((exercise) => referenced.has(exercise.id)) };
}

/**
 * `local_workout_sessions.client_local_id` is NOT NULL and UNIQUE, while
 * the server column is nullable — deterministic for a materialised session
 * (DB§14.5) and null for an ad-hoc one. Falling back to the server id keeps
 * the local key stable and unique either way, and a session that later
 * acquires a real `client_local_id` upserts against the server on that key,
 * not this one.
 */
function localKeyFor(session: UpcomingSession): string {
  return session.clientLocalId ?? session.id;
}

function sessionRow(
  session: UpcomingSession,
  exercises: UpcomingExercise[],
): typeof localWorkoutSessions.$inferInsert {
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
    payloadJson: serialiseSessionPayload(payloadFor(session, exercises)),
    syncState: 'synced',
    updatedAt: session.updatedAt.getTime(),
  };
}

export interface WriteSessionsResult {
  inserted: number;
  updated: number;
  /** Rows left alone because the device holds unsynced changes to them — rule (c). */
  skippedUnsynced: number;
}

export async function writeSessions(
  db: LocalDb,
  sessions: UpcomingSession[],
  exercises: UpcomingExercise[],
): Promise<WriteSessionsResult> {
  let inserted = 0;
  let updated = 0;
  let skippedUnsynced = 0;

  for (const session of sessions) {
    const key = localKeyFor(session);
    const [existing] = await db
      .select({ syncState: localWorkoutSessions.syncState })
      .from(localWorkoutSessions)
      .where(eq(localWorkoutSessions.clientLocalId, key))
      .limit(1);

    if (!existing) {
      await db.insert(localWorkoutSessions).values(sessionRow(session, exercises));
      inserted += 1;
      continue;
    }
    if (existing.syncState !== 'synced') {
      skippedUnsynced += 1;
      continue;
    }
    const { clientLocalId: _key, ...columns } = sessionRow(session, exercises);
    await db
      .update(localWorkoutSessions)
      .set(columns)
      .where(eq(localWorkoutSessions.clientLocalId, key));
    updated += 1;
  }

  return { inserted, updated, skippedUnsynced };
}

export interface PrefetchSessionsOptions {
  /** The client's zone. Defaults to the one shared resolver — see rule (b). */
  timeZone?: string;
  /** Injected so the day boundary is testable; `CLAUDE.md` §25.5 stays broken when it isn't. */
  now?: Date;
  fetchUpcoming?: UpcomingFetcher;
  db?: LocalDb;
}

export interface PrefetchSessionsResult extends WriteSessionsResult {
  range: UpcomingRange;
  fetched: UpcomingWorkouts;
}

/**
 * Fetches today's and tomorrow's sessions and writes them to
 * `local_workout_sessions` with the full denormalised `payload_json`.
 *
 * Async end to end and never called for its return value on a render path:
 * the caller keeps the thread while the request is in flight, and every
 * local write is awaited individually rather than batched into one long
 * synchronous block (`CLAUDE.md` §19 — nothing here may cost a frame).
 */
export async function prefetchSessions(
  options: PrefetchSessionsOptions = {},
): Promise<PrefetchSessionsResult> {
  // Awaited rather than read synchronously so a direct caller — one that
  // did not come through `./scheduler.ts`, which resolves the zone for the
  // whole pass — still gets the persisted `users.timezone` rather than the
  // device's. Memoised after the first call, and nothing on a render path
  // reaches this.
  const range = upcomingRange(
    options.now ?? new Date(),
    options.timeZone ?? (await ensureClientTimeZoneHydrated()),
  );
  const fetched = await (options.fetchUpcoming ?? fetchViaTrpc)(range);
  const db = options.db ?? (await getLocalDb());
  const written = await writeSessions(db, fetched.sessions, fetched.exercises);
  // Written unconditionally, including when the range produced no session
  // at all — that is precisely the case the Today card needs it for
  // (`today-card/DESIGN-SPEC.md` §5.1).
  await writeUpcomingContext(db, fetched.context);
  return { ...written, range, fetched };
}

export interface PrefetchSessionsAndExercisesResult extends PrefetchSessionsResult {
  exercisesInserted: number;
  exercisesUpdated: number;
}

/**
 * The whole of task 01 in one call: sessions, then the exercises they
 * reference. `prefetch/03` triggers this; nothing here schedules itself.
 */
export async function prefetchSessionsAndExercises(
  options: PrefetchSessionsOptions = {},
): Promise<PrefetchSessionsAndExercisesResult> {
  const sessions = await prefetchSessions(options);
  const db = options.db ?? (await getLocalDb());
  const exercises = await prefetchExercises(sessions.fetched, { db });
  return {
    ...sessions,
    exercisesInserted: exercises.inserted,
    exercisesUpdated: exercises.updated,
  };
}

export { resetPrefetchStateForTests } from './trpc-client.ts';
