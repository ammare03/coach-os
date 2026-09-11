import { create } from 'zustand';

// `phase-09-workout-logger/session-modifications/03` — which exercises the
// client explicitly skipped in the session that is open, and why.
//
// Five decisions, in the order they matter:
//
// (a) **A store, not a field on `ExercisePage`.** `lib/exercise-pages.ts` is
//     a pure function of the session payload, shared by the pager, the rail
//     and the target line; a `skipped` field on it would make the page model
//     depend on runtime state none of those three own, and would have to be
//     threaded through every caller that builds pages. The page model stays
//     a description of the PLAN; this is a description of what happened to
//     it.
//
// (b) **Skipped is not "no sets logged".** A client who ran out of time and
//     never reached exercises 5 and 6 has a different story from one who
//     deliberately skipped exercise 3, and both produce zero `set_logs`
//     rows. `session-summary` counts skipped exercises, and the only thing
//     that can tell the two apart is an explicit record — which is this
//     (task 03's named risk).
//
// (c) **Keyed on `ExercisePage.key` (`program_exercises.id`), never on
//     `exerciseId`.** The same exercise can appear twice in one day — a
//     back-off block, or both halves of a superset drawn from one movement —
//     and skipping one must not grey out the other.
//
// (d) **Session-scoped, and the session is named on every write.**
//     {@link SkippedExercisesState.openSession} wipes when the id changes,
//     the same shape `pr-celebration-store.ts` uses, and `skip`/`unskip`
//     refuse a session this store is not open on. Without that, a write
//     racing a page turn between two sessions would mark the wrong workout.
//
// (e) **The store is the live copy; durability is the hook's.**
//     `hooks/useSkipExercise.ts` mirrors this into `meta` so a skip survives
//     a force-quit mid-session, and hydrates back through
//     {@link SkippedExercisesState.hydrate}. Nothing here touches SQLite:
//     the pager reads this synchronously on the same tick as the tap.

/**
 * The four reasons offered, plus the client's own words.
 *
 * A closed set here, deliberately NOT a database enum — nothing persists
 * this discriminant. The skip reaches the coach as a sentence in
 * `workout_sessions.client_notes` (task 03 Approach step 1), which is the
 * same free-text shape the whole-session skip already uses as its precedent.
 */
export type SkipReason = 'equipment' | 'pain' | 'time' | 'other';

export const SKIP_REASONS: readonly SkipReason[] = ['equipment', 'pain', 'time', 'other'];

/**
 * What each reason is called, on the sheet and everywhere it is read back.
 *
 * **Nothing here judges.** "Pain or discomfort" is the client's own report
 * of their own body, never the product's reading of it, and none of the four
 * is worded as a failure to do something (`COPY.md` §CO2, §CO3). "Something
 * else" rather than "Other": a client is a person, not a form field.
 */
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  equipment: 'Equipment unavailable',
  pain: 'Pain or discomfort',
  time: 'Out of time',
  other: 'Something else',
};

/** One exercise the client skipped, and what they said about it. */
export interface SkippedExercise {
  /** `ExercisePage.key` — `program_exercises.id`. Decision (c). */
  exerciseKey: string;
  exerciseId: string;
  /**
   * The library name as the page showed it at the moment of the skip. Copied
   * rather than looked up later: the note that reaches the coach has to name
   * what the client actually saw, and an exercise cache miss renames a page.
   */
  exerciseName: string;
  reason: SkipReason;
  /** The client's own words, or `null`. Never a trimmed-to-empty string. */
  note: string | null;
  /** Epoch ms, captured at the tap — never at persistence time. */
  atMs: number;
}

const NO_SKIPS: ReadonlyMap<string, SkippedExercise> = new Map();

export interface SkippedExercisesState {
  /** The session every entry below belongs to. `null` before the first open. */
  sessionLocalId: string | null;
  /** By `ExercisePage.key`. Replaced wholesale, never mutated. */
  skips: ReadonlyMap<string, SkippedExercise>;

  /** Points the store at a session, wiping when it is a different one — decision (d). */
  openSession: (sessionLocalId: string) => void;

  /**
   * Seeds what a previous process recorded (decision (e)).
   *
   * Ignored for a session this store is not open on, and **it never clobbers
   * a skip already in memory**: the restore can land after the client has
   * already skipped something in this process, and the live copy is the
   * newer of the two.
   */
  hydrate: (sessionLocalId: string, restored: readonly SkippedExercise[]) => void;

  /** Records one skip. Replaces any earlier skip of the same page. */
  skip: (sessionLocalId: string, entry: SkippedExercise) => void;

  /** Takes one back. A no-op for a page that was not skipped. */
  unskip: (sessionLocalId: string, exerciseKey: string) => void;
}

export const useSkippedExercisesStore = create<SkippedExercisesState>((set, get) => ({
  sessionLocalId: null,
  skips: NO_SKIPS,

  openSession: (sessionLocalId) => {
    if (get().sessionLocalId === sessionLocalId) return;
    set({ sessionLocalId, skips: NO_SKIPS });
  },

  hydrate: (sessionLocalId, restored) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    if (restored.length === 0) return;

    const next = new Map<string, SkippedExercise>();
    for (const entry of restored) next.set(entry.exerciseKey, entry);
    // The live copy wins — see the doc comment.
    for (const [key, entry] of state.skips) next.set(key, entry);
    set({ skips: next });
  },

  skip: (sessionLocalId, entry) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;

    const next = new Map(state.skips);
    next.set(entry.exerciseKey, entry);
    set({ skips: next });
  },

  unskip: (sessionLocalId, exerciseKey) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    if (!state.skips.has(exerciseKey)) return;

    const next = new Map(state.skips);
    next.delete(exerciseKey);
    set({ skips: next });
  },
}));

/** Selector — the skipped exercises. Stable identity between writes. */
export function selectSkips(state: SkippedExercisesState): ReadonlyMap<string, SkippedExercise> {
  return state.skips;
}
