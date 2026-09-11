import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { api } from '../../../lib/trpc.ts';

// DB§14.5 mechanism 3's liveness half (`session-runtime/08` approach step
// 5). While the logger is open, the active device touches its claim every
// few minutes. That single fact is what makes the fifteen-minute staleness
// rule safe in *both* directions: a live device holds the session and cannot
// be interrupted mid-set, and a dead one releases it quickly enough that the
// client can pick up on another phone without waiting out the six-hour
// ceiling.
//
// Five rules, in the order they matter:
//
// (a) **It never blocks, never renders, and never fails loudly.** A
//     heartbeat is bookkeeping. The client is mid-set; a spinner, an alert,
//     or a thrown error over a claim they did not ask about would all be
//     worse than the bookkeeping being briefly wrong. Every failure path
//     here ends in a `console.warn` with a code and nothing else
//     (`observability-ops` §1).
//
// (b) **No network, no tick.** Offline is the logger's normal state, and a
//     tick that fires anyway just queues a rejected promise every interval.
//     `useConnectivity` is the app's one network-state source
//     (`lib/connectivity/useConnectivity.ts`); this hook adds no listener of
//     its own.
//
// (c) **It is deliberately NOT an outbox mutation.** A heartbeat replayed
//     from a queue an hour later is a lie about liveness — it would tell the
//     server a device was alive at a moment it had been dead since. Its
//     whole value is that it either lands now or does not happen. That is
//     also why losing one costs nothing: the next one is three minutes away,
//     and the staleness window is fifteen.
//
// (d) **Backgrounding stops it, and the tick is what enforces that — not
//     the platform.** An app in the background is not a client logging sets,
//     and a phone in a pocket holding a session for hours is exactly the
//     state the staleness rule exists to end. iOS suspends the timer on its
//     own; **Android does not**, so an interval left to run there would go
//     on asserting the claim from a pocket and the fifteen-minute rule would
//     never release the session to the client's other device. The gate is
//     therefore inside `tick`, where both platforms pass through it. The
//     first tick on return to the foreground is immediate, so a client who
//     checks a message mid-workout re-asserts the claim as soon as they are
//     back.
//
// (e) **Losing the claim does not stop the logger.** The outcome is
//     reported and otherwise ignored. Set logs are device-wins and merge by
//     their own keys (DB§14.3), so a client whose other phone took over
//     keeps logging into the same session rather than being thrown out of a
//     workout they are standing in the middle of. There is no merge UI and
//     there will not be one.

/**
 * How often a live device re-asserts its claim. Comfortably inside the
 * server's fifteen-minute staleness window — two ticks can be missed
 * entirely before a healthy device looks dead. The server throttles the
 * write itself (`apps/api/src/features/workouts/claim.ts` rule (e)), so a
 * shorter interval here would cost requests without touching the row.
 */
export const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1_000;

export interface UseSessionHeartbeatOptions {
  /**
   * The session's SERVER id, or `null`. `null` is the ordinary case for a
   * session started offline that the outbox has not yet flushed: there is
   * no row on the server to claim, so the hook idles until there is.
   */
  serverId: string | null;
  /**
   * Whether the session is actually being logged. A completed, paused, or
   * not-yet-started session holds no claim, and a device that keeps
   * heartbeating one it is not using is the drawer-phone case.
   */
  isActive: boolean;
}

/**
 * Mounts the heartbeat for one session. Renders nothing and returns nothing
 * — there is no state a caller could usefully read, and exposing one would
 * invite a re-render per tick on the screen with the tightest frame budget
 * in the product (`CLAUDE.md` §19).
 */
export function useSessionHeartbeat({ serverId, isActive }: UseSessionHeartbeatOptions): void {
  const { isConnected } = useConnectivity();
  const heartbeat = api.workouts.heartbeat.useMutation();

  // The mutation object is rebuilt every render; the interval effect below
  // must not re-subscribe because of that, or the interval restarts on every
  // render and effectively never fires.
  //
  // Refreshed in an effect rather than assigned during render: a render can
  // be discarded or replayed, so writing a ref from one is a side effect in
  // the wrong place (`react-hooks/refs`). Declared above the interval effect
  // so it has run by the time the first tick reads it.
  const sendRef = useRef(heartbeat.mutateAsync);

  useEffect(() => {
    sendRef.current = heartbeat.mutateAsync;
  });

  // Rule (d). A ref rather than state: this gates a side effect and must
  // never cost the logger a render — it is the screen with the tightest
  // frame budget in the product (`CLAUDE.md` §19). Seeded from the current
  // state rather than assumed active, for the session resumed by a
  // notification tap while the app is still settling.
  const isForegroundedRef = useRef(AppState.currentState !== 'background');

  useEffect(() => {
    if (serverId === null || !isActive || !isConnected) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || !isForegroundedRef.current) return;
      try {
        // No instant: the server times the tick off its own clock, because a
        // heartbeat's whole assertion is "alive now" and a caller-chosen
        // instant is exactly the part of that which cannot be trusted
        // (`packages/schemas/src/workouts.ts`).
        await sendRef.current({ workoutSessionId: serverId });
      } catch (error) {
        // Rule (a). A code and the shape of the failure, never the message
        // and never the session id's contents.
        console.warn('workouts.heartbeat_failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }
    };

    // Rule (d)'s "immediate on return", and also the claim a device that
    // started offline never got to take.
    void tick();
    const interval = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (state) => {
      // `inactive` is the transient iOS state — the app switcher, a call
      // coming in — and is not backgrounded. Treating it as such would drop
      // a tick every time a notification banner appeared.
      isForegroundedRef.current = state !== 'background';

      // Foregrounding re-asserts at once rather than waiting out the
      // remainder of an interval that elapsed while the app was asleep.
      if (state === 'active') void tick();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, [serverId, isActive, isConnected]);
}
