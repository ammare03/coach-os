import { formatSubstitutionNoteLine } from '@coachos/utils';
import { eq } from 'drizzle-orm';
import { useCallback, useEffect } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { meta } from '../../../db/schema/sync.ts';
import type { AlternativeExercise } from '../lib/alternatives.ts';
import type { ExercisePage } from '../lib/exercise-pages.ts';
import {
  useSubstitutedExercisesStore,
  type ExerciseSubstitution,
} from '../store/substituted-exercises-store.ts';

// `phase-09-workout-logger/session-modifications/02` — substituting one
// exercise for a coach-approved alternative, and the only durable trace it
// leaves.
//
// Six decisions, in the order they matter:
//
// (a) **No schema, and no new table.** `DATABASE.md` DB§5.2 gives `set_logs`
//     no substitution-provenance column and `CLAUDE.md` §0 forbids inventing
//     one. The substitution reaches the coach as a line in `set_logs.notes`
//     — an existing free-text field, already scoped to the exact set that
//     was logged against the substitute (task 02 Approach step 6).
//     {@link substitutionNote} is that seam and `SetEntrySlot` is its one
//     caller. A free-text note cannot be aggregated the way a foreign key
//     could; that is the accepted trade, and the natural fix if substitution
//     analytics ever become a product need is a real
//     `set_logs.program_exercise_id` added through `phase-01-data-layer`,
//     not a workaround bolted on here.
//
// (b) **Nothing here awaits the radio, and nothing here queues a mutation.**
//     The swap is a local decision about a local session — there is no
//     server call on this path at all, which is why it works in airplane
//     mode by construction rather than by a connectivity branch
//     (`offline-sync` §1). Its only server-bound consequence is the sets the
//     client then logs against the substitute, which were always going to
//     sync through `set-entry/01`'s existing offline path.
//
// (c) **The program is never touched.** The store is session-scoped
//     (`store/substituted-exercises-store.ts` decision (c)) and nothing here
//     writes `program_exercises`; a coach's template and every future week's
//     assignment are exactly as they were. Making the swap permanent would
//     be a program-authoring action, which task 02 puts out of scope.
//
// (d) **Durability is a mirror, not the source.** `meta`, not a new table,
//     for `lib/rest-timer-persistence.ts` decision (a)'s reason: a DDL change
//     means bumping `EXPECTED_SCHEMA_VERSION`, which drops every device's
//     whole mirror on the next launch. One key, one row, written behind a
//     serialised chain so two writes cannot interleave and resurrect a swap
//     that was reverted.
//
// (e) **The instant is captured at the tap** (`offline-sync` §10), so the
//     order two swaps were made in survives a sync that happens hours later
//     in a different place.
//
// (f) **A swap asks for no confirmation and is reversible.** The picker IS
//     the decision — one tap, one swap — and what makes that safe is
//     {@link UseSwapExerciseResult.revert}, offered in the same sheet
//     (`ui-conventions` §5's undo-not-confirm). A dialog would cost every
//     honest swap a tap in the one place where taps are expensive.

/** DB§13's `meta` key this file owns. `session_skips` and `rest_timer` are the neighbours. */
export const SUBSTITUTED_EXERCISES_META_KEY = 'session_swaps';

/**
 * What one substitution says in `set_logs.notes` — decision (a).
 *
 * One consistently-formatted sentence, so `session-summary` and the coach's
 * own session review (`phase-10-coach-review-surfaces/session-review/`) can
 * both recognise it without either inventing a second wording.
 *
 * That second reader now exists, so the wording itself lives in
 * `@coachos/utils`' `session-notes.ts` beside the parser that reads it back
 * — the promise this comment made, kept structurally rather than by care.
 */
export function substitutionNoteLine(substitution: ExerciseSubstitution): string {
  return formatSubstitutionNoteLine({ originalName: substitution.originalName });
}

