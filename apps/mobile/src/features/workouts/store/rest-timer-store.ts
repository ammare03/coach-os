import { create } from 'zustand';

// `phase-09-workout-logger/rest-timer/01` — the rest period between two
// sets, and nothing else.
//
// §8.4's rule is one sentence: "Auto rest timer starts on set completion."
// There is no "start rest" control anywhere in the logger and there will
// not be one — confirming a set IS the trigger, so the only caller is
// `hooks/useLogSet.ts`, on its local write path (rule (g) there).
//
// Four decisions, in the order they matter:
//
// (a) **Zustand, not TanStack Query, not SQLite.** A rest period is UI
//     state that outlives one screen — it must survive a page turn to the
//     next exercise, and a client who backs out to the session list is
//     still resting (`code-conventions` §5's decision tree). It is not
//     server data and it is not a mutation: nothing about a rest period
//     is ever sent anywhere, so it has no business near the outbox. The
//     set that started it is durable the moment `logSet` resolves,
//     whatever this store does afterwards.
//
// (b) **The countdown is DERIVED from the clock, never accumulated.** Each
//     tick recomputes `target − (now − startedAt)` rather than subtracting
//     one from the last value. `components/SessionElapsed.tsx`'s header
//     makes the same argument for the elapsed clock and it applies harder
//     here: iOS and Android both throttle JS timers in the background, so
//     a decrementing counter is wrong by exactly however long the OS
//     stopped calling it — and a rest timer that says 40 seconds remain
//     when the rest ended two minutes ago is worse than no timer. Task 02
//     persists this anchor so it also survives the process being killed;
//     today it survives the timer being throttled, which is the common
//     case.
//
// (c) **A second set restarts the rest; it never stacks.** `startRest`
//     re-anchors and re-arms, so a client who logs two sets forty seconds
//     apart is resting from the second one. Nothing accumulates and there
//     is never more than one interval armed.
//
// (d) **Zero is a real target and is already over.** `target_rest_seconds`
//     is a bare `smallint` with no `CHECK` and its Zod bound is `min(0)`
//     (`packages/schemas/src/programs.ts`), so a coach can genuinely
//     prescribe no rest. Substituting the default there would show a
//     client 90 seconds their coach did not ask for. Absent — `null`, or
//     an ad-hoc session with no prescription at all — is the only case
//     that falls back.
//
// **What this task does NOT build**, so nobody looks for it here: there is
// no in-app rest-timer component (no task in this feature creates one, and
// it has not been through the design gate), no persistence across a cold
// start (task 02), no notification or Live Activity (task 03), and no
// haptic or sound at zero (task 04). What lands at zero today is
// `isRunning: false`.

/**
 * The rest a set gets when its exercise prescribes none.
 *
 * Ad-hoc sessions carry no `program_exercises` row at all, and a coach may
 * leave `target_rest_seconds` empty on one that does. Ninety seconds is the
 * plan's stated default and the middle of the range this product's
 * programs actually use.
 */
export const DEFAULT_REST_SECONDS = 90;

const TICK_MS = 1_000;
const SECOND_MS = 1_000;

/**
 * The rest this set earns, in seconds.
 *
 * `targetRestSeconds` is `program_exercises.target_rest_seconds` as the
 * live prescription resolves it (`hooks/useExerciseTarget.ts` →
 * `lib/prescription.ts`) — there is no second read path for it, and adding
 * one would let the target line and the rest timer disagree about the same
 * exercise.
 *
 * Absent falls back; zero does not — decision (d).
 */
export function resolveRestSeconds(targetRestSeconds: number | null | undefined): number {
  if (targetRestSeconds === null || targetRestSeconds === undefined) return DEFAULT_REST_SECONDS;
  // The column is a `smallint` and the schema floors it at 0, so neither
  // clamp can fire from real data. Cheap insurance against a payload that
  // reached the device from an older build.
  return Math.max(0, Math.floor(targetRestSeconds));
}

export interface RestTimerState {
  /** `false` both before the first set of a session and once a rest has run out. */
  isRunning: boolean;
  /** Whole seconds left, recomputed per tick — decision (b). `0` when idle. */
  remainingSeconds: number;
  /** What this rest was for, kept after it completes. `0` when idle. */
  targetSeconds: number;
  /**
   * When the rest began, as `Date.now()`. The anchor decision (b) derives
   * from, and the field task 02 persists. `null` when idle.
   */
  startedAtMs: number | null;
  /**
   * Starts — or restarts — the rest after a set.
   *
   * `targetRestSeconds` is the exercise's coach-set target, or `null` when
   * it has none. `nowMs` is injected only so the anchor is testable; the
   * app never passes it.
   */
  startRest: (targetRestSeconds: number | null, nowMs?: number) => void;
  /** Back to idle, with nothing armed. */
  stopRest: () => void;
  /**
   * Recomputes what is left at `nowMs` and ends the rest if it has run out.
   *
   * Public because the interval is not the only thing that will drive it:
   * task 02 ticks once on foreground, against a `nowMs` the timer has not
   * seen, which is exactly decision (b)'s point.
   */
  tick: (nowMs: number) => void;
}

const IDLE = {
  isRunning: false,
  remainingSeconds: 0,
  targetSeconds: 0,
  startedAtMs: null,
} as const;

// Module scope, like `lib/connectivity/store.ts`'s listener: there is one
// rest period in the app at a time, so there is one interval, and a second
// one would tick the same state twice.
let tickTimer: ReturnType<typeof setInterval> | null = null;

function disarm(): void {
  if (tickTimer === null) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

export const useRestTimerStore = create<RestTimerState>((set, get) => ({
  ...IDLE,

  startRest: (targetRestSeconds, nowMs) => {
    const targetSeconds = resolveRestSeconds(targetRestSeconds);
    // Decision (c) — whatever was armed belongs to the previous set.
    disarm();

    if (targetSeconds === 0) {
      // Decision (d). No interval: there is nothing to count.
      set({ isRunning: false, remainingSeconds: 0, targetSeconds: 0, startedAtMs: null });
      return;
    }

    set({
      isRunning: true,
      remainingSeconds: targetSeconds,
      targetSeconds,
      startedAtMs: nowMs ?? Date.now(),
    });

    tickTimer = setInterval(() => {
      get().tick(Date.now());
    }, TICK_MS);
  },

  stopRest: () => {
    disarm();
    set({ ...IDLE });
  },

  tick: (nowMs) => {
    const { isRunning, startedAtMs, targetSeconds, remainingSeconds } = get();
    if (!isRunning || startedAtMs === null) return;

    // Ceiling, not floor: a rest reads "1" until the last second has
    // actually elapsed, which is how a countdown counts.
    const remaining = Math.max(0, Math.ceil(targetSeconds - (nowMs - startedAtMs) / SECOND_MS));

    if (remaining === 0) {
      disarm();
      // `targetSeconds` and `startedAtMs` survive: a finished rest still
      // knows what it was and when it began, which is what task 04 fires
      // on and task 03 reconciles a notification against.
      set({ isRunning: false, remainingSeconds: 0 });
      return;
    }

    // Only on a whole-second change. Nothing renders this yet, and when
    // something does it must not re-render four times a second for a value
    // that changes once (`frontend-performance` §3).
    if (remaining !== remainingSeconds) set({ remainingSeconds: remaining });
  },
}));

/** Test-only teardown — disarms the interval and returns the store to idle. */
export function resetRestTimerForTests(): void {
  disarm();
  useRestTimerStore.setState({ ...IDLE });
}
