import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { AppState } from 'react-native';

// §8.4's "screen stays awake during an active session" (`session-runtime/05`).
// A client resting between sets, hands chalked, watching the screen lock
// itself is the frustration this exists to remove.
//
// Four rules, in the order they matter:
//
// (a) **Only while the session is actually being logged.** Keep-awake is a
//     battery cost by definition, which is why `CLAUDE.md` §19 budgets this
//     screen specifically at under 25% of a 4000mAh battery over 90 minutes.
//     A completed or paused session opened for review is not a workout, and
//     `frontend-performance` §8 scopes the lock to an active session rather
//     than to the route.
//
// (b) **Backgrounding releases it — and we do that ourselves rather than
//     trusting the platform.** This is task 08's lesson in reverse: its
//     heartbeat kept ticking from a pocketed Android because iOS's timer
//     suspension had made the bug invisible. Both platforms do scope their
//     own wake locks to the foreground, so this release is belt-and-braces —
//     but "the OS probably handles it" is exactly the assumption that cost a
//     task, and a lock is cheap to release explicitly.
//
// (c) **Every exit path releases, because there is only one.** Unmount is the
//     sole release, so the exit button, a deep link away, a back gesture, and
//     a completed session all travel through it — none is special-cased, so
//     none can be missed. An app kill needs no handling at all: the wake lock
//     belongs to the process and dies with it.
//
// (d) **Activation is async, so order has to be enforced.** A fast
//     open-then-leave can resolve the activate *after* the cleanup that was
//     meant to undo it, leaving a lock nothing will ever release — the
//     battery regression this task's Risks section names. `expo-keep-awake`'s
//     own `useKeepAwake` has exactly that gap, which is the reason this hook
//     uses the imperative API and serialises it below.

/**
 * The lock is reference-counted by tag, and a release only drops the tag it
 * names. Taking `expo-keep-awake`'s default tag would mean any future holder
 * — a live session, a video — could release the logger's lock mid-set, and be
 * released by it.
 */
export const SESSION_KEEP_AWAKE_TAG = 'coachos.workout-session';

/**
 * One chain for the whole app. The tag names a single OS-level resource, so
 * two callers' activate and release must not interleave — rule (d). Failures
 * are swallowed into the chain so one rejected call can never strand the
 * release queued behind it.
 */
let pending: Promise<void> = Promise.resolve();

function enqueue(op: 'activate' | 'release'): void {
  pending = pending
    .then(() =>
      op === 'activate'
        ? activateKeepAwakeAsync(SESSION_KEEP_AWAKE_TAG)
        : deactivateKeepAwake(SESSION_KEEP_AWAKE_TAG),
    )
    .catch((error: unknown) => {
      // Rule (a)'s corollary: keep-awake is a comfort, not the workout. A
      // code and the shape of the failure, never a surfaced error mid-set
      // (`observability-ops` §1).
      console.warn('workouts.keep_awake_failed', {
        op,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    });
}

export interface UseSessionKeepAwakeOptions {
  /**
   * Whether the session is actually being logged. Read off the same state the
   * logger renders, so a session still loading, already completed, or not
   * found holds nothing — rule (a).
   */
  isActive: boolean;
}

/**
 * Holds the screen awake for one session. Renders nothing and returns nothing:
 * there is no state a caller could act on, and exposing one would cost a
 * render on the screen with the tightest frame budget in the product
 * (`CLAUDE.md` §19).
 */
export function useSessionKeepAwake({ isActive }: UseSessionKeepAwakeOptions): void {
  useEffect(() => {
    if (!isActive) return;

    // Seeded from the current state rather than assumed foregrounded, for the
    // session resumed by a notification tap while the app is still settling.
    if (AppState.currentState !== 'background') enqueue('activate');

    const subscription = AppState.addEventListener('change', (state) => {
      // `inactive` is the transient iOS state — the app switcher, an incoming
      // call, a notification banner — and is not backgrounded. Releasing
      // there would let the screen dim the moment a banner appeared mid-set.
      if (state === 'background') enqueue('release');
      else if (state === 'active') enqueue('activate');
    });

    return () => {
      subscription.remove();
      enqueue('release');
    };
  }, [isActive]);
}
