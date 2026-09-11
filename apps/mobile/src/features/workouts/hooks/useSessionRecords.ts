import { eq } from 'drizzle-orm';
import { useEffect } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { meta } from '../../../db/schema/sync.ts';
import { subscribeOutboxResults } from '../../../lib/outbox/results.ts';
import { PR_PRIORITY, readConfirmedRecords } from '../lib/pr-celebration.ts';
import type { PersonalRecordType } from '../lib/pr-celebration.ts';
import { useSessionRecordsStore, type SessionRecord } from '../store/session-records-store.ts';

// `phase-09-workout-logger/session-summary/01` — what fills the ledger, and
// what makes it survive the app being killed.
//
// Six decisions, in the order they matter:
//
// (a) **It listens to the same seam `usePRCelebration` does, and to nothing
//     else.** Record detection is server-side inside the write transaction
//     (`apps/api/src/lib/pr-detection.ts`); there is no local rule that
//     could compute it, because the record is against every set the client
//     has ever logged rather than against this session. So the outbox's
//     result channel is the only place the fact exists, and
//     `readConfirmedRecords` is the one narrowing of it — restating that
//     parse here would be a second answer to "did this set take a record".
//
// (b) **It is NOT gated on the session being in progress.** That is the
//     single behavioural difference from `usePRCelebration`, and it is the
//     point. Task `personal-records/03` drops a confirmation that lands
//     after the logger closes, deliberately: a pill over a finished workout
//     is a notification about the past. But the RECORD is not stale — it is
//     exactly what the summary exists to list, and a set logged in a
//     basement routinely confirms minutes after Finish. Celebrating late is
//     wrong; recording late is required.
//
// (c) **Mounted twice, on purpose.** `SessionLoggerScreen` mounts it for the
//     session's own duration and the summary route mounts it again, so a
//     confirmation is heard whichever screen is on top when the flush loop
//     delivers it. Two listeners are safe because recording is idempotent
//     on `set_logs.client_local_id` (`store/session-records-store.ts`
//     decision (c)) and because the two mounts never overlap in practice —
//     the logger is replaced by the summary, not stacked under it.
//
// (d) **Durability is a mirror, not the source** — `meta`, one key, one row,
//     behind a serialised chain, and the restore is ON that chain rather
//     than alongside it. All four are `useSkipExercise.ts` decision (d)'s
//     rules and all four are load-bearing here for the same reasons: a DDL
//     change would bump `EXPECTED_SCHEMA_VERSION` and drop every device's
//     whole mirror, two interleaved writes would lose a record, and a
//     restore off the chain would clear a row written in the moment before
//     it ran.
//
// (e) **A record for a different session clears the row.** There is one
//     logger and one summary open at a time, so a stale ledger can only
//     ever credit the wrong workout. Same rule as `restoreSkips`.
//
// (f) **Nothing here is announced, celebrated, or tracked.**
//     `personal_record_hit` fires from `usePRCelebration`, exactly once per
//     type per set; a second emitter on the same confirmation would double
//     every record in PostHog. This module writes state and nothing else.

/** DB§13's `meta` key this file owns. `session_skips` and `session_swaps` are the neighbours. */
export const SESSION_RECORDS_META_KEY = 'session_records';

interface StoredRecords {
  sessionLocalId: string;
  records: SessionRecord[];
}

function isPersonalRecordType(value: unknown): value is PersonalRecordType {
  return (PR_PRIORITY as readonly string[]).includes(value as string);
}

function parseRecord(candidate: unknown): SessionRecord | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const { setLocalId, exerciseId, reps, weightKg, estimated1rmKg, types, atMs } =
    candidate as Record<string, unknown>;

  if (typeof setLocalId !== 'string' || setLocalId.length === 0) return null;
  if (typeof exerciseId !== 'string' || exerciseId.length === 0) return null;
  if (typeof reps !== 'number' || !Number.isFinite(reps)) return null;
  if (weightKg !== null && (typeof weightKg !== 'number' || !Number.isFinite(weightKg)))
    return null;
  if (
    estimated1rmKg !== null &&
    (typeof estimated1rmKg !== 'number' || !Number.isFinite(estimated1rmKg))
  ) {
    return null;
  }
  if (!Array.isArray(types) || types.length === 0 || !types.every(isPersonalRecordType))
    return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;

  return { setLocalId, exerciseId, reps, weightKg, estimated1rmKg, types, atMs };
}

/**
 * The stored ledger, or `null` for anything this build cannot vouch for —
 * absent, unparseable, or carrying an entry of the wrong shape.
 *
 * Never a partially rebuilt list: a summary that silently lists three of a
 * client's four records is worse than one that lists none, because it looks
 * complete.
 */
