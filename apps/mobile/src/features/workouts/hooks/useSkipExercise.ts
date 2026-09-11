import { eq } from 'drizzle-orm';
import { useCallback, useEffect } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { meta } from '../../../db/schema/sync.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';
import {
  SKIP_REASON_LABEL,
  useSkippedExercisesStore,
  type SkipReason,
  type SkippedExercise,
} from '../store/skipped-exercises-store.ts';

// `phase-09-workout-logger/session-modifications/03` — recording one skipped
// exercise, and moving on from it.
//
// Six decisions, in the order they matter:
//
// (a) **No schema, and no new table.** `DATABASE.md` DB§5.2 has no
//     per-exercise skip table, and `CLAUDE.md` §0's rule against inventing
//     columns applies to inventing tables. The skip reaches the coach as a
//     sentence in `workout_sessions.client_notes` — an existing free-text
//     field already scoped to this session — which trades queryable
//     structure for zero schema footprint (task 03 Approach step 1). If
//     aggregate skip-reason analytics ever become a product need, that is
//     the moment to add a table through `phase-01-data-layer`, not before.
//
// (b) **Nothing here awaits the radio, and nothing here queues a mutation.**
//     A skip is a local fact about a local session; there is no server call
//     on this path at all, which is why it works with the phone in airplane
//     mode by construction rather than by a connectivity branch
//     (`offline-sync` §1). {@link composeSkipNotes} is the seam: it renders
//     the stored skips as the exact `client_notes` text, for whichever
//     mutation carries the session's notes to the server.
//
//     **That mutation does not exist yet.** `workouts.complete`'s input is a
//     `strictObject` with no notes field and `packages/schemas` has no
//     notes-update procedure, so today the line is composed and held on the
//     device. `session-summary/03` is the task that carries session notes to
//     the server; when it lands it calls {@link composeSkipNotes} and
//     prepends the result to whatever the client typed. Enqueuing a
//     `workouts.*` path the server does not serve would fail ten times and
//     surface as "couldn't sync" over a skip that synced nothing — strictly
//     worse than holding it.
//
// (c) **The local write is synchronous with the tap and the pager advances
//     on the same tick.** The store write is a plain `set`, so the page is
//     already marked and the index already moved before the `meta` mirror is
//     even started. Task 03's criterion is that a skip never blocks paging,
//     and the way to guarantee that is to have nothing on the path that can
//     block.
//
// (d) **Durability is a mirror, not the source.** `meta`, not a new table,
//     for exactly `lib/rest-timer-persistence.ts` decision (a)'s reason: a
//     DDL change means bumping `EXPECTED_SCHEMA_VERSION`, which drops every
//     device's whole mirror on the next launch. One key, one row, written
//     behind a serialised chain so two writes cannot interleave and
//     resurrect a skip that was undone.
//
// (e) **The instant is captured at the tap** (`offline-sync` §10) — the
//     client who skipped at 19:00 in a basement skipped at 19:00, whatever
//     time the note eventually reaches the coach.
//
// (f) **A skip is undoable and asks for no confirmation.** The reason sheet
//     IS the confirmation (task 03's criterion against a second dialog), and
//     what makes that safe is {@link UseSkipExerciseResult.undo} on the
//     skipped page rather than an alert in front of every skip
//     (`ui-conventions` §5's undo-not-confirm).

/** DB§13's `meta` key this file owns. `rest_timer` and `schema_version` are the neighbours. */
export const SKIPPED_EXERCISES_META_KEY = 'session_skips';

/** What one skip says in `workout_sessions.client_notes`. */
export function skipNoteLine(skip: SkippedExercise): string {
  const reason = SKIP_REASON_LABEL[skip.reason].toLowerCase();
  const said = skip.note === null ? '' : ` (${skip.note})`;
  return `Skipped: ${skip.exerciseName} — ${reason}${said}`;
}

/**
 * Every skip as the `client_notes` text, in the order they were taken.
 *
 * Decision (b)'s seam. Returns `''` for a session with no skips, so a caller
 * can concatenate unconditionally.
 */
export function composeSkipNotes(skips: Iterable<SkippedExercise>): string {
  return [...skips]
    .sort((a, b) => a.atMs - b.atMs)
    .map(skipNoteLine)
    .join('\n');
}

interface StoredSkips {
  sessionLocalId: string;
  skips: SkippedExercise[];
}

/**
 * The stored row, or `null` for anything this build cannot vouch for —
 * absent, unparseable, or carrying an entry of the wrong shape. Never a
 * partially rebuilt set: a page greyed out by a half-read record is worse
 * than one that lost a skip.
 */
export function parseStoredSkips(stored: string | null | undefined): StoredSkips | null {
  if (stored === null || stored === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { sessionLocalId, skips } = parsed as Record<string, unknown>;
  if (typeof sessionLocalId !== 'string' || sessionLocalId.length === 0) return null;
  if (!Array.isArray(skips)) return null;

  const entries: SkippedExercise[] = [];
  for (const candidate of skips) {
    const entry = parseSkip(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { sessionLocalId, skips: entries };
}

function parseSkip(candidate: unknown): SkippedExercise | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const { exerciseKey, exerciseId, exerciseName, reason, note, atMs } = candidate as Record<
    string,
    unknown
  >;

  if (typeof exerciseKey !== 'string' || exerciseKey.length === 0) return null;
  if (typeof exerciseId !== 'string') return null;
  if (typeof exerciseName !== 'string') return null;
  if (!isSkipReason(reason)) return null;
  if (note !== null && typeof note !== 'string') return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;

  return { exerciseKey, exerciseId, exerciseName, reason, note, atMs };
}

function isSkipReason(value: unknown): value is SkipReason {
  return value === 'equipment' || value === 'pain' || value === 'time' || value === 'other';
}

async function readStoredSkips(db: LocalDb): Promise<string | null | undefined> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, SKIPPED_EXERCISES_META_KEY))
    .limit(1);
  return row?.value;
}

