import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';
import { uuidv7 } from 'uuidv7';

import { getLocalDb } from '../../db/client.ts';
import { outbox } from '../../db/schema/sync.ts';

// DB§14.1's rule, made structural: every offline-capable mutation carries a
// `client_local_id` (UUIDv7) generated on device at the moment of the user's
// action and never regenerated on retry. This is the ONLY sanctioned way
// anything in the app writes to the `outbox` table — a feature that inserts
// its own row can reuse or regenerate an id, and a regenerated id turns one
// set into one set per retry attempt (`offline-sync` skill §3).
//
// The id is generated here rather than accepted from the caller, so there is
// no parameter anyone can pass a fresh value to on a second attempt.
// The `outbox/no-direct-outbox-write` lint rule
// (packages/config/eslint-rules) backs this up, failing any outbox write —
// table import or hand-written SQL — outside this folder.
//
// Known future extension, deliberately NOT built here: DB§14.5 mechanism 1
// derives a *deterministic* `client_local_id` (uuidv5) for a scheduled
// session so two devices converge on one row. That derivation and the
// widening of this signature it needs belong to
// `phase-09-workout-logger/session-runtime/08-device-claim.md`, which owns
// the rule — not to a speculative optional parameter here that every other
// call site could then misuse.

export interface EnqueueMutationArgs<TPayload> {
  /** The tRPC path the flush loop will call, e.g. `'workouts.logSet'`. */
  procedure: string;
  /** The procedure's input, minus the `clientLocalId` this function supplies. */
  payload: TPayload;
  /** The `outbox.id` of a row that must sync first — a session before its sets (DB§14.2). */
  dependsOn?: string;
}

export interface EnqueuedMutation {
  /**
   * The `outbox.id` — pass it as a later sibling's `dependsOn` (DB§14.2).
   * Named `outboxId` rather than `id` because this object carries two ids
   * with different jobs, and a bare `id` next to `clientLocalId` invites
   * exactly the mix-up that breaks idempotency.
   */
  outboxId: string;
  /** The idempotency key. Reuse it verbatim for the caller's own optimistic local row. */
  clientLocalId: string;
}

// superjson, not `JSON.stringify`: this string is handed straight back to the
// tRPC client at flush, and superjson is already that client's transformer
// (`lib/trpc-links.ts`, CLAUDE.md §3.2). A payload that captured `loggedAt`
// as a real `Date` at action time must still be a `Date` after an app
// restart — plain JSON silently degrades it to a string, which is the
// "everything timestamped at reconnect" failure in `offline-sync` §10 wearing
// a different hat.
export function serializeOutboxPayload(payload: unknown): string {
  return superjsonStringify(payload);
}

/** The matching reader for `outbox.payload_json`. Task 02's flush loop calls this, never `JSON.parse`. */
export function deserializeOutboxPayload(payloadJson: string): unknown {
  return superjsonParse(payloadJson);
}

/**
 * Queues one offline mutation and returns the two ids it created.
 *
 * The `clientLocalId` is generated exactly once, here, at call time. The
 * caller writes its own optimistic row to the local mirror using that same
 * value, so the local UI row and the outbox entry share one identity — and
 * that identity is what the server's `ON CONFLICT (owner, client_local_id)`
 * upsert keys on, however many times the flush replays it.
 *
 * Throws if the local write fails, rather than returning ids for a row that
 * was never stored — a caller that then renders an optimistic set would be
 * showing work nothing will ever sync.
 */
export async function enqueueMutation<TPayload>({
  procedure,
  payload,
  dependsOn,
}: EnqueueMutationArgs<TPayload>): Promise<EnqueuedMutation> {
  const clientLocalId = uuidv7();
  const outboxId = uuidv7();
  const now = Date.now();
  const db = await getLocalDb();

  // The typed Drizzle insert, not the raw `sql` the rest of `src/db` uses:
  // this is the one chokepoint every offline mutation passes through, so a
  // column rename in `db/schema/sync.ts` must fail at `tsc`, not silently at
  // runtime in a gym basement (`code-conventions` §3, "never hand-write a
  // type that already exists" — the same argument applies to the column
  // names). `next_attempt_at = now` makes the row eligible the instant the
  // flush loop next scans `outbox_ready`; backoff pushes it forward from
  // there (task 03). `attempts` and `status` restate their schema defaults
  // on purpose — the starting state is this task's acceptance criterion,
  // not something to infer from another file.
  db.insert(outbox)
    .values({
      id: outboxId,
      procedure,
      payloadJson: serializeOutboxPayload(payload),
      clientLocalId,
      dependsOn: dependsOn ?? null,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      status: 'queued',
    })
    .run();

  return { outboxId, clientLocalId };
}
