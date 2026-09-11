import { useUndoToast } from '@coachos/ui';
import { eq } from 'drizzle-orm';
import { useCallback, useMemo } from 'react';
import { create } from 'zustand';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';

// `phase-09-workout-logger/set-entry/06` — withdrawing a set the client
// logged by mistake. `useLogSet`'s and `useUpdateSet`'s third sibling: same
// local mirror, same outbox, same "nothing here awaits the radio". One thing
// is structurally different, and it is the whole task.
//
// (a) **Nothing is deleted when the user taps delete.** The set is hidden
//     from the list, a five-second undo toast opens, and *only if that
//     window closes untouched* does anything reach SQLite or the outbox.
//     Undo therefore has nothing to reverse — it takes an id back out of a
//     set of hidden ids and stops.
//
//     The alternative (delete now, re-create on undo) is the failure the
//     task's Risks section names and `useUndoToast`'s own header spells out:
//     undo becomes a second, compensating mutation, and a compensating
//     mutation that fails leaves the user looking at a row they just
//     brought back and that is not there. Deferring makes undo free and
//     makes the force-quit case safe in the right direction — kill the app
//     mid-window and the set simply survives, because no delete was ever
//     written.
//
// (b) **A confirm dialog is not an option here.** `CLAUDE.md` §7.5 /
//     `ui-conventions` §5: a destructive action performs immediately and
//     offers undo. The two named exceptions — account deletion and client
//     archival — both start something a five-second window cannot honestly
//     cover, and neither is this. `ConfirmModal` ships with exactly those
//     two consumers and a third is a design review, not an import.
//
// (c) **The delete rides the set's own `client_local_id`.** Passing it as
//     `reuseClientLocalId` buys two things at once (`lib/outbox/enqueue.ts`):
//     the delete is idempotent under replay like every other offline
//     mutation, and it is **chained behind whatever outbox row already
//     carries that key** — the original log, or an edit of it. Without the
//     chain they would be siblings, siblings flush concurrently (rule 4),
//     and a delete that overtakes the log it withdraws names a
//     `client_local_id` the server has never heard of. That is not a
//     resurrection bug — `workouts.logSet` omits `deleted_at` from its
//     upsert payload, so a late log cannot clear a delete — it is a delete
//     that 404s, retries ten times, and surfaces to the client as "couldn't
//     sync" for work that was actually fine.
//
// (d) **Remaining sets do not renumber, and the gap stays.** Deleting set 2
//     of 4 leaves 1, 3, 4. Three things already assume this and one of them
//     has a test:
//       • `set-entry/03`'s last-time lookup matches strictly on
//         `set_number` and tolerates gaps — a previous session with sets 1
//         and 3 is a covered case, not a repaired one.
//       • `SetEntrySlot` derives the next number as `highest + 1`, not
//         `count + 1`, so a gap cannot produce a collision; renumbering, by
//         contrast, would silently re-point next week's "last time" at a
//         different set.
//       • Renumbering n rows means n re-sends under n reused keys, turning
//         a one-row withdrawal into an ordered burst the flush loop has to
//         serialise — for a cosmetic result nobody asked for.
//     A gap is what actually happened. The list renders what is there.
//
// (e) **No analytics event**, for `useUpdateSet` rule (e)'s reason exactly.
//     Re-firing `set_logged` would inflate every per-set denominator and
//     poison `entry_ms`; a new `set_deleted` needs an `ANALYTICS.md` row
//     first and has to justify itself against `CLAUDE.md` §20's volume
//     budget, which is already tightest on this surface
//     (`analytics-events` §1, §5). Nobody has committed to reading it, so
//     it does not get created. Note that if one is ever added it carries
//     ids and counts only — never the weight or the reps that were on the
//     row (`CLAUDE.md` §21.1).

/**
 * The tRPC path the outbox replays.
 *
 * ⚠️ **This procedure does not exist yet.** `apps/api/src/routers/workouts.ts`
 * has `upcoming`, `startAdHoc`, `start`, `complete`, `logSet`, `claim`, and
 * `heartbeat` — no delete. The column it must write does exist
 * (`set_logs.deleted_at`, and `set_logs_client_exercise` is already partial
 * on `deleted_at IS NULL`), so the server half is a soft delete, not a row
 * removal. The payload below is the shape it has to accept:
 * `sessionClientLocalId` to resolve the session and its owner without a
 * server id — `logSet` decision (b)'s argument, unchanged — plus the
 * `deletedAt` instant captured on the device, and the `client_local_id` the
 * flush loop merges in from the outbox row itself.
 */
export const DELETE_SET_PROCEDURE = 'workouts.deleteSet';

/** What the outbox will send. Named so the server task can build to it. */
export interface DeleteSetPayload {
  /** `local_workout_sessions.client_local_id` — never a server id. */
  sessionClientLocalId: string;
  /** Captured at the tap, not at flush (`offline-sync` §10). */
  deletedAt: Date;
}

