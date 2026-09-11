import type { ExerciseTarget } from '@coachos/utils';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

// `phase-09-workout-logger/session-modifications/04` — the one entry point
// a live coach's adjustment reaches the running logger through.
//
// §8.9's Live Workout Mode has the coach joined to a client's in-progress
// session, adjusting the remaining sets, "and the client's logger updates
// instantly". The transport that carries that adjustment is P14/P19 and
// does not exist. What only the logger can supply — and what this file is —
// is the local-state door it will knock on.
//
// ┌───────────────────────────────────────────────────────────────────┐
// │  ⚠  THIS FUNCTION PERFORMS NO AUTHORIZATION CHECK. THAT IS        │
// │     DELIBERATE, AND IT IS THE CALLER'S PROBLEM, NOT AN OMISSION.  │
// │                                                                   │
// │  `applyLiveTargetOverride` does not verify who sent the           │
// │  adjustment, that a live session is running, that the sender is   │
// │  this client's coach, or that the message is authentic in any     │
// │  way. There is no server round trip on this path and no           │
// │  `ownsResource` guard anywhere behind it. It rewrites what a      │
// │  client believes their coach prescribed, on their device, for     │
// │  anyone who calls it.                                             │
// │                                                                   │
// │  **If you are implementing `phase-19-live-sessions/               │
// │  live-workout-mode/`: verifying authenticity is YOUR job and      │
// │  nobody else's.** Before invoking this, you must have             │
// │  established — through LiveKit's room-scoped, time-limited        │
// │  tokens (`CLAUDE.md` §8.9, §13) or whatever P14's socket          │
// │  settles on — that the message genuinely originated from the      │
// │  coach actually hosting this specific live session with this      │
// │  specific client. This function trusts that completely and adds   │
// │  none of its own.                                                 │
// │                                                                   │
// │  **Call it from exactly one place: a fully-verified live-session  │
// │  message handler.** Anywhere else — a deep link, a push payload,  │
// │  a notification handler, a debug menu that ships — turns it into  │
// │  a function that lets any caller silently change the weight a     │
// │  client is about to put on a bar. It is the only function in the  │
// │  client codebase built without an ownership check, and that       │
// │  must never quietly change.                                       │
// └───────────────────────────────────────────────────────────────────┘
//
// Four decisions, in the order they matter:
//
// (a) **Additive, never a replacement target.** The prescription is still
//     resolved live, every render, by `hooks/useExerciseTarget.ts` →
//     `lib/prescription.ts` — that file's header explains why a cache
//     there silently breaks `phase-07-.../assignment/04`'s bulk edit. This
//     is one more layer checked AFTER that resolution, so "is there a live
//     override right now" is a cheap map lookup and never a second,
//     parallel target-resolution system. {@link mergeLiveOverride} is the
//     only place the two meet.
//
// (b) **Zustand, in memory, never the outbox.** A live adjustment can only
//     happen while the client is connected to their coach, so there is no
//     offline case to design for — the one thing in this phase that has
//     none. It has no server-bound counterpart either: it changes THIS
//     session's targets and never `program_exercises`, so there is nothing
//     to sync and `offline-sync` §9's checklist does not apply. The set
//     the client then logs against it is durable by its own path.
//
// (c) **Session-scoped, exactly like `store/pr-celebration-store.ts`.** An
//     adjustment is "for the remainder of this session" and must not be
//     alive in the next one. {@link openLiveOverrideSession} wipes on a
//     change of session, and {@link selectLiveOverride} ALSO refuses to
//     report an override to a reader naming a different session — the
//     guard is in the read as well as the wipe, so a stale target cannot
//     render for even one frame while the effect that re-scopes the store
//     is still pending.
//
// (d) **Keyed on `exerciseId`, which is the contract's word.** A day may
//     legitimately carry the same exercise twice (heavy bench early, a
//     back-off later), and an override then applies to both blocks. That
//     is a stated property of this surface, not a bug to discover later:
//     P19's coach picks an exercise, not a slot. If a live UI ever needs
//     per-slot precision, the key becomes `programExerciseId` in one place
//     — here — rather than a second parameter added speculatively now.