async function writeStoredSkips(db: LocalDb, stored: StoredSkips): Promise<void> {
  const value = JSON.stringify(stored);
  await db
    .insert(meta)
    .values({ key: SKIPPED_EXERCISES_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function clearStoredSkips(db: LocalDb): Promise<void> {
  await db.delete(meta).where(eq(meta.key, SKIPPED_EXERCISES_META_KEY));
}

/**
 * One chain for the whole app — decision (d). Nothing that touches the stored
 * row may interleave with anything else that does.
 *
 * Two writes out of order put back a skip that was undone. **And the restore
 * belongs on this chain too**, which is less obvious and cost a real bug: the
 * restore both reads the row and CLEARS it, so a skip taken in the second
 * between the logger opening and the read landing was written to disk and
 * then deleted by the read that existed to bring it back. Failures are
 * swallowed into the chain so one rejection cannot strand what is queued
 * behind it.
 */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueuePersistence(task: () => Promise<void>, code: string): void {
  pendingWrite = pendingWrite.then(task).catch((error: unknown) => {
    // A code and the shape of the failure, never the session's contents
    // (`observability-ops` §1). The cost is a skip that will not come back
    // after a force-quit; the client's sets are durable regardless and this
    // must not reach them.
    console.warn(code, { errorName: error instanceof Error ? error.name : 'unknown' });
  });
}

function mirrorSkips(sessionLocalId: string, skips: readonly SkippedExercise[]): void {
  enqueuePersistence(async () => {
    const db = await getLocalDb();
    if (skips.length === 0) await clearStoredSkips(db);
    else await writeStoredSkips(db, { sessionLocalId, skips: [...skips] });
  }, 'workouts.skip_persist_failed');
}

/**
 * Reads back whatever the last process recorded for this session.
 *
 * A record for a DIFFERENT session is cleared rather than kept: there is one
 * logger open at a time, so a stale row can only ever mark the wrong
 * workout's pages.
 */
export async function restoreSkips(sessionLocalId: string, db?: LocalDb): Promise<void> {
  const database = db ?? (await getLocalDb());
  const stored = parseStoredSkips(await readStoredSkips(database));

  if (stored === null) {
    // A corrupted row is still a row, and leaving it means re-rejecting it
    // on every launch forever.
    await clearStoredSkips(database);
    return;
  }
  if (stored.sessionLocalId !== sessionLocalId) {
    await clearStoredSkips(database);
    return;
  }

  useSkippedExercisesStore.getState().hydrate(sessionLocalId, stored.skips);
}

export interface SkipExerciseInput {
  page: ExercisePage;
  reason: SkipReason;
  /** The client's own words. Blank is stored as `null`, never as `''`. */
  note?: string | undefined;
}

export interface UseSkipExerciseDeps {
  /** `local_workout_sessions.client_local_id` — the id the logger route carries. */
  sessionLocalId: string;
  /** How many pages the session has, so the advance cannot run off the end. */
  pageCount: number;
  /** Moves the pager. Omitted, the skip is recorded and the page does not move. */
  onAdvance?: ((index: number) => void) | undefined;
  /** Evaluated at the tap, never at mount — decision (e). Injected so it is testable. */
  now?: (() => Date) | undefined;
}

export interface UseSkipExerciseResult {
  /** Records the skip and advances to the next exercise. Never throws, never awaits. */
  skip: (input: SkipExerciseInput) => void;
  /** Takes one back — decision (f). */
  undo: (exerciseKey: string) => void;
}

export function useSkipExercise({
  sessionLocalId,
  pageCount,
  onAdvance,
  now,
}: UseSkipExerciseDeps): UseSkipExerciseResult {
  // Points the store at this session and reads back what survived the last
  // process. `openSession` first and synchronously, so a tap landing before
  // the restore resolves is still attributed to the right workout.
  useEffect(() => {
    useSkippedExercisesStore.getState().openSession(sessionLocalId);
    // On the chain, not alongside it — see `pendingWrite`'s note.
    enqueuePersistence(() => restoreSkips(sessionLocalId), 'workouts.skip_restore_failed');
  }, [sessionLocalId]);

  const skip = useCallback(
    ({ page, reason, note }: SkipExerciseInput) => {
      const trimmed = note?.trim() ?? '';
      const entry: SkippedExercise = {
        exerciseKey: page.key,
        exerciseId: page.exerciseId,
        exerciseName: page.name,
        reason,
        note: trimmed.length === 0 ? null : trimmed,
        atMs: (now ?? (() => new Date()))().getTime(),
      };

      const store = useSkippedExercisesStore.getState();
      store.skip(sessionLocalId, entry);
      mirrorSkips(sessionLocalId, [...useSkippedExercisesStore.getState().skips.values()]);

      // Decision (c). `page.position` is 1-based, so it IS the next page's
      // index; the last exercise has nothing after it and stays put, showing
      // its own skipped state rather than bouncing to the first.
      if (page.position < pageCount) onAdvance?.(page.position);
    },
    [now, onAdvance, pageCount, sessionLocalId],
  );

  const undo = useCallback(
    (exerciseKey: string) => {
      const store = useSkippedExercisesStore.getState();
      store.unskip(sessionLocalId, exerciseKey);
      mirrorSkips(sessionLocalId, [...useSkippedExercisesStore.getState().skips.values()]);
    },
    [sessionLocalId],
  );

  return { skip, undo };
}

/** Test-only teardown — forgets the write chain so one test cannot bleed into the next. */
export function resetSkipPersistenceForTests(): void {
  pendingWrite = Promise.resolve();
}