/**
 * The note to store on a set logged against a substitute, or `null` for a
 * set that should carry none.
 *
 * **Only the FIRST set of a substituted exercise takes the line** — repeating
 * it on every set would turn a coach's session review into the same sentence
 * forty times, and the fact is about the exercise, not about each set of it.
 *
 * **A client's own note is never overwritten** (task 02's acceptance
 * criterion). The substitution is prepended on its own line, so the client's
 * words survive verbatim and stay theirs.
 */
export function substitutionNote(
  substitution: ExerciseSubstitution | null | undefined,
  setsAlreadyLogged: number,
  clientNote?: string | null,
): string | null {
  const own = clientNote?.trim() ?? '';
  const line = substitution && setsAlreadyLogged === 0 ? substitutionNoteLine(substitution) : null;

  if (line === null) return own.length === 0 ? null : own;
  return own.length === 0 ? line : `${line}\n${own}`;
}

interface StoredSubstitutions {
  sessionLocalId: string;
  substitutions: ExerciseSubstitution[];
}

/**
 * The stored row, or `null` for anything this build cannot vouch for —
 * absent, unparseable, or carrying an entry of the wrong shape. Never a
 * partially rebuilt set: a session that came back with half its swaps would
 * put the client on an exercise they did not choose, which is worse than
 * coming back on the coach's own.
 */
export function parseStoredSubstitutions(
  stored: string | null | undefined,
): StoredSubstitutions | null {
  if (stored === null || stored === undefined) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { sessionLocalId, substitutions } = parsed as Record<string, unknown>;
  if (typeof sessionLocalId !== 'string' || sessionLocalId.length === 0) return null;
  if (!Array.isArray(substitutions)) return null;

  const entries: ExerciseSubstitution[] = [];
  for (const candidate of substitutions) {
    const entry = parseSubstitution(candidate);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { sessionLocalId, substitutions: entries };
}

function parseSubstitution(candidate: unknown): ExerciseSubstitution | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const {
    exerciseKey,
    originalExerciseId,
    originalName,
    substituteExerciseId,
    substituteName,
    atMs,
  } = candidate as Record<string, unknown>;

  if (typeof exerciseKey !== 'string' || exerciseKey.length === 0) return null;
  if (typeof originalExerciseId !== 'string') return null;
  if (typeof originalName !== 'string') return null;
  if (typeof substituteExerciseId !== 'string' || substituteExerciseId.length === 0) return null;
  if (typeof substituteName !== 'string') return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;

  return {
    exerciseKey,
    originalExerciseId,
    originalName,
    substituteExerciseId,
    substituteName,
    atMs,
  };
}

async function readStored(db: LocalDb): Promise<string | null | undefined> {
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, SUBSTITUTED_EXERCISES_META_KEY))
    .limit(1);
  return row?.value;
}

