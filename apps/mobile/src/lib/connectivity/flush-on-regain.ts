import { getErrorCode } from '../error-code.ts';
import { flushOutbox } from '../outbox/flush.ts';

import { ensureConnectivityTracking, useConnectivityStore } from './store.ts';

let unsubscribe: (() => void) | null = null;

/**
 * `CLAUDE.md` §11.3's flush trigger: work queued in a gym basement leaves the
 * device the moment the radio comes back, with nothing for the client to tap.
 *
 * Fires on the `false → true` edge only, never on "is currently online" —
 * that is true for the whole life of a healthy session, and reading the
 * current value instead of the transition would flush on every unrelated
 * store notification.
 *
 * It holds **no** concurrency guard. `flushOutbox` is single-flight
 * (`outbox/02`), so a regain landing on top of another trigger — the app
 * foreground pass `prefetch/03` adds — joins the running flush. A guard here
 * would instead drop the regain, which is the one trigger that knows the
 * network state actually changed.
 *
 * Idempotent, and called once at app start (`app/_layout.tsx`) rather than
 * from a component: this subscriber has to outlive every screen.
 */
export function ensureFlushOnRegain(): void {
  if (unsubscribe) return;

  // Registers the single `expo-network` listener if nothing has yet, so the
  // trigger works before any component has mounted `useConnectivity`.
  ensureConnectivityTracking();

  unsubscribe = useConnectivityStore.subscribe((state, previous) => {
    if (!state.isConnected || previous.isConnected) return;

    void flushOutbox().catch((error: unknown) => {
      // Fixed message, code only — never the error's own text
      // (`observability-ops` §1). Not a crash and not silent: every claimed
      // row is left retryable, and the next regain or foreground tries again.
      console.warn('connectivity.flush_on_regain_failed', {
        errorCode: getErrorCode(error) ?? 'UNEXPECTED',
      });
    });
  });
}

/** Test-only teardown — mirrors `resetConnectivityForTests`. */
export function resetFlushOnRegainForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
}
