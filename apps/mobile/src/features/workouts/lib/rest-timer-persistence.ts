import { eq } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { meta } from '../../../db/schema/sync.ts';
import { selectRestAnchor, useRestTimerStore, type RestAnchor } from '../store/rest-timer-store.ts';

// `phase-09-workout-logger/rest-timer/02`'s durable half. The store owns a
// rest while the process is alive; this file is what makes one survive the
// process not being. §8.4's criterion is "rest timer survives app
// backgrounding and device lock", and a locked phone whose app the OS then
// evicts is the same client, still resting, on the same gym floor.
//
// Five decisions, in the order they matter:
//
// (a) **`meta`, not a new table.** DB§13 already keeps this database's
//     singleton facts as key/value rows — `schema_version`
//     (`db/schema-version.ts`), `user_id` (`db/user-scope.ts`) — and a rest
//     is exactly that shape: there is one, or there is none. A dedicated
//     table would mean a DDL change, which means bumping
//     `EXPECTED_SCHEMA_VERSION`, which drops and re-fetches every device's
//     whole mirror on the next launch and puts the unsynced-outbox
//     confirmation dialog in front of clients who only ever needed a
//     countdown restored. That is a wildly disproportionate price, and it
//     would be paid by exactly the offline clients this feature exists for.
//
// (b) **The row exists if and only if a rest is running** —
//     {@link selectRestAnchor} is the one place that rule lives. It is what
//     lets the restore treat a row's mere presence as "a rest was in flight
//     when this process died": no row means nothing was resting, rather
//     than meaning we forgot to clean up after one that finished. The
//     subscription below is the mirror, not a second opinion.
//
// (c) **The write never blocks the set.** `useLogSet` rule (a) budgets the
//     confirming tap at under 100ms (`CLAUDE.md` §19) and `startRest` is
//     documented there as two synchronous store writes with no failure mode
//     — so persistence hangs off a store subscription and a serialised
//     promise chain (the `hooks/useSessionKeepAwake.ts` idiom), never off
//     the logging path. A failed write costs a restored countdown, which is
//     a comfort; a blocked write would cost the set, which is the workout.
//
// (d) **A restored rest is re-validated against its session, never trusted
//     on its own.** The anchor names `local_workout_sessions.client_local_id`
//     and the restore refuses it unless that row is still `in_progress`.
//     `stopRestForSession` already ends the rest when a workout is finished
//     in-process; this covers the case it cannot — the process was dead when
//     the session ended, or the mirror was dropped and re-fetched under it.
//     Two guards for one failure because the failure is a client being
//     handed a rest period for a workout they finished yesterday.
//
// (e) **An expired rest is reported, not hidden, and reported once.** A
//     rest that ran out while the app was dead is a real event with a real
//     instant, and `rest-timer/04`'s alert is the thing that needs to know
//     how long ago it was — so {@link RestRestoration} carries `endedAtMs`
//     rather than a boolean, and this file makes no judgement about whether
//     it is recent enough to be worth an alert. That judgement is 04's. The
//     row is cleared as part of reading it, so the next launch does not
//     report the same zero again.

/** DB§13's `meta` key this file owns. `schema_version` and `user_id` are the neighbours. */
export const REST_TIMER_META_KEY = 'rest_timer';

/** What a cold start found, and what tasks 03 and 04 act on. */
export type RestRestoration =
  /** Nothing was resting, or what was stored is no longer true — decision (d). */
  | { kind: 'none' }
  /** Still counting. `remainingSeconds` is against the real clock, not the stored target. */
  | { kind: 'resumed'; sessionLocalId: string; remainingSeconds: number }
  /**
   * It ran out while nobody was watching — decision (e). `endedAtMs` is when
   * it actually reached zero, which is always before now and may be long
   * before it.
   */
  | { kind: 'expired'; sessionLocalId: string; targetSeconds: number; endedAtMs: number };

const SECOND_MS = 1_000;

/**
 * The stored row as a {@link RestAnchor}, or `null` for anything this build
 * cannot vouch for — absent, unparseable, short a field, or carrying a
 * value of the wrong type. Never a partially rebuilt rest: a countdown from
 * a `NaN` anchor is a worse outcome than no countdown.
 */
export function parseRestAnchor(stored: string | null | undefined): RestAnchor | null {
  if (stored === null || stored === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Record<string, unknown>;
  const { sessionLocalId, startedAtMs, targetSeconds } = candidate;

  if (typeof sessionLocalId !== 'string' || sessionLocalId.length === 0) return null;
  if (typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs)) return null;
  if (typeof targetSeconds !== 'number' || !Number.isFinite(targetSeconds)) return null;

  return { sessionLocalId, startedAtMs, targetSeconds };
}

export interface RestoreRestTimerDeps {
  db?: LocalDb;
  /** Injected so the elapsed gap is testable; the app never passes it. */
  nowMs?: number;
}

/**
 * Reads the stored anchor, decides whether it is still true, and hands the
 * store whatever survives that.
 *
 * One read of a one-row table plus one indexed session read, and no network
 * at all — the client whose phone killed the app is the client with no
 * signal (`offline-sync` §1).
 */
