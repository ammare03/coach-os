import { create } from 'zustand';

// `phase-09-workout-logger/session-modifications/02` — which pager slots the
// client swapped in the session that is open, and for what.
//
// Five decisions, in the order they matter:
//
// (a) **Keyed on `ExercisePage.key` (`program_exercises.id`), never on
//     `exerciseId`.** The same exercise can appear twice in one day — a
//     back-off block, or both halves of a superset drawn from one movement —
//     and swapping one must not swap the other. The same key
//     `store/skipped-exercises-store.ts` decision (c) chose, for the same
//     reason.
//
// (b) **The substitution names the original as well as the substitute.**
//     Not derivable later: the swap's only durable consequence is a line in
//     `set_logs.notes` naming what was replaced (task 02 Approach step 6),
//     and by the time that line is composed the page is showing the
//     substitute. Both names are copied at the tap rather than looked up,
//     because an exercise cache miss renames a page and the note has to say
//     what the client actually saw.
//
// (c) **Session-scoped, and the session is named on every write.**
//     {@link SubstitutedExercisesState.openSession} wipes when the id
//     changes and `substitute`/`revert` refuse a session this store is not
//     open on — `skipped-exercises-store.ts` decision (d)'s shape, because
//     a write racing a page turn between two sessions would otherwise
//     rewrite the wrong workout. **This is also the whole of "this session
//     only"**: nothing here reaches `program_exercises`, so next week's
//     session opens exactly as the coach wrote it.
//
// (d) **The store is the live copy; durability is the hook's.**
//     `hooks/useSwapExercise.ts` mirrors this into `meta` so a swap survives
//     a force-quit mid-session, and hydrates back through
//     {@link SubstitutedExercisesState.hydrate}. Nothing here touches
//     SQLite: the pager reads this synchronously on the same tick as the tap.
//
// (e) **No validation of the substitute against `alternatives` lives here.**
//     `components/SwapExerciseSheet.tsx` renders nothing but that array, so
//     there is no path to this store carrying an id the coach did not
//     sanction. A second check here would be a second opinion about the
//     picker's contents rather than a guard — the real guard is that the
//     picker has no search, which is task 02's named risk and is enforced
//     where it can be seen.

/** One pager slot the client swapped, and what they swapped it for. */
export interface ExerciseSubstitution {
  /** `ExercisePage.key` — `program_exercises.id`. Decision (a). */
  exerciseKey: string;
  /** The coach-authored `exercises.id` this slot was programmed with. */
  originalExerciseId: string;
  /** Its library name as the page showed it at the moment of the swap — decision (b). */
  originalName: string;
  /** The `exercises.id` from that block's `alternatives` the client chose. */
  substituteExerciseId: string;
  substituteName: string;
  /** Epoch ms, captured at the tap — never at persistence time. */
  atMs: number;
}

const NO_SUBSTITUTIONS: ReadonlyMap<string, ExerciseSubstitution> = new Map();

export interface SubstitutedExercisesState {
  /** The session every entry below belongs to. `null` before the first open. */
  sessionLocalId: string | null;
  /** By `ExercisePage.key`. Replaced wholesale, never mutated. */
  substitutions: ReadonlyMap<string, ExerciseSubstitution>;

  /** Points the store at a session, wiping when it is a different one — decision (c). */
  openSession: (sessionLocalId: string) => void;

  /**
   * Seeds what a previous process recorded (decision (d)).
   *
   * Ignored for a session this store is not open on, and **it never clobbers
   * a substitution already in memory**: the restore can land after the client
   * has already swapped something in this process, and the live copy is the
   * newer of the two.
   */
  hydrate: (sessionLocalId: string, restored: readonly ExerciseSubstitution[]) => void;

  /** Records one swap. Replaces any earlier swap of the same slot. */
  substitute: (sessionLocalId: string, entry: ExerciseSubstitution) => void;

  /** Puts the coach's own exercise back. A no-op for a slot that was not swapped. */
  revert: (sessionLocalId: string, exerciseKey: string) => void;
}

export const useSubstitutedExercisesStore = create<SubstitutedExercisesState>((set, get) => ({
  sessionLocalId: null,
  substitutions: NO_SUBSTITUTIONS,

  openSession: (sessionLocalId) => {
    if (get().sessionLocalId === sessionLocalId) return;
    set({ sessionLocalId, substitutions: NO_SUBSTITUTIONS });
  },

  hydrate: (sessionLocalId, restored) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    if (restored.length === 0) return;

    const next = new Map<string, ExerciseSubstitution>();
    for (const entry of restored) next.set(entry.exerciseKey, entry);
    // The live copy wins — see the doc comment.
    for (const [key, entry] of state.substitutions) next.set(key, entry);
    set({ substitutions: next });
  },

  substitute: (sessionLocalId, entry) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;

    const next = new Map(state.substitutions);
    next.set(entry.exerciseKey, entry);
    set({ substitutions: next });
  },

  revert: (sessionLocalId, exerciseKey) => {
    const state = get();
    if (state.sessionLocalId !== sessionLocalId) return;
    if (!state.substitutions.has(exerciseKey)) return;

    const next = new Map(state.substitutions);
    next.delete(exerciseKey);
    set({ substitutions: next });
  },
}));

/** Selector — the session's substitutions. Stable identity between writes. */
export function selectSubstitutions(
  state: SubstitutedExercisesState,
): ReadonlyMap<string, ExerciseSubstitution> {
  return state.substitutions;
}