async function writeStored(db: LocalDb, stored: StoredSubstitutions): Promise<void> {
  const value = JSON.stringify(stored);
  await db
    .insert(meta)
    .values({ key: SUBSTITUTED_EXERCISES_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function clearStored(db: LocalDb): Promise<void> {
  await db.delete(meta).where(eq(meta.key, SUBSTITUTED_EXERCISES_META_KEY));
}

/**
 * One chain for the whole app — decision (d). Nothing that touches the
 * stored row may interleave with anything else that does, **including the
 * restore**, which both reads the row and clears it: a swap taken in the
 * second between the logger opening and the read landing would otherwise be
 * written to disk and then deleted by the read that existed to bring it
 * back. `hooks/useSkipExercise.ts` learned that one the expensive way.
 */
let pendingWrite: Promise<void> = Promise.resolve();

function enqueuePersistence(task: () => Promise<void>, code: string): void {
  pendingWrite = pendingWrite.then(task).catch((error: unknown) => {
    // A code and the shape of the failure, never the session's contents
    // (`observability-ops` §1). The cost is a swap that will not come back
    // after a force-quit; the sets logged against it are durable regardless.
    console.warn(code, { errorName: error instanceof Error ? error.name : 'unknown' });
  });
}

function mirror(sessionLocalId: string, substitutions: readonly ExerciseSubstitution[]): void {
  enqueuePersistence(async () => {
    const db = await getLocalDb();
    if (substitutions.length === 0) await clearStored(db);
    else await writeStored(db, { sessionLocalId, substitutions: [...substitutions] });
  }, 'workouts.swap_persist_failed');
}

/**
 * Reads back whatever the last process recorded for this session.
 *
 * A record for a DIFFERENT session is cleared rather than kept: there is one
 * logger open at a time, so a stale row can only ever swap the wrong
 * workout's pages.
 */
export async function restoreSubstitutions(sessionLocalId: string, db?: LocalDb): Promise<void> {
  const database = db ?? (await getLocalDb());
  const stored = parseStoredSubstitutions(await readStored(database));

  if (stored === null) {
    // A corrupted row is still a row, and leaving it means re-rejecting it
    // on every launch forever.
    await clearStored(database);
    return;
  }
  if (stored.sessionLocalId !== sessionLocalId) {
    await clearStored(database);
    return;
  }

  useSubstitutedExercisesStore.getState().hydrate(sessionLocalId, stored.substitutions);
}

export interface SwapExerciseInput {
  /** The slot being swapped, as the pager is currently showing it. */
  page: ExercisePage;
  /** The chosen row, which came from `lib/alternatives.ts` and nowhere else. */
  substitute: AlternativeExercise;
}

export interface UseSwapExerciseDeps {
  /** `local_workout_sessions.client_local_id` — the id the logger route carries. */
  sessionLocalId: string;
  /** Evaluated at the tap, never at mount — decision (e). Injected so it is testable. */
  now?: (() => Date) | undefined;
}

export interface UseSwapExerciseResult {
  /** Applies the substitution to this slot. Never throws, never awaits. */
  swap: (input: SwapExerciseInput) => void;
  /** Puts the coach's own exercise back — decision (f). */
  revert: (exerciseKey: string) => void;
}

export function useSwapExercise({
  sessionLocalId,
  now,
}: UseSwapExerciseDeps): UseSwapExerciseResult {
  // Points the store at this session and reads back what survived the last
  // process. `openSession` first and synchronously, so a tap landing before
  // the restore resolves is still attributed to the right workout.
  useEffect(() => {
    useSubstitutedExercisesStore.getState().openSession(sessionLocalId);
    // On the chain, not alongside it — see `pendingWrite`'s note.
    enqueuePersistence(() => restoreSubstitutions(sessionLocalId), 'workouts.swap_restore_failed');
  }, [sessionLocalId]);

  const swap = useCallback(
    ({ page, substitute }: SwapExerciseInput) => {
      // A page already swapped names the substitute; the ORIGINAL is what
      // the note has to report, so it is read off `substitutedFor` when
      // there is one and off the page otherwise. Without this, swapping
      // twice would tell the coach the client replaced the first substitute
      // rather than the exercise they were actually programmed.
      const original = page.substitutedFor ?? { exerciseId: page.exerciseId, name: page.name };

      const entry: ExerciseSubstitution = {
        exerciseKey: page.key,
        originalExerciseId: original.exerciseId,
        originalName: original.name,
        substituteExerciseId: substitute.id,
        substituteName: substitute.name,
        atMs: (now ?? (() => new Date()))().getTime(),
      };

      const store = useSubstitutedExercisesStore.getState();
      store.substitute(sessionLocalId, entry);
      mirror(sessionLocalId, [...useSubstitutedExercisesStore.getState().substitutions.values()]);
    },
    [now, sessionLocalId],
  );

  const revert = useCallback(
    (exerciseKey: string) => {
      const store = useSubstitutedExercisesStore.getState();
      store.revert(sessionLocalId, exerciseKey);
      mirror(sessionLocalId, [...useSubstitutedExercisesStore.getState().substitutions.values()]);
    },
    [sessionLocalId],
  );

  return { swap, revert };
}

/** Test-only teardown — forgets the write chain so one test cannot bleed into the next. */
export function resetSwapPersistenceForTests(): void {
  pendingWrite = Promise.resolve();
}