// ─── The hidden set ───────────────────────────────────────────────────────
//
// Zustand rather than `useState`, because the component that triggers a
// delete and the component that renders the list are not the same one:
// `SetRow` owns the row, `SetEntrySlot` owns the query that produces it. Two
// `useState` copies of "which sets are hidden" would disagree the moment
// either re-rendered alone, and the row would come back under the swipe that
// removed it. `code-conventions` §5: UI state shared across components is a
// store. It holds no server data — only ids the list must skip.

type HiddenState = 'pending' | 'committed';

interface HiddenSet {
  toastId: string;
  state: HiddenState;
}

interface HiddenSetsStore {
  hidden: Readonly<Record<string, HiddenSet>>;
  hide: (setLocalId: string, toastId: string) => void;
  reveal: (setLocalId: string) => void;
  settle: (setLocalId: string) => void;
}

/**
 * A committed id stays hidden rather than being dropped.
 *
 * The row is gone from SQLite by then, but two things can still hand the
 * list a copy of it: a caller holding sets in its own component state (the
 * composer appends what `useLogSet` returned), and a prefetch that runs
 * before the outbox has flushed the delete. Keeping the id is the cheap
 * defence against both, and it cannot go stale — `client_local_id` is a
 * uuidv7 and is never reused, so a hidden id can only ever match the row it
 * was recorded for. The set is bounded by one app session's deletes.
 */
const useHiddenSets = create<HiddenSetsStore>((set) => ({
  hidden: {},
  hide: (setLocalId, toastId) =>
    set((current) => ({
      hidden: { ...current.hidden, [setLocalId]: { toastId, state: 'pending' } },
    })),
  reveal: (setLocalId) =>
    set((current) => {
      const { [setLocalId]: removed, ...rest } = current.hidden;
      return removed === undefined ? current : { hidden: rest };
    }),
  settle: (setLocalId) =>
    set((current) => {
      const entry = current.hidden[setLocalId];
      if (entry === undefined || entry.state === 'committed') return current;
      return { hidden: { ...current.hidden, [setLocalId]: { ...entry, state: 'committed' } } };
    }),
}));

/** Test-only. The store outlives a render, so a suite that deletes must clear it. */
export function resetHiddenSetsForTests(): void {
  useHiddenSets.setState({ hidden: {} });
}

// ─── Copy ─────────────────────────────────────────────────────────────────

/**
 * The toast's message. A fact, past tense, sentence case, no exclamation
 * mark and nothing that judges the person who tapped (`COPY.md` CO§2,
 * CO§4.3). A warm-up set has no number the client counts by, so it is named
 * by what it is.
 */
export function deleteSetToastMessage({
  setNumber,
  isWarmup,
}: {
  setNumber: number;
  isWarmup?: boolean | undefined;
}): string {
  return isWarmup === true ? 'Warm-up set deleted' : `Set ${String(setNumber)} deleted`;
}

// ─── The deferred commit ──────────────────────────────────────────────────

/** One already-logged set, as the caller asks for it to be withdrawn. */
export interface DeleteSetArgs {
  /**
   * `local_set_logs.client_local_id` — the value `useLogSet` returned as
   * `LoggedSet.localId`, and the same key `useUpdateSet` takes.
   */
  setLocalId: string;
  /** For the toast's words only. The caller just rendered the row; it knows. */
  setNumber: number;
  /** For the toast's words only. */
  isWarmup?: boolean | undefined;
  /**
   * The window closed and the set is gone — locally and in the outbox. The
   * caller drops it from any list it holds in its own state.
   */
  onCommitted?: (() => void) | undefined;
  /**
   * The commit failed, so **nothing was deleted and the row is visible
   * again**. `ERRORS.md` ER§1.4's local failure; the caller decides whether
   * to say anything. Never swallowed silently (`code-conventions` §8).
   */
  onFailed?: ((error: unknown) => void) | undefined;
  /** Injected so the recorded instant is testable. Evaluated at the tap. */
  now?: (() => Date) | undefined;
}

export interface CommitDeleteSetDeps {
  setLocalId: string;
  /** The tap instant, carried through the deferred window unchanged. */
  deletedAt: Date;
  db?: LocalDb;
}

export interface DeletedSet {
  localId: string;
  /**
   * The `outbox.id` of the queued delete — or `null` when the row was
   * already gone and the commit was a no-op. A second window closing on the
   * same set must not queue a second withdrawal.
   */
  outboxId: string | null;
}

/**
 * Performs the withdrawal the undo window deferred: queues the server's
 * half, then removes the local row.
 *
 * Exported separately from the hook so rules (c) and (d) can be tested
 * without a renderer — the shape `logSet` and `updateSet` are exported in.
 *
 * **Outbox first, mirror second**, `useLogSet` rule (b)'s argument applied
 * to a delete: if the second write fails the server still learns the set is
 * withdrawn and the next prefetch reconciles the device. The other order
 * removes a row locally while the server keeps it, so the set reappears and
 * the client's deletion quietly did not happen.
 */