export function parseStoredRecords(stored: string | null | undefined): StoredRecords | null {
  if (stored === null || stored === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const { sessionLocalId, records } = parsed as Record<string, unknown>;
  if (typeof sessionLocalId !== 'string' || sessionLocalId.length === 0) return null;
  if (!Array.isArray(records)) return null;

  const entries: SessionRecord[] = [];
  for (const candidate of records) {
    const entry = parseRecord(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { sessionLocalId, records: entries };
}

async function readStoredRecords(db: LocalDb): Promise<string | null | undefined> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, SESSION_RECORDS_META_KEY))
    .limit(1);
  return row?.value;
}

async function writeStoredRecords(db: LocalDb, stored: StoredRecords): Promise<void> {
  const value = JSON.stringify(stored);
  await db
    .insert(meta)
    .values({ key: SESSION_RECORDS_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function clearStoredRecords(db: LocalDb): Promise<void> {
  await db.delete(meta).where(eq(meta.key, SESSION_RECORDS_META_KEY));
}

/** One chain for the whole app — decision (d). The restore is on it too. */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueuePersistence(task: () => Promise<void>, code: string): void {
  pendingWrite = pendingWrite.then(task).catch((error: unknown) => {
    // A code and the shape of the failure, never the session's contents
    // (`observability-ops` §1). The cost is a record that will not come
    // back after a force-quit; the client's sets are durable regardless.
    console.warn(code, { errorName: error instanceof Error ? error.name : 'unknown' });
  });
}

function mirrorRecords(sessionLocalId: string, records: readonly SessionRecord[]): void {
  enqueuePersistence(async () => {
    const db = await getLocalDb();
    if (records.length === 0) await clearStoredRecords(db);
    else await writeStoredRecords(db, { sessionLocalId, records: [...records] });
  }, 'workouts.records_persist_failed');
}

/** Reads back whatever the last process recorded for this session — decision (e). */
export async function restoreSessionRecords(sessionLocalId: string, db?: LocalDb): Promise<void> {
  const database = db ?? (await getLocalDb());
  const stored = parseStoredRecords(await readStoredRecords(database));

  if (stored === null) {
    // A corrupted row is still a row, and leaving it means re-rejecting it
    // on every launch forever.
    await clearStoredRecords(database);
    return;
  }
  if (stored.sessionLocalId !== sessionLocalId) {
    await clearStoredRecords(database);
    return;
  }

  useSessionRecordsStore.getState().hydrate(sessionLocalId, stored.records);
}

export interface UseSessionRecordsOptions {
  /** `local_workout_sessions.client_local_id` — the id both the logger and the summary carry. */
  sessionLocalId: string;
  /** Evaluated at each confirmation, never at mount. Injected so the order is testable. */
  now?: (() => Date) | undefined;
}

/**
 * Keeps this session's record ledger.
 *
 * Renders nothing and returns nothing: what it produces is store state, and
 * `../components/SessionSummaryCard.tsx` is what draws it.
 */
export function useSessionRecords({ sessionLocalId, now }: UseSessionRecordsOptions): void {
  // `openSession` first and synchronously, so a confirmation landing before
  // the restore resolves is still attributed to the right workout.
  useEffect(() => {
    useSessionRecordsStore.getState().openSession(sessionLocalId);
    enqueuePersistence(
      () => restoreSessionRecords(sessionLocalId),
      'workouts.records_restore_failed',
    );
  }, [sessionLocalId]);

  useEffect(
    () =>
      subscribeOutboxResults((sent) => {
        const confirmed = readConfirmedRecords(sent);
        if (confirmed === null) return;
        if (confirmed.sessionLocalId !== sessionLocalId) return;

        const entry: SessionRecord = {
          setLocalId: confirmed.setLocalId,
          exerciseId: confirmed.exerciseId,
          reps: confirmed.reps,
          weightKg: confirmed.weightKg,
          estimated1rmKg: confirmed.estimated1rmKg,
          types: confirmed.types,
          atMs: (now ?? (() => new Date()))().getTime(),
        };

        const store = useSessionRecordsStore.getState();
        store.record(sessionLocalId, entry);
        mirrorRecords(sessionLocalId, useSessionRecordsStore.getState().records);
      }),
    [now, sessionLocalId],
  );
}

/** Test-only teardown — forgets the write chain so one test cannot bleed into the next. */
export function resetSessionRecordsPersistenceForTests(): void {
  pendingWrite = Promise.resolve();
}