export async function restoreRestTimer(deps: RestoreRestTimerDeps = {}): Promise<RestRestoration> {
  const db = deps.db ?? (await getLocalDb());
  const nowMs = deps.nowMs ?? Date.now();

  const anchor = parseRestAnchor(await readStoredAnchor(db));
  if (anchor === null) {
    // A corrupted row is still a row, and leaving it would mean re-parsing
    // and re-rejecting it on every launch forever.
    await clearStoredAnchor(db);
    return { kind: 'none' };
  }

  // Decision (d).
  if (!(await isSessionInProgress(db, anchor.sessionLocalId))) {
    await clearStoredAnchor(db);
    return { kind: 'none' };
  }

  useRestTimerStore.getState().resumeRest(anchor, nowMs);
  const { isRunning, remainingSeconds, targetSeconds, startedAtMs } = useRestTimerStore.getState();

  if (isRunning) {
    return { kind: 'resumed', sessionLocalId: anchor.sessionLocalId, remainingSeconds };
  }

  // Decision (e). `startedAtMs` rather than the anchor's own copy: the store
  // clamps a future-dated anchor to now, and the instant reported has to be
  // the one the countdown actually ran from.
  await clearStoredAnchor(db);
  return {
    kind: 'expired',
    sessionLocalId: anchor.sessionLocalId,
    targetSeconds,
    endedAtMs: (startedAtMs ?? nowMs) + targetSeconds * SECOND_MS,
  };
}

/**
 * One chain for the whole app — decision (c). The anchor is a single row and
 * two writes must not interleave: out of order, a stale start can land after
 * the delete that ended it and resurrect a rest that is over. Failures are
 * swallowed into the chain so one rejected write cannot strand the ones
 * queued behind it.
 */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueueMirror(anchor: RestAnchor | null): void {
  pendingWrite = pendingWrite
    .then(async () => {
      const db = await getLocalDb();
      if (anchor === null) await clearStoredAnchor(db);
      else await writeStoredAnchor(db, anchor);
    })
    .catch((error: unknown) => {
      // Decision (c). A code and the shape of the failure, never the
      // session id's contents (`observability-ops` §1). The cost is one
      // countdown that will not come back after a kill; the client's sets
      // are durable regardless and this must not reach them.
      console.warn('workouts.rest_timer_persist_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    });
}

let started: Promise<RestRestoration> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Restores whatever rest survived the last process, then keeps the stored
 * row in step with the store for the rest of this one.
 *
 * Idempotent and memoised, the same shape `lib/connectivity/store.ts`'s
 * `ensureConnectivityTracking` uses: a second call gets the first call's
 * answer and registers no second subscription. Must be called after
 * `local-database/04`'s schema-version gate has answered, or it reads a
 * mirror that is about to be dropped — `components/SessionRecoveryRedirect.tsx`
 * is where that ordering is already enforced.
 *
 * Never rejects. A mirror that will not answer costs a restored countdown
 * and nothing else, and there is no screen worth showing for it
 * (`ERRORS.md` ER§1.4).
 */
export function ensureRestTimerPersistence(
  deps: RestoreRestTimerDeps = {},
): Promise<RestRestoration> {
  if (started) return started;

  started = restoreRestTimer(deps)
    .catch((error: unknown): RestRestoration => {
      console.warn('workouts.rest_timer_restore_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return { kind: 'none' };
    })
    .then((restoration) => {
      // Subscribed after the restore, never before: `resumeRest` would
      // otherwise fire the mirror and rewrite the row it was just read from.
      let last = selectRestAnchor(useRestTimerStore.getState());
      unsubscribe = useRestTimerStore.subscribe((state) => {
        const next = selectRestAnchor(state);
        if (isSameAnchor(last, next)) return;
        last = next;
        enqueueMirror(next);
      });
      return restoration;
    });

  return started;
}

function isSameAnchor(a: RestAnchor | null, b: RestAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sessionLocalId === b.sessionLocalId &&
    a.startedAtMs === b.startedAtMs &&
    a.targetSeconds === b.targetSeconds
  );
}

async function readStoredAnchor(db: LocalDb): Promise<string | null | undefined> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, REST_TIMER_META_KEY))
    .limit(1);
  return row?.value;
}

async function writeStoredAnchor(db: LocalDb, anchor: RestAnchor): Promise<void> {
  const value = JSON.stringify(anchor);
  await db
    .insert(meta)
    .values({ key: REST_TIMER_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function clearStoredAnchor(db: LocalDb): Promise<void> {
  await db.delete(meta).where(eq(meta.key, REST_TIMER_META_KEY));
}

async function isSessionInProgress(db: LocalDb, sessionLocalId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: localWorkoutSessions.status })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, sessionLocalId))
    .limit(1);
  return row?.status === 'in_progress';
}

/** Test-only teardown — forgets the memoised restore, the subscription, and the write chain. */
export function resetRestTimerPersistenceForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = null;
  pendingWrite = Promise.resolve();
}
