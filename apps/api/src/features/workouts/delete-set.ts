import { recomputeSessionVolume, schema, type DbClient } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';

import type { RecomputeVolume } from './log-set.ts';

// `workouts.deleteSet` — the server half of
// `phase-09-workout-logger/set-entry/06`, and the procedure
// `apps/mobile/src/features/workouts/hooks/useDeleteSet.ts` already enqueues.
//
// The device defers this behind a five-second undo window and enqueues
// nothing until that window closes untouched, so every call that arrives
// here is a withdrawal the client has already seen happen and already
// declined to reverse. That shapes all five decisions below: this
// procedure's job is to agree with a decision already made on a device,
// not to re-adjudicate it.
//
// (a) **A soft delete, never a row removal.** `set_logs.deleted_at` exists
//     for this and `set_logs_client_exercise` is already PARTIAL on
//     `deleted_at IS NULL` (DB§5.2), so the "last time you did this
//     exercise" lookup skips a withdrawn set without a second predicate and
//     without touching the index. No migration was needed for this task;
//     the schema was built expecting it. A hard DELETE would also take the
//     row out from under `personal_records.set_log_id`, which references it.
//
// (b) **The session is named by its `client_local_id`, not a server id, and
//     therefore this procedure carries no `ownsResource`** — `./log-set.ts`
//     decision (b) and `./complete.ts` decision (b), verbatim and for their
//     reason: an ad-hoc session started offline has no `workout_sessions.id`
//     for the device to send, and a set logged in a basement must be
//     withdrawable in the same basement.
//
//     The ownership check does not disappear; it moves from the middleware
//     into a predicate neither statement can be run without. The SELECT is
//     pinned to `ctx.user.clientProfileId` and so is the UPDATE, both from
//     the context and never from the wire, so a key belonging to another
//     client resolves to nothing under either. `sessionClientLocalId` and
//     `clientLocalId` are both already registered in
//     `../../trpc/authz/resource-fields.ts`'s `NON_RESOURCE_ID_FIELDS` with
//     written reasons, so the enumeration test asserts this choice rather
//     than missing it — no allowlist edit belongs to this task.
//
// (c) **The set is selected by its own `client_local_id`, not by a server
//     id**, for decision (b)'s reason one level down: the device holds the
//     key it generated and nothing else. `set_logs_client_local` is a plain
//     UNIQUE on `(client_id, client_local_id)`, so that pair identifies
//     exactly one row inside the caller's own scope — which is both what
//     makes the selector precise and what makes it unable to reach out of
//     that scope.
//
// (d) **A set that is not there is a success, not a `NOT_FOUND`.** This is
//     the one decision here that is not inherited, and it is deliberate.
//     `./log-set.ts` throws when it cannot place a set, because a set that
//     cannot be written is the client's work being lost — the outbox SHOULD
//     retry that. A delete is the mirror image: its postcondition is "that
//     set is not in your log", and every not-there case already satisfies
//     it. Throwing would burn all ten outbox attempts and then tell the
//     client "couldn't sync" about a withdrawal that is, by the server's own
//     state, complete (`offline-sync` §5's duplicate-versus-conflict rule —
//     and §10's "outbox retrying forever" row names exactly this mistake).
//
//     Replay is the ordinary case rather than the exception, and it lands in
//     the `deleted` branch rather than this one: the UPDATE does not filter
//     on `deleted_at`, so a second flush of the same withdrawal finds the
//     row, rewrites the same instant, and answers identically. `not_found`
//     is reserved for a set this client genuinely does not have.
//
//     This leaks nothing. A caller learns the same thing from a no-op
//     whether the row belongs to somebody else or to nobody — which is the
//     property `ERRORS.md` ER§2.1 asks for, reached by not answering at all
//     rather than by answering carefully.
//
// (e) **The session's stored volume is re-derived in the same transaction.**
//     `recomputeSessionVolume` already excludes `deleted_at IS NOT NULL`
//     (its own decision (c)), so the soft delete and the re-total agree by
//     construction rather than by two rules that have to be kept in step.
//     Only for a `completed` session, which is `./log-set.ts` decision (e)'s
//     rule unchanged: while a session is in progress the column is not yet
//     meaningful and `workouts.complete` computes it from the rows anyway.
//     Without this, withdrawing a set from a finished session leaves
//     `total_volume_kg` overstating work the client says they did not do.
//
//     Nothing else on `set_logs` is derived today. `personal_records` is
//     still `recomputePersonalRecords`'s deliberate placeholder — it writes
//     nothing, `./log-set.ts` does not call it, and re-deriving PRs after a
//     withdrawal belongs to `personal-records/01` along with detecting them
//     in the first place. `estimated_1rm_kg` is per-row and needs no
//     recompute; the row it sits on is simply no longer counted.

