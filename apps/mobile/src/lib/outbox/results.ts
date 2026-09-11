// `phase-09-workout-logger/personal-records/03` — the one seam by which a
// server *response* escapes the flush loop.
//
// Everything the outbox sends is fire-and-forget by design: `flush.ts`
// awaits the send only to decide `done` versus `retry`, and the body comes
// back to a `void`. That is correct for almost every mutation — the device
// already holds the truth it queued, and `offline-sync` §5 makes the mirror
// device-wins precisely so a response has nothing to teach it.
//
// `workouts.logSet` is the exception, and exactly one field of it:
// `newPersonalRecords` is computed inside the server's write transaction
// (`apps/api/src/lib/pr-detection.ts`) against every other client's history,
// and the device cannot know it. Without a way out of the loop the record a
// client just set is invisible until their next prefetch.
//
// Three rules, and they are what keep this from becoming a general
// server-push channel:
//
// (a) **It carries the raw response, un-narrowed.** This module knows
//     nothing about sets, records, or workouts — narrowing belongs to the
//     feature that cares (`features/workouts/lib/pr-celebration.ts`), and a
//     typed payload here would make every future consumer's shape this
//     file's problem.
//
// (b) **Publishing can never fail a send.** The entry is already `done` by
//     the time a listener runs; a listener that throws must not turn a
//     delivered mutation into a retry. Every callback is isolated.
//
// (c) **There is no buffer and no replay.** A result published with nobody
//     listening is dropped, which is the wanted behaviour rather than a
//     limitation: a PR confirmation that arrives after the client has
//     finished their session is dropped, not deferred (design, "Logged
//     offline"). A queue here would resurrect it on the next mount.

/** One mutation the flush loop delivered, as it was sent and as it came back. */
export interface OutboxSendResult {
  /** `outbox.procedure` — a string, because that is what SQLite hands back. */
  procedure: string;
  /** `outbox.client_local_id`. Stable across every replay of one action. */
  clientLocalId: string;
  /** The input as `buildProcedureInput` assembled it, so a listener can read what was sent. */
  input: Record<string, unknown>;
  /** The procedure's return value. `unknown` — rule (a). */
  result: unknown;
}

export type OutboxResultListener = (sent: OutboxSendResult) => void;

const listeners = new Set<OutboxResultListener>();

/**
 * Registers a listener for every mutation the flush loop delivers.
 *
 * Returns its own unsubscribe. Registering twice with the same function
 * registers once — a `Set`, so a remount cannot double-deliver.
 */
export function subscribeOutboxResults(listener: OutboxResultListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Announces a delivered mutation. Rule (b): never throws, whatever a listener does. */
export function publishOutboxResult(sent: OutboxSendResult): void {
  for (const listener of [...listeners]) {
    try {
      listener(sent);
    } catch (error) {
      // Fixed message, ids and codes only (`observability-ops` §1). The
      // mutation itself landed; this is a bug in a listener, not a sync
      // failure, and it must not read like one.
      console.warn('outbox.result_listener_failed', {
        procedure: sent.procedure,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}

/** Test seam — mirrors `resetOutboxFlushStateForTests` in `flush.ts`. */
export function resetOutboxResultListenersForTests(): void {
  listeners.clear();
}
