import { AppState, type NativeEventSubscription } from 'react-native';
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
// `rest-timer/02` adds three more, all of them about the rest a client
// cannot see — the phone is locked, or the process is gone:
//
// (e) **A rest belongs to a session.** Decision (b)'s anchor is durable
//     from task 02 on (`../lib/rest-timer-persistence.ts` writes it to
//     `meta`), and a durable rest that names nothing would come back on
//     the next cold start whatever had happened to the workout in between —
//     finished, abandoned, or replaced by a different session entirely.
//     `sessionLocalId` is what {@link selectRestAnchor} scopes the stored
//     copy to and what the restore validates against
//     `local_workout_sessions.status`. A rest started without one is still
//     a perfectly good in-memory rest; it simply is not persisted, because
//     nothing on the other side could decide whether it was still true.
//
// (f) **A restored rest is reconciled, never restarted.** {@link
//     RestTimerState.resumeRest} takes the stored anchor as it is and
//     immediately ticks it against the real clock, so a rest that ran out
//     while the process was dead lands in the finished state — the same
//     one the interval would have produced — rather than handing the
//     client 90 fresh seconds they never earned. This is decision (b)
//     applied to a gap the interval did not merely miss but was not alive
//     for.
//
// (g) **The first foreground recomputes, without waiting for a tick.**
//     {@link ensureRestTimerForegroundSync} registers one `AppState`
//     listener, the same module-scope-and-idempotent shape
//     `lib/connectivity/store.ts` uses, and ticks against a `Date.now()`
//     the interval never saw. iOS suspends JS outright while the screen is
//     locked, so the interval's next fire is whenever the OS decides —
//     which is after the client has already read the screen. The listener
//     does not disarm on background: what the timer should do while the
//     app is asleep is task 04's question, and taking the interval away
//     here would answer it early.
//
// **What this task does NOT build**, so nobody looks for it here: there is
// no in-app rest-timer component (no task in this feature creates one, and
// it has not been through the design gate), no notification or Live
// Activity (task 03), and no haptic or sound at zero (task 04). What lands
// at zero today is `isRunning: false` — including the zero that happened
// while the app was dead, which the restore reports as such rather than
// hiding (`../lib/rest-timer-persistence.ts`'s `RestRestoration`).

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

/**
 * Everything a cold start needs to rebuild a rest, and nothing else —
 * decision (e). What `../lib/rest-timer-persistence.ts` stores, and the
 * argument {@link RestTimerState.resumeRest} takes back.
 */
export interface RestAnchor {
  /** `local_workout_sessions.client_local_id` — what the restore re-validates against. */
  sessionLocalId: string;
  /** `Date.now()` at the confirming tap. */
  startedAtMs: number;
  /** The rest this set earned, already resolved through {@link resolveRestSeconds}. */
  targetSeconds: number;
}

export interface StartRestOptions {
  /**
   * The session the set was logged into — decision (e). Omitted, the rest
   * runs normally and is simply not persisted.
   */
  sessionLocalId?: string | undefined;
  /** Injected only so the anchor is testable; the app never passes it. */
  nowMs?: number | undefined;
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
   * Which session's rest this is — decision (e). `null` when idle, and for
   * a rest a caller started without naming one.
   */
  sessionLocalId: string | null;
  /**
   * Starts — or restarts — the rest after a set.
   *
   * `targetRestSeconds` is the exercise's coach-set target, or `null` when
   * it has none.
   */
  startRest: (targetRestSeconds: number | null, options?: StartRestOptions) => void;
  /**
   * Re-anchors the timer to a rest read back off disk and reconciles it
   * against `nowMs` in the same call — decision (f). An anchor whose rest
   * has already run out lands finished, with its target and start intact.
   */
  resumeRest: (anchor: RestAnchor, nowMs: number) => void;
  /** Back to idle, with nothing armed. */
  stopRest: () => void;
  /**
   * Ends the rest if it belongs to `sessionLocalId`, and does nothing at
   * all otherwise.
   *
   * Finishing a workout ends its rest: the set that started it is the last
   * one, and nothing downstream — a notification, an alert at zero — should
   * fire for a session the client has already walked away from. Scoped
   * rather than unconditional so completing one session cannot cancel a
   * rest another one is legitimately running.
   */
  stopRestForSession: (sessionLocalId: string) => void;
  /**
   * Recomputes what is left at `nowMs` and ends the rest if it has run out.
   *
   * Public because the interval is not the only thing that drives it:
   * {@link ensureRestTimerForegroundSync} ticks once on foreground against
   * a `nowMs` the timer has not seen, which is exactly decision (b)'s point.
   */
  tick: (nowMs: number) => void;
}