/**
 * The fields a live adjustment may change: any subset of a prescription.
 *
 * Inferred from `ExerciseTarget` rather than re-declared, so a schema
 * change fails typecheck here (`code-conventions` §3). Sets, reps, RPE,
 * RIR, %1RM, weight, tempo, and rest are all reachable — the task names
 * "sets/reps/RPE/rest/weight" and this is that list without the arbitrary
 * omissions.
 */
export type LiveTargetOverride = Partial<ExerciseTarget>;

export interface LiveTargetOverrideState {
  /** The session every entry below belongs to — decision (c). */
  sessionLocalId: string | null;
  /** `exerciseId` → the accumulated adjustment for it. */
  overrides: Readonly<Record<string, LiveTargetOverride>>;

  /** Points the store at a session, wiping if it is a different one. */
  openSession: (sessionLocalId: string) => void;
  /** Merges an adjustment onto whatever this exercise already carries. */
  apply: (exerciseId: string, override: LiveTargetOverride) => void;
}

const NO_OVERRIDES: Readonly<Record<string, LiveTargetOverride>> = Object.freeze({});

export const useLiveTargetOverrideStore = create<LiveTargetOverrideState>((set, get) => ({
  sessionLocalId: null,
  overrides: NO_OVERRIDES,

  openSession: (sessionLocalId) => {
    if (get().sessionLocalId === sessionLocalId) return;
    set({ sessionLocalId, overrides: NO_OVERRIDES });
  },

  apply: (exerciseId, override) => {
    // An adjustment that names no field is not an adjustment. Storing it
    // would mark the target live-overridden and print the treatment over
    // numbers nobody changed.
    if (Object.keys(override).length === 0) return;

    const current = get().overrides;
    set({
      overrides: {
        ...current,
        // Accumulates: a coach who drops the sets and then the RPE has made
        // one adjustment in two messages, not two that overwrite.
        [exerciseId]: { ...current[exerciseId], ...override },
      },
    });
  },
}));

/**
 * **The entire contract `phase-19-live-sessions` builds against.**
 *
 * Merges `override` onto this exercise's target for the remainder of the
 * session, synchronously. The caller supplies an `exerciseId` and a partial
 * set of new values; everything else — the merge, the local write, the
 * visual distinction on the target line — happens here.
 *
 * Standalone by design: it is a plain function, not a hook, so the message
 * handler that eventually calls it needs no React tree, no context, and no
 * knowledge of which screen is mounted.
 *
 * **Read the no-authorization box at the top of this file before calling
 * this.** It is not a formality; it is the precondition.
 */
export function applyLiveTargetOverride(exerciseId: string, override: LiveTargetOverride): void {
  useLiveTargetOverrideStore.getState().apply(exerciseId, override);
}

/** Scopes the store to a session — decision (c). Idempotent. */
export function openLiveOverrideSession(sessionLocalId: string): void {
  useLiveTargetOverrideStore.getState().openSession(sessionLocalId);
}

/** Selector — this exercise's adjustment, or `null` for a reader on another session. */
export function selectLiveOverride(
  state: LiveTargetOverrideState,
  exerciseId: string,
  sessionLocalId: string,
): LiveTargetOverride | null {
  if (state.sessionLocalId !== sessionLocalId) return null;
  return state.overrides[exerciseId] ?? null;
}

/**
 * The prescription with the live adjustment laid over it — decision (a).
 *
 * Returns the same object it was handed when there is nothing to apply, so
 * a consumer's memo does not invalidate on every render of an unadjusted
 * exercise.
 *
 * **A block with no prescription stays `null`.** An override is a layer on
 * a coach-authored target and there is nothing under it for an ad-hoc block
 * or an exercise inserted mid-session — `ExerciseTarget.targetSets` is
 * required, and inventing one would put a set count on screen that no coach
 * asked for. P19 should treat "adjust an exercise the client has no
 * prescription for" as out of this surface's scope.
 */
