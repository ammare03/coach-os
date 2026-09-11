import { create } from 'zustand';

import type { PRCelebrationView } from '../lib/pr-celebration.ts';

// `phase-09-workout-logger/personal-records/03` — the exactly-once guard,
// and the pill currently on screen.
//
// §8.4's phrasing is two words long and both of them are requirements:
// "exactly once, non-blocking". This module owns the first. The second is
// the component's, and it is a layout property rather than a state one.
//
// Five decisions, in the order they matter:
//
// (a) **The dedup key is `client_local_id`, and the guard lives HERE rather
//     than in the hook.** `workouts.logSet` is an idempotent upsert, and
//     `apps/api/src/lib/pr-detection.ts` decision (c) reports the types the
//     set CURRENTLY HOLDS rather than the ones it newly took — deliberately,
//     so a first response lost in a tunnel is still deliverable on the
//     retry. The consequence is that an outbox replay returns the same
//     non-empty array a second time, and the device is the only place that
//     can tell the two apart. `client_local_id` is the one value that is
//     identical across every replay of one set and different for every
//     other set (`lib/outbox/enqueue.ts` generates it exactly once), so it
//     is the key. In the store rather than in a hook because a hook can be
//     mounted twice — two pages, a remount mid-flush — and two copies of
//     the guard is no guard.
//
// (b) **Session-scoped, in memory, never persisted.** A record can only be
//     beaten once, so a fresh app launch has nothing to re-fire: the second
//     attempt at the same set is a replay within one session's lifetime or
//     it is nothing. Persisting the set of celebrated ids would buy nothing
//     and would have to be purged somewhere. {@link openSession} wipes
//     everything when the session changes, which is also what stops one
//     workout's records marking rows in the next.
//
// (c) **Claiming and presenting are separate.** A set that took a record
//     but cannot be worded — no exercise name on the device, a bodyweight
//     set whose only record type has no value (`pr-celebration.ts`
//     decision (d)) — is still claimed and still marks its row. It simply
//     shows no pill. Folding the two together would make a set that could
//     not be worded eligible to be celebrated again on the next replay.
//
// (d) **A second record inside the dwell REPLACES the first.** Never a
//     queue and never a stack: two pills would cover the log list, and a
//     client on a five-set superset can genuinely earn two inside ninety
//     seconds. {@link PRCelebrationState.current} holds one, and its
//     `token` is what the component's dwell timer keys on, so a
//     replacement restarts the clock rather than inheriting the old one's
//     remaining time.
//
// (e) **`dismiss` is token-checked.** The dwell timer fires ~2.8s after the
//     pill it belongs to appeared. If a second record replaced it in the
//     meantime, that timer must not clear the newer pill — so it names the
//     token it was started for and is ignored if that is no longer what is
//     on screen.

export interface PRCelebrationState {
  /** The session every id below belongs to. `null` before the first claim. */
  sessionLocalId: string | null;
  /**
   * `set_logs.client_local_id`s already celebrated in this session —
   * decision (a). Never read by a render; it is the guard, not state.
   */
  celebratedSetIds: ReadonlySet<string>;
  /**
   * The rows that earned a record, for the mark that outlives the pill.
   * 2.6 seconds is short and a client re-racking a bar will miss it; the
   * row keeps a triangle for the rest of the session (design, frame C).
   */
  recordSetIds: ReadonlySet<string>;
  /** The one pill on screen, or `null` — decision (d). */
  current: PRCelebrationView | null;
  /** Monotonic. Handed out by {@link claim} and never reused. */
  nextToken: number;

  /**
   * Points the store at a session, wiping everything if it is a different
   * one — decision (b). Idempotent for the session already open.
   */
  openSession: (sessionLocalId: string) => void;

  /**
   * Claims a set that took a record, marking its row.
   *
   * Returns the token to build the pill with, or **`null` when this set has
   * already been celebrated** — decision (a), and the whole of §8.4's
   * "exactly once".
   */
  claim: (set: { setLocalId: string; sessionLocalId: string }) => number | null;

  /** Puts a built pill on screen, replacing whatever was there — decision (d). */
  present: (view: PRCelebrationView) => void;

  /** Takes the pill down, if it is still the one `token` named — decision (e). */
  dismiss: (token: number) => void;
}

const NO_IDS: ReadonlySet<string> = new Set();

function withId(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  next.add(id);
  return next;
}

export const usePRCelebrationStore = create<PRCelebrationState>((set, get) => ({
  sessionLocalId: null,
  celebratedSetIds: NO_IDS,
  recordSetIds: NO_IDS,
  current: null,
  nextToken: 1,

  openSession: (sessionLocalId) => {
    if (get().sessionLocalId === sessionLocalId) return;
    set({
      sessionLocalId,
      celebratedSetIds: NO_IDS,
      recordSetIds: NO_IDS,
      current: null,
      // Not reset: a token must never repeat within one process, or a
      // timer left over from the previous session could dismiss a pill in
      // this one.
    });
  },

  claim: ({ setLocalId, sessionLocalId }) => {
    const state = get();
    // A result for a session this store is not open on is not ours to
    // celebrate — the client has moved on, and decision (b)'s wipe already
    // discarded that workout's ids.
    if (state.sessionLocalId !== sessionLocalId) return null;
    if (state.celebratedSetIds.has(setLocalId)) return null;

    const token = state.nextToken;
    set({
      celebratedSetIds: withId(state.celebratedSetIds, setLocalId),
      // Decision (c) — the mark is claimed even when the pill is not shown.
      recordSetIds: withId(state.recordSetIds, setLocalId),
      nextToken: token + 1,
    });
    return token;
  },

  present: (view) => {
    set({ current: view });
  },

  dismiss: (token) => {
    if (get().current?.token !== token) return;
    set({ current: null });
  },
}));

/** Selector — the rows that earned a record. Stable identity between claims. */
export function selectRecordSetIds(state: PRCelebrationState): ReadonlySet<string> {
  return state.recordSetIds;
}

/** Selector — the pill on screen. */
export function selectCurrentCelebration(state: PRCelebrationState): PRCelebrationView | null {
  return state.current;
}

/** Test seam — mirrors `resetRestTimerForTests` in `rest-timer-store.ts`. */
export function resetPRCelebrationForTests(): void {
  usePRCelebrationStore.setState({
    sessionLocalId: null,
    celebratedSetIds: NO_IDS,
    recordSetIds: NO_IDS,
    current: null,
    nextToken: 1,
  });
}