/**
 * The rest worth storing, or `null` — decision (e)'s invariant in one
 * place: **a stored anchor exists if and only if a rest is running for a
 * named session.** That is what lets the restore read a row's mere
 * existence as "a rest was in flight when this process died" rather than
 * having to date it.
 */
export function selectRestAnchor(state: RestTimerState): RestAnchor | null {
  if (!state.isRunning || state.startedAtMs === null || state.sessionLocalId === null) return null;
  return {
    sessionLocalId: state.sessionLocalId,
    startedAtMs: state.startedAtMs,
    targetSeconds: state.targetSeconds,
  };
}

const IDLE = {
  isRunning: false,
  remainingSeconds: 0,
  targetSeconds: 0,
  startedAtMs: null,
  sessionLocalId: null,
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

  startRest: (targetRestSeconds, options) => {
    const targetSeconds = resolveRestSeconds(targetRestSeconds);
    // Decision (c) — whatever was armed belongs to the previous set.
    disarm();

    if (targetSeconds === 0) {
      // Decision (d). No interval: there is nothing to count.
      set({ ...IDLE });
      return;
    }

    set({
      isRunning: true,
      remainingSeconds: targetSeconds,
      targetSeconds,
      startedAtMs: options?.nowMs ?? Date.now(),
      sessionLocalId: options?.sessionLocalId ?? null,
    });

    arm(get);
  },

  resumeRest: (anchor, nowMs) => {
    disarm();
    const targetSeconds = resolveRestSeconds(anchor.targetSeconds);
    // A device whose clock moved backwards between the two launches. The
    // rest is still one the client is taking, so it starts now rather than
    // reading longer than the coach prescribed — the mirror of
    // `lib/session-recovery.ts`'s signed-age rule, which keeps a
    // future-dated session resumable for the same reason.
    const startedAtMs = Math.min(anchor.startedAtMs, nowMs);

    set({
      isRunning: true,
      remainingSeconds: targetSeconds,
      targetSeconds,
      startedAtMs,
      sessionLocalId: anchor.sessionLocalId,
    });
    arm(get);

    // Decision (f). Immediately, in the same call: between the `set` above
    // and this, a rest that is long over is momentarily readable as full.
    // Nothing renders this yet, and by the time something does, the
    // intermediate value must never reach it.
    get().tick(nowMs);
  },

  stopRest: () => {
    disarm();
    set({ ...IDLE });
  },

  stopRestForSession: (sessionLocalId) => {
    if (get().sessionLocalId !== sessionLocalId) return;
    get().stopRest();
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

function arm(get: () => RestTimerState): void {
  tickTimer = setInterval(() => {
    get().tick(Date.now());
  }, TICK_MS);
}

// Decision (g). One listener for the whole app, for the same reason there is
// one interval — a second one would tick the same state twice.
let appStateSubscription: NativeEventSubscription | null = null;

/**
 * Registers the one `AppState` listener the rest timer has, and never a
 * second one however many times it is called — decision (g). There is no
 * matching stop: the listener lives as long as the app does, exactly as
 * `lib/connectivity/store.ts`'s does.
 *
 * `inactive` is deliberately not handled. It is the transient iOS state —
 * the app switcher, an incoming call, a notification banner — and nothing
 * about the rest changes there that the next `active` will not recompute.
 */
export function ensureRestTimerForegroundSync(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    const { isRunning, tick } = useRestTimerStore.getState();
    if (!isRunning) return;
    tick(Date.now());
  });
}

/** Test-only teardown — disarms the interval and the listener, and returns the store to idle. */
export function resetRestTimerForTests(): void {
  disarm();
  appStateSubscription?.remove();
  appStateSubscription = null;
  useRestTimerStore.setState({ ...IDLE });
}