export function mergeLiveOverride(
  target: ExerciseTarget | null,
  override: LiveTargetOverride | null,
): ExerciseTarget | null {
  if (target === null || override === null) return target;
  return { ...target, ...override };
}

/** Whether {@link mergeLiveOverride} actually changed anything — drives the treatment. */
export function isLiveOverridden(
  target: ExerciseTarget | null,
  override: LiveTargetOverride | null,
): boolean {
  return target !== null && override !== null;
}

/**
 * Subscribes to this exercise's live adjustment and keeps the store scoped
 * to the session being logged.
 *
 * A component calls this itself rather than being handed the override by
 * its screen, exactly as `components/RestTimerBar.tsx` reads the rest store
 * — the logger does not wire anything up, and P19 does not have to find a
 * screen to wire.
 */
export function useLiveTargetOverride(
  exerciseId: string,
  sessionLocalId: string,
): LiveTargetOverride | null {
  useEffect(() => {
    openLiveOverrideSession(sessionLocalId);
  }, [sessionLocalId]);

  return useLiveTargetOverrideStore((state) =>
    selectLiveOverride(state, exerciseId, sessionLocalId),
  );
}

/** What an exercise's target is, and what the coach originally authored. */
export interface LiveTarget {
  /** What the client is being asked to do right now — the merged value. */
  target: ExerciseTarget | null;
  /** What the coach programmed, before any live adjustment. */
  programTarget: ExerciseTarget | null;
  /** Whether the two differ because a coach changed this one, live. */
  isLiveOverridden: boolean;
}

/**
 * `hooks/useExerciseTarget.ts`'s resolved prescription with this task's
 * layer on top — decision (a).
 *
 * Deliberately a second hook rather than a change to `useExerciseTarget`'s
 * return shape. Two reasons: that file's whole contract is "the
 * prescription is read through live, every render", and keeping the
 * authored value beside the merged one is what lets `TargetLine` show the
 * client what their coach changed it FROM.
 */
export function useLiveTarget(
  programTarget: ExerciseTarget | null,
  exerciseId: string,
  sessionLocalId: string,
): LiveTarget {
  const override = useLiveTargetOverride(exerciseId, sessionLocalId);

  const target = useMemo(
    () => mergeLiveOverride(programTarget, override),
    [programTarget, override],
  );

  return { target, programTarget, isLiveOverridden: isLiveOverridden(programTarget, override) };
}

/** Test seam — mirrors `resetRestTimerForTests` in `store/rest-timer-store.ts`. */
export function resetLiveTargetOverridesForTests(): void {
  useLiveTargetOverrideStore.setState({ sessionLocalId: null, overrides: NO_OVERRIDES });
}

/**
 * The name the dev-only handle below is published under.
 *
 * Exported so the one thing that may reference it — a test, or a debugger
 * expression a human types — does not have to spell it twice.
 */
export const LIVE_TARGET_OVERRIDE_DEBUG_KEY = '__coachosApplyLiveTargetOverride';

// **The stub caller this task's `Verification` step asks for**, since the
// real one (P19's live-session message handler) does not exist yet.
//
// With a session open in the logger, from a debugger console:
//
//   __coachosApplyLiveTargetOverride('<exerciseId>', { targetSets: 3, targetRpe: 7 })
//
// and the target line changes in the same frame, with the live treatment on
// it. `exerciseId` is `ExercisePage.exerciseId` — decision (d).
//
// **`__DEV__` only, and that is load-bearing rather than tidy.** A global
// that rewrites what a client believes their coach prescribed is precisely
// the unguarded caller the module header forbids; Metro strips this branch
// from a release bundle, so it cannot become one.
if (__DEV__) {
  (globalThis as unknown as Record<string, unknown>)[LIVE_TARGET_OVERRIDE_DEBUG_KEY] =
    applyLiveTargetOverride;
}