export type DeleteSetInput = z.infer<typeof workoutsSchemas.deleteSetInput>;

/**
 * What the device is told about the set it withdrew.
 *
 * A discriminated union rather than a nullable-field object
 * (`code-conventions` §3): `not_found` carries no id because there is no row
 * to have one, and a shape that said `id: string | null` would invite a
 * caller to read it without checking which case it is in.
 */
export type DeleteSetResult =
  | { outcome: 'deleted'; id: string; workoutSessionId: string; deletedAt: Date }
  | { outcome: 'not_found' };

export async function deleteSet(
  db: DbClient,
  clientProfileId: string,
  input: DeleteSetInput,
  recompute: RecomputeVolume = recomputeSessionVolume,
): Promise<DeleteSetResult> {
  return db.transaction(async (tx) => {
    // Decision (b). `client_id` is from `ctx.user`, never the wire.
    //
    // No `deleted_at IS NULL` filter on the session, unlike `./log-set.ts` —
    // a deliberate difference, not an oversight. That filter stops new work
    // being ADDED to a withdrawn session; this statement only ever removes,
    // so refusing here would strand a queued delete behind a session state
    // the client cannot see and cannot act on.
    const [session] = await tx
      .select({
        id: schema.workoutSessions.id,
        status: schema.workoutSessions.status,
      })
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.clientId, clientProfileId),
          eq(schema.workoutSessions.clientLocalId, input.sessionClientLocalId),
        ),
      )
      .limit(1);

    if (!session) {
      // The caller named a session that is not theirs or does not exist.
      // Unlike a missing SET (decision (d)), this is not a withdrawal that
      // already happened — it is a key that never resolved, and the device
      // builds this field from the set's own recorded parent, so a healthy
      // outbox cannot produce it. One answer for every cause; anything
      // finer is an existence oracle (`ERRORS.md` ER§2.1).
      throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
    }

    // Decisions (a) and (c). Scoped by the caller's own `client_id` AND the
    // session just resolved under it, so the statement cannot reach a row
    // outside the session the caller named, let alone outside their own.
    //
    // `updated_at` is left alone on purpose: the `set_logs_updated_at`
    // trigger (migration 0021) owns it, and naming it here would be a
    // second opinion about a column the database already maintains.
    const [row] = await tx
      .update(schema.setLogs)
      .set({ deletedAt: input.deletedAt })
      .where(
        and(
          eq(schema.setLogs.clientId, clientProfileId),
          eq(schema.setLogs.clientLocalId, input.clientLocalId),
          eq(schema.setLogs.workoutSessionId, session.id),
        ),
      )
      .returning({
        id: schema.setLogs.id,
        workoutSessionId: schema.setLogs.workoutSessionId,
        deletedAt: schema.setLogs.deletedAt,
      });

    // Decision (d). Nothing matched, so nothing changed and nothing derived
    // from it is stale — the recompute below would be a no-op sum.
    if (!row) return { outcome: 'not_found' };

    // Decision (e). Inside the same transaction, so a failure here rolls the
    // withdrawal back with it rather than leaving a total nothing corrects.
    if (session.status === 'completed') {
      await recompute(tx, session.id);
    }

    return {
      outcome: 'deleted',
      id: row.id,
      workoutSessionId: row.workoutSessionId,
      // The UPDATE above set this column, so the fallback is unreachable —
      // it narrows `Date | null` without a non-null assertion, and to the
      // same value the statement wrote.
      deletedAt: row.deletedAt ?? input.deletedAt,
    };
  });
}
