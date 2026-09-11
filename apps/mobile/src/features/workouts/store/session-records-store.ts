import { create } from 'zustand';

import type { PersonalRecordType } from '../lib/pr-celebration.ts';

// `phase-09-workout-logger/session-summary/01` — every record this session
// took, kept until the client has seen the summary.
//
// **Why this exists at all.** `personal-records/03` consumes a confirmation
// and throws it away: `usePRCelebration` builds a pill, the pill dwells for
// 2.6s, and `pr-celebration-store.ts` keeps only the SET IDS it celebrated
// so it can refuse to celebrate them twice. Nothing anywhere persists WHAT
// was beaten. The summary's second acceptance criterion — every PR from the
// session is listed, not only the most recent one — cannot be met by
// reading any of that, and it cannot be met by querying the server either:
// this screen must render with the radio off. So the device keeps its own
// ledger, on the pattern `store/skipped-exercises-store.ts` and
// `store/substituted-exercises-store.ts` already established for the same
// shape of problem.
//
// Five decisions, in the order they matter:
//
// (a) **A ledger, not an extension of the celebration store.** That store's
//     `celebratedSetIds` is a guard whose whole contract is that a set
//     appears in it at most once and is never read by a render
//     (`pr-celebration-store.ts` decision (a)). Recording is a different
//     job with a different lifetime — it outlives the session the guard is
//     scoped to, because a set logged in a basement can confirm after the
//     client has already left the logger.
//
// (b) **It records what the server confirmed, and resolves names later.**
//     An entry carries the set's id, its exercise's id, and the figures the
//     record was taken on — never the exercise NAME. The name belongs to
//     the session payload the device already holds, and the summary resolves
//     it there at render, exactly as `usePRCelebration` does. Copying it
//     here would mean two answers to "what is this exercise called" that
//     could drift after a swap.
//
// (c) **The first confirmation wins.** `workouts.logSet` is an idempotent
//     upsert and `pr-detection.ts` answers a replay with the same non-empty
//     array, so one set can arrive twice. It is one record, at the instant
//     it first landed — taking the later instant would reorder the list on
//     a retry.
//
// (d) **Sorted on insert, by the instant of confirmation.** The list is 0–5
//     entries, so keeping it ordered costs nothing and means the component
//     never sorts in a render. Confirmation order is flush order, which is
//     log order for everything that logged online and the order the tunnel
//     cleared for everything that did not — the honest answer either way.
//
// (e) **Session-scoped, and the session is named on every write.**
//     {@link SessionRecordsState.openSession} wipes when the id changes and
//     `record`/`hydrate` refuse a session this store is not open on — the
//     shape both modification stores use, because a confirmation racing a
//     navigation between two sessions would otherwise credit the wrong
//     workout. Durability is the hook's (`hooks/useSessionRecords.ts`).

/** One set that took at least one record, as the server confirmed it. */
export interface SessionRecord {
  /** `set_logs.client_local_id` — stable across every replay, so it is the dedup key. */
  setLocalId: string;
  exerciseId: string;
  reps: number;
  /** Kilograms, always (`CLAUDE.md` §0). `null` is a bodyweight set. */
  weightKg: number | null;
  /** Epley, as the server computed it. `null` for a bodyweight or zero-rep set. */
  estimated1rmKg: number | null;
  /** Non-empty. Every type this set holds, in the server's own order. */
  types: readonly PersonalRecordType[];
  /** Epoch ms at which the confirmation reached the device — decision (c), (d). */
  atMs: number;
}

const NO_RECORDS: readonly SessionRecord[] = [];

export interface SessionRecordsState {
  /** The session every entry belongs to. `null` before the first open. */
  sessionLocalId: string | null;
  /** Ordered by {@link SessionRecord.atMs}. Replaced wholesale, never mutated. */
  records: readonly SessionRecord[];

  /** Points the ledger at a session, wiping when it is a different one — decision (e). */
  openSession: (sessionLocalId: string) => void;

  /**
   * Seeds what a previous process recorded.
   *
   * Ignored for a session this store is not open on, and **it never clobbers
   * an entry already in memory**: a confirmation can land in the second
   * between the screen mounting and the restore resolving, and the live copy
   * is the newer of the two.
   */
  hydrate: (sessionLocalId: string, restored: readonly SessionRecord[]) => void;

  /** Records one confirmed set. A no-op for a set already in the ledger — decision (c). */
  record: (sessionLocalId: string, entry: SessionRecord) => void;
}

function merge(
  current: readonly SessionRecord[],
  incoming: readonly SessionRecord[],
): readonly SessionRecord[] {
  const seen = new Set(current.map((entry) => entry.setLocalId));
  const added = incoming.filter((entry) => !seen.has(entry.setLocalId));
  if (added.length === 0) return current;
  return [...current, ...added].sort((a, b) => a.atMs - b.atMs);
}

export const useSessionRecordsStore = create<SessionRecordsState>((set, get) => ({
  sessionLocalId: null,
  records: NO_RECORDS,

  openSession: (sessionLocalId) => {
    if (get().sessionLocalId === sessionLocalId) return;
    set({ sessionLocalId, records: NO_RECORDS });
  },

  hydrate: (sessionLocalId, restored) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    if (restored.length === 0) return;
    // The live copy wins — see the doc comment.
    set({ records: merge(state.records, restored) });
  },

  record: (sessionLocalId, entry) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    const next = merge(state.records, [entry]);
    if (next === state.records) return;
    set({ records: next });
  },
}));

/** Selector — the session's records, in order. Stable identity between writes. */
export function selectSessionRecords(state: SessionRecordsState): readonly SessionRecord[] {
  return state.records;
}

/** Test seam — mirrors `resetPRCelebrationForTests` in `pr-celebration-store.ts`. */
export function resetSessionRecordsForTests(): void {
  useSessionRecordsStore.setState({ sessionLocalId: null, records: NO_RECORDS });
}
