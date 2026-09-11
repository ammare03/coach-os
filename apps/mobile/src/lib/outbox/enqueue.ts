import { eq } from 'drizzle-orm';
import { parse as superjsonParse, stringify as superjsonStringify } from 'superjson';
import { uuidv7 } from 'uuidv7';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
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
// `reuseClientLocalId` is the one, narrow exception, added by
// `phase-09-workout-logger/set-entry/05` for correcting an already-logged
// row. It does not weaken the rule above, because the rule is about
// *regeneration*: the failure it prevents is a fresh key where an existing
// one belonged, which turns one set into one per attempt. Naming an existing
// key is the opposite operation — it is what makes the server's
// `ON CONFLICT (client_id, client_local_id)` an UPDATE rather than a second
// row (task 05 Risks), and there is no other way to express an edit. Three
// things keep the exception honest:
//
//   • It is **not** called `clientLocalId`. A stray `clientLocalId` property
//     is still ignored, and there is still no parameter a retry path could
//     fill with a fresh uuid by reflex. Opting in means typing a name that
//     says what it does.
//   • It is **validated**. A key that is not a uuid would fail
//     `logSetInput.clientLocalId` on every attempt until the row hit the
//     ceiling and surfaced as "couldn't sync"; throwing here names the real
//     bug at the call site instead.
//   • The re-send is **ordered behind** whatever already carries that key —
//     see `findLatestOutboxIdFor` below. Without that it would be a sibling,
//     and siblings flush concurrently (rule 4).
//
// Known future extension, deliberately NOT built here: DB§14.5 mechanism 1
// derives a *deterministic* `client_local_id` (uuidv5) for a scheduled
// session so two devices converge on one row. That derivation and the
// widening of this signature it needs belong to
// `phase-09-workout-logger/session-runtime/08-device-claim.md`, which owns
// the rule — not to a speculative optional parameter here that every other
// call site could then misuse.

// ─── Building a dependency chain (DB§14.2) ───────────────────────────────
//
// The pattern every feature follows, and the whole of it:
//
//   const session = await enqueueMutation({ procedure: 'workouts.startSession', payload });
//   // …persist session.outboxId alongside the draft, then for each set:
//   await enqueueMutation({ procedure: 'workouts.logSet', payload, dependsOn: session.outboxId });
//
// Four rules, each with a consequence worth knowing before you break it:
//
// 1. `dependsOn` is the parent's **`outboxId`**, never its `clientLocalId`.
//    The two arrive together in `EnqueuedMutation`, and passing the wrong one
//    would queue a row nothing could ever send — so it throws, below.
//
// 2. **Persist the parent's `outboxId` next to the draft it belongs to**
//    (for P09, on the `local_workout_sessions` row), not in Zustand. A client
//    force-quits mid-workout and comes back; sets logged after the restart
//    still need the session's id, and a chain broken at that seam sends sets
//    for a session the server has never heard of.
//
// 3. **Chain only what genuinely depends on the parent.** Ordering is not
//    free — a chain is the one thing that makes the flush loop serialise, and
//    an unrelated mutation hung off a session waits behind it for no reason.
//    Two sessions, or a session and a meal, are separate chains and flush
//    concurrently (`flush.ts`, `drainOutbox`).
//
// 4. Children of one parent are **siblings, not a queue**: three sets hanging
//    off one session all become claimable together and send concurrently.
//    That is correct — each is an independent upsert keyed on its own
//    `clientLocalId`. A feature that needs strict order *between* two writes
//    must chain the second to the first, not to their shared parent.
//
// Depth is not limited, and P09 uses that. `flush.ts`'s exclusion tests one
// level, and is transitively correct because a row only reaches `'done'` by
// being sent and is only sent once its own parent is `'done'` — so a
// grandchild cannot outrun a grandparent. That is not hypothetical:
// `session-runtime/07` chains the completion mutation to the session start,
// and `session-summary/03` chains the RPE/notes update to that completion,
// which is three levels in the ordinary path of finishing a workout.
// P13 chains nothing — `diary/02` states a meal has no parent and meals may
// sync in any order relative to each other.