export async function commitDeleteSet(deps: CommitDeleteSetDeps): Promise<DeletedSet> {
  const db = deps.db ?? (await getLocalDb());

  const [existing] = await db
    .select({
      clientLocalId: localSetLogs.clientLocalId,
      sessionLocalId: localSetLogs.sessionLocalId,
    })
    .from(localSetLogs)
    .where(eq(localSetLogs.clientLocalId, deps.setLocalId))
    .limit(1);

  // Idempotent rather than loud. Unlike `updateSet`, "the row is not there"
  // is the state this function exists to produce, so reaching it twice is a
  // no-op and not a bug worth throwing over.
  if (!existing) return { localId: deps.setLocalId, outboxId: null };

  const [session] = await db
    .select({ startOutboxId: localWorkoutSessions.startOutboxId })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, existing.sessionLocalId))
    .limit(1);

  // Rule (c). `dependsOn` is the session's start, as a fresh log would use,
  // and is superseded by the set's own still-queued log or edit whenever
  // there is one — `enqueueMutation` resolves which.
  const { outboxId } = await enqueueMutation<DeleteSetPayload>({
    procedure: DELETE_SET_PROCEDURE,
    payload: {
      sessionClientLocalId: existing.sessionLocalId,
      deletedAt: deps.deletedAt,
    },
    reuseClientLocalId: existing.clientLocalId,
    ...(session?.startOutboxId == null ? {} : { dependsOn: session.startOutboxId }),
  });

  // A hard delete: `local_set_logs` is a device cache and carries no
  // `deleted_at` by design (`db/schema/local-training.ts`). The soft delete
  // is the server's, on `set_logs.deleted_at`.
  await db.delete(localSetLogs).where(eq(localSetLogs.clientLocalId, existing.clientLocalId));

  return { localId: existing.clientLocalId, outboxId };
}

// ─── The hook ─────────────────────────────────────────────────────────────

export interface UseDeleteSetResult {
  /**
   * Hides the set, opens the five-second undo toast, and defers everything
   * else to rule (a).
   *
   * **Synchronous, and it does not throw.** Nothing that can fail has
   * happened yet; the deferred commit reports through `onCommitted` /
   * `onFailed`. Returns the toast's id so a screen that closes mid-window
   * can settle it with `dismissToast` — which commits, because dismissing
   * is the user saying they are done looking, not that they want it back.
   *
   * Calling it twice for the same set while the first window is open is a
   * no-op that returns the first toast's id.
   */
  deleteSet: (args: DeleteSetArgs) => string;
  /**
   * **Filter the list on this.** True from the moment delete is tapped;
   * false again only if Undo is tapped.
   */
  isSetHidden: (setLocalId: string) => boolean;
  /** The same answer as a set, for a caller filtering many rows at once. */
  hiddenSetIds: ReadonlySet<string>;
}

export function useDeleteSet(): UseDeleteSetResult {
  const showUndoToast = useUndoToast();
  const hidden = useHiddenSets((store) => store.hidden);

  // The store is read imperatively inside the callback rather than closed
  // over, so `deleteSet` keeps a stable identity across the re-render that
  // hiding a row causes — a row whose handler changed every time any set
  // was deleted would defeat the list's own memoisation.
  const deleteSet = useCallback(
    (args: DeleteSetArgs): string => {
      const open = useHiddenSets.getState().hidden[args.setLocalId];
      if (open !== undefined) return open.toastId;

      const deletedAt = (args.now ?? (() => new Date()))();

      const toastId = showUndoToast({
        message: deleteSetToastMessage(args),
        // Rule (a): there is nothing to undo but the hiding.
        onUndo: () => useHiddenSets.getState().reveal(args.setLocalId),
        onCommit: () => {
          void commitDeleteSet({ setLocalId: args.setLocalId, deletedAt })
            .then(() => {
              useHiddenSets.getState().settle(args.setLocalId);
              args.onCommitted?.();
            })
            .catch((error: unknown) => {
              // Nothing was written, so the honest render is the set back
              // where it was. Reported rather than swallowed; the caller
              // owns whatever it says about it.
              useHiddenSets.getState().reveal(args.setLocalId);
              args.onFailed?.(error);
            });
        },
      });

      useHiddenSets.getState().hide(args.setLocalId, toastId);
      return toastId;
    },
    [showUndoToast],
  );

  const hiddenSetIds = useMemo(() => new Set(Object.keys(hidden)), [hidden]);
  const isSetHidden = useCallback((setLocalId: string) => setLocalId in hidden, [hidden]);

  return { deleteSet, isSetHidden, hiddenSetIds };
}
