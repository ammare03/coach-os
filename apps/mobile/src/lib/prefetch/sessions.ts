import { addCalendarDays, toLocalDate, type CalendarDate } from '@coachos/utils';
import type {
  UpcomingExercise,
  UpcomingSession,
  UpcomingWorkouts,
} from 'api/src/features/workouts/upcoming.ts';
import type { AppRouter } from 'api/src/routers/index.ts';
import { eq } from 'drizzle-orm';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localWorkoutSessions } from '../../db/schema/local-training.ts';

import { collectReferencedExerciseIds, prefetchExercises } from './exercises.ts';

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
// (b) The zone is a parameter, defaulted to the device's. For this call the
//     device zone is the right default and not a bug — the rows describe
//     this client's own training, being prefetched onto this client's own
//     phone, which is the same case `features/sync/queued-at.ts` documents.
//     `code-conventions` §6's "never the device timezone" governs a coach
//     in Mumbai reading a client in Toronto, which this is not. A caller
//     holding the authoritative `users.timezone` (from `me.get`) should
//     still pass it — hence the parameter, rather than reading `Intl`
//     inline where nothing could override it.
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

/**
 * The client's own zone, as the device reports it. Separated out so
 * `upcomingRange` has one obvious seam for a test — and for a caller that
 * has the server's stored `users.timezone` to hand — instead of reaching
 * into `Intl` mid-calculation.
 */
export function resolveDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today and tomorrow as client-local calendar dates. Rule (a) lives here and nowhere else. */
export function upcomingRange(now: Date, timeZone: string): UpcomingRange {
  const from = toLocalDate(now, timeZone);
  return { from, to: addCalendarDays(from, 1) };
}

export type UpcomingFetcher = (range: UpcomingRange) => Promise<UpcomingWorkouts>;

// Lazily built and dynamically imported for the same two reasons
// `lib/outbox/flush.ts` gives: `trpc-links.ts` resolves
// `EXPO_PUBLIC_API_URL` at module scope, and `TRPCProvider`'s client lives
// inside a component's `useState`, unreachable from a module a background
// trigger calls.
let queryClient: Promise<{ query: (path: string, input: unknown) => Promise<unknown> }> | null =
  null;

function getQueryClient(): Promise<{ query: (path: string, input: unknown) => Promise<unknown> }> {
  if (!queryClient) {
    const building = Promise.all([import('@trpc/client'), import('../trpc-links.ts')]).then(
      ([{ createTRPCUntypedClient }, { buildLinks }]) =>
        createTRPCUntypedClient<AppRouter>({ links: buildLinks() }),
    );
    // Don't memoise a failure (same idiom as `db/client.ts` and `flush.ts`).
    building.catch(() => {
      queryClient = null;
    });
    queryClient = building;
  }
  return queryClient;
}

const fetchViaTrpc: UpcomingFetcher = async (range) => {
  const client = await getQueryClient();
  return (await client.query('workouts.upcoming', range)) as UpcomingWorkouts;
};

export function serialiseSessionPayload(payload: LocalSessionPayload): string {
  // superjson, not `JSON.stringify`: `startedAt`/`completedAt`/`updatedAt`
  // are real `Date`s and must still be `Date`s after an app restart —
  // plain JSON degrades them to strings, which is the "everything
  // timestamped at reconnect" failure in `offline-sync` §10 wearing a
  // different hat. Same transformer the wire and the outbox already use.
  return superjsonStringify(payload);
}

/** The matching reader for `local_workout_sessions.payload_json`. P09 calls this, never `JSON.parse`. */
export function parseSessionPayload(payloadJson: string): LocalSessionPayload {
  return superjsonParse<LocalSessionPayload>(payloadJson);
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
  /** The client's zone. Defaults to the device's — see rule (b). */
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
  const range = upcomingRange(
    options.now ?? new Date(),
    options.timeZone ?? resolveDeviceTimeZone(),
  );
  const fetched = await (options.fetchUpcoming ?? fetchViaTrpc)(range);
  const db = options.db ?? (await getLocalDb());
  const written = await writeSessions(db, fetched.sessions, fetched.exercises);
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

/** Test seam — mirrors `resetOutboxFlushStateForTests` in `lib/outbox/flush.ts`. */
export function resetPrefetchStateForTests(): void {
  queryClient = null;
}