export interface EnqueueMutationArgs<TPayload> {
  /** The tRPC path the flush loop will call, e.g. `'workouts.logSet'`. */
  procedure: string;
  /** The procedure's input, minus the `clientLocalId` this function supplies. */
  payload: TPayload;
  /** The `outbox.id` of a row that must sync first — a session before its sets (DB§14.2). */
  dependsOn?: string;
  /**
   * Re-send under an idempotency key that already exists, turning the
   * server's upsert into an UPDATE of that row rather than a second one.
   *
   * Only for correcting or withdrawing something already logged — pass the
   * key the original write returned (`set-entry/05`, `set-entry/06`). Never
   * pass a freshly generated value: that is the exact failure the absence of
   * a `clientLocalId` parameter exists to prevent (`offline-sync` §3).
   *
   * When a row carrying this key is still in the outbox, the new row is
   * chained behind it and any `dependsOn` given here is superseded — the
   * older row already sits behind the caller's intended parent, so ordering
   * is preserved transitively.
   */
  reuseClientLocalId?: string;
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

/** Any uuid version: DB§14.5 mechanism 1 derives some keys as uuidv5, not v7. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The newest outbox row already carrying `clientLocalId`, or null.
 *
 * Newest by `outbox.id`, not by `created_at`: every id here is a uuidv7
 * generated three lines below, so lexicographic order IS creation order —
 * and unlike `created_at`, two rows queued in the same millisecond still
 * compare. Resolved in JS rather than with `ORDER BY … LIMIT 1` so the
 * answer does not depend on SQLite's row order for the ties.
 */
function findLatestOutboxIdFor(db: LocalDb, clientLocalId: string): string | null {
  const rows = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(eq(outbox.clientLocalId, clientLocalId))
    .all();

  return rows.reduce<string | null>(
    (latest, row) => (latest === null || row.id > latest ? row.id : latest),
    null,
  );
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
  reuseClientLocalId,
}: EnqueueMutationArgs<TPayload>): Promise<EnqueuedMutation> {
  if (reuseClientLocalId !== undefined && !UUID_PATTERN.test(reuseClientLocalId)) {
    throw new Error(`enqueueMutation: reuseClientLocalId "${reuseClientLocalId}" is not a uuid`);
  }

  const clientLocalId = reuseClientLocalId ?? uuidv7();
  const outboxId = uuidv7();
  const now = Date.now();
  const db = await getLocalDb();

  // A re-send is never a sibling of the row it corrects. Two rows keyed the
  // same flushing concurrently means the original can land LAST and upsert
  // the pre-edit values back over the correction — a number the client never
  // entered, silently, on the coach's screen. Chaining is the mechanism
  // `depends_on` already exists for (DB§14.2), so use it rather than
  // inventing a second ordering rule.
  const supersedes =
    reuseClientLocalId === undefined ? null : findLatestOutboxIdFor(db, reuseClientLocalId);
  const parentId = supersedes ?? dependsOn;

  // The `depends_on` foreign key is declared in `db/schema/sync.ts` but SQLite
  // does not enforce one unless `PRAGMA foreign_keys = ON`, which this
  // database does not set. So the check is here, and it is not decorative: a
  // child pointing at a row that does not exist is never claimable, and
  // `failed-entries.ts` reads only rows at the attempt ceiling, so it never
  // surfaces in the "couldn't sync" banner either. Silently stranded work is
  // the worst outcome this subsystem has (`offline-sync` §4). Failing at the
  // call site instead turns it into an obvious bug in the feature that
  // mis-wired the chain.
  if (parentId !== undefined && parentId !== null) {
    const parent = db.select({ id: outbox.id }).from(outbox).where(eq(outbox.id, parentId)).get();
    if (!parent) {
      throw new Error(`enqueueMutation: dependsOn ${parentId} is not an outbox id`);
    }
  }

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
      dependsOn: parentId ?? null,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      status: 'queued',
    })
    .run();

  return { outboxId, clientLocalId };
}
