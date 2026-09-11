import { recomputeSessionVolume, schema, type DbClient, type SetLog } from '@coachos/db';
import type { workouts as workoutsSchemas } from '@coachos/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { appError } from '../../lib/app-error.ts';
import { offlineUpsert } from '../../lib/offline-upsert.ts';

// `workouts.logSet` — the server half of
// `phase-09-workout-logger/set-entry/01`, and the most frequently replayed
// mutation in the product.
//
// Six decisions, in the order they matter:
//
// (a) **This IS an upsert**, unlike `./start.ts` and `./complete.ts`, which
//     are both UPDATEs and say at length why. The difference is one column's
//     nullability: `set_logs.client_local_id` is NOT NULL behind a PLAIN
//     unique index (`set_logs_client_local`), so there is no null-keyed row
//     for `ON CONFLICT` to miss and take the INSERT branch for. Every set is
//     created by the device and has no server-side creation path at all, so
//     the insert branch is the ordinary one and the update branch is the
//     replay. Routed through `../../lib/offline-upsert.ts` rather than
//     hand-written, so this table's device-wins guarantee (DB§14.3) is the
//     one that file enforces and not a second opinion.
//
//     That is also what makes `set-entry/05` (editing a logged set) free:
//     the device re-sends the SAME `client_local_id` with new numbers and
//     the stored row is replaced field for field. An edit and a replay are
//     the same statement; only the payload differs.
//
// (b) **The session is named by its `client_local_id`, not its server id**,
//     and therefore this procedure carries no `ownsResource` — exactly
//     `./complete.ts` decision (b), for exactly its reason, and it is the
//     one decision here worth reading twice.
//
//     An ad-hoc session is created on the device (`./start-ad-hoc.ts`), its
//     row is born in the outbox, and the flush loop writes no server id
//     back. A client who starts an empty session in a gym basement and logs
//     forty sets into it has no `workout_sessions.id` to send, and a
//     procedure that demanded one could not log a single one of them. The
//     device's own mirror already encodes this: `local_set_logs.
//     session_local_id` references the parent's `client_local_id` and never
//     its server id.
//
//     Naming the row by that key costs nothing in safety, and the ownership
//     check does not disappear — it moves from the middleware into a
//     predicate the statement cannot be run without. The SELECT below is
//     pinned to `ctx.user.clientProfileId`, so a key belonging to another
//     client resolves to nothing and answers `NOT_YOUR_CLIENT`; the INSERT
//     then writes that same `client_id`, never one from the wire, so the
//     set cannot land on a row the caller does not own even in principle.
//     `sessionClientLocalId` is already registered in
//     `../../trpc/authz/resource-fields.ts`'s `NON_RESOURCE_ID_FIELDS` with
//     that reason, so the enumeration test asserts the choice rather than
//     missing it. `exerciseId` is registered there too — a global catalogue
//     row, not a client-scoped one.
//
// (c) **`workout_session_id` is resolved, never accepted.** It is read from
//     the session the predicate in (b) already matched, which is what makes
//     the denormalised `set_logs.client_id` (DB§6) provably agree with
//     `workout_sessions.client_id` rather than merely usually agree. The
//     `set_logs_no_owner_change` trigger (migration 0022) guards it
//     afterwards; this is what stops it ever being wrong in the first place.
//
// (d) **`estimated_1rm_kg` is computed here, on write** (DB§5.2's own column
//     comment says application code owns it, not the database), so
//     `personal-records/01` reads a number rather than recomputing one over
//     history. Epley, `CLAUDE.md` §26. See {@link epleyOneRepMaxKg} for why
//     it is local to this file and where it should end up.
//
// (e) **A set landing on an already-completed session recomputes the
//     volume, in the same transaction.** `./complete.ts` decision (g) names
//     this file as the systematic fix for the window it could only narrow:
//     the completion chains to the session START, so the sets are its
//     siblings and one can legitimately arrive after it, leaving
//     `total_volume_kg` behind the rows it summarises. Recomputing only for
//     a `completed` session is deliberate — for a session still in progress
//     the column is not yet meaningful and `workouts.complete` will compute
//     it from the rows anyway, so doing it per set would be a sum over the
//     whole session on every single tap.
//
// (f) **`deleted_at` is not in the payload.** Omitting it means
//     `offlineUpsert`'s inferred `set` never touches it, so a replay of the
//     original log cannot resurrect a set the client later deleted
//     (`set-entry/06`). Every other column the device sends is overwritten
//     unconditionally, which is DB§14.3's device-wins rule and the reason
//     an edit needs no separate procedure.

/** What `numeric(6, 2)` can hold — six significant digits, two after the point. */
const NUMERIC_6_2_MAX = 9_999.99;

/**
 * Epley: `w × (1 + r/30)` (`CLAUDE.md` §26), in kilograms.
 *
 * **A single returns the weight itself, not `w × (1 + 1/30)`.** Epley is an
 * extrapolation from a submaximal set, and at one rep there is nothing to
 * extrapolate — the client lifted that weight for one, so that weight IS the
 * one-rep max. Applying the formula anyway inflates every true single by
 * 3.3%, which would hand `personal-records/01` a PR the client never hit.
 * The `testing` skill §3 states this case as the unit test for the rule.
 *
 * `null` — never a number — when there is nothing to estimate from: a
 * bodyweight set carries no external load, and a zero-rep set is a failed
 * attempt rather than a single. `null` is also the answer when the result
 * would not fit `numeric(6,2)`; a value Postgres would reject with a 22003
 * is not an estimate worth failing the client's set over.
 *
 * ⚠️ **This belongs in `packages/utils`**, beside `sessionVolumeKg` — it is
 * a formula with two consumers (this write path and, later, the client's
 * own PR display), which is `code-conventions` §1's promotion rule exactly.
 * It is local here only to avoid a file collision with another agent
 * working in this worktree; promote it on the next touch, and delete this
 * copy in the same change rather than leaving two.
 */
export function epleyOneRepMaxKg(weightKg: number | null, reps: number): number | null {
  if (weightKg === null || weightKg <= 0) return null;
  if (reps < 1 || !Number.isFinite(reps)) return null;
  if (reps === 1) return weightKg > NUMERIC_6_2_MAX ? null : weightKg;

  const estimate = weightKg * (1 + reps / 30);
  if (!Number.isFinite(estimate) || estimate > NUMERIC_6_2_MAX) return null;

  return estimate;
}

/**
 * What the device is told about the set it logged. Mapped field by field and
 * never returned wholesale, so a column added to `set_logs` tomorrow does
 * not silently start crossing the wire — the same rule
 * `CompletedSessionSummary` states.
 */
export interface LoggedSetSummary extends Pick<
  SetLog,
  | 'id'
  | 'clientLocalId'
  | 'workoutSessionId'
  | 'exerciseId'
  | 'setNumber'
  | 'reps'
  | 'isWarmup'
  | 'isFailure'
  | 'loggedAt'
> {
  /**
   * Kilograms, parsed once here at the boundary. Drizzle hands back
   * `numeric` as a string (`code-conventions` §3's "numeric trap"), and a
   * caller that had to remember to parse it would eventually not.
   */
  weightKg: number | null;
  /** Epley, decision (d). `null` for a bodyweight or zero-rep set. */
  estimated1rmKg: number | null;
}

export type LogSetInput = z.infer<typeof workoutsSchemas.logSetInput>;

/** The shape `recomputeSessionVolume` satisfies — injected so decision (e) is testable. */
export type RecomputeVolume = (
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  workoutSessionId: string,
) => Promise<void>;

export async function logSet(
  db: DbClient,
  clientProfileId: string,
  input: LogSetInput,
  recompute: RecomputeVolume = recomputeSessionVolume,
): Promise<LoggedSetSummary> {
  return db.transaction(async (tx) => {
    // Decision (b). `client_id` is from `ctx.user`, never the wire, and it
    // is what makes this reachable only within the caller's own rows.
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
          isNull(schema.workoutSessions.deletedAt),
        ),
      )
      .limit(1);

    if (!session) {
      // A session that does not exist, belongs to someone else, or was
      // purged between the flush and here. One answer for all three —
      // anything finer is an existence oracle (`ERRORS.md` ER§2.1).
      throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
    }

    const weightKg = input.weightKg ?? null;
    const estimate = epleyOneRepMaxKg(weightKg, input.reps);

    const row = await offlineUpsert(tx, {
      table: schema.setLogs,
      values: {
        // Decision (c) — the session's own id, never the caller's word for it.
        workoutSessionId: session.id,
        exerciseId: input.exerciseId,
        clientId: clientProfileId,
        clientLocalId: input.clientLocalId,
        setNumber: input.setNumber,
        reps: input.reps,
        // `numeric` columns take strings, fixed at the column's own scale —
        // handing Drizzle a float here is how a weight acquires a
        // seventeenth decimal place on its way into a `numeric(6,2)`.
        weightKg: weightKg === null ? null : weightKg.toFixed(2),
        estimated1rmKg: estimate === null ? null : estimate.toFixed(2),
        isWarmup: input.isWarmup,
        isFailure: input.isFailure,
        loggedAt: input.loggedAt,
      },
      target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
      // DB§14.3 row one: the client was there and the server was not.
      // `offlineUpsert` refuses `'ignore'` for this table outright.
      onConflict: 'update',
    });

    // Decision (e). Inside the same transaction, so a failure here takes the
    // set down with it rather than leaving a total nothing will correct.
    if (session.status === 'completed') {
      await recompute(tx, session.id);
    }

    return summarise(row);
  });
}

function summarise(row: SetLog): LoggedSetSummary {
  return {
    id: row.id,
    clientLocalId: row.clientLocalId,
    workoutSessionId: row.workoutSessionId,
    exerciseId: row.exerciseId,
    setNumber: row.setNumber,
    reps: row.reps,
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    estimated1rmKg: row.estimated1rmKg === null ? null : Number(row.estimated1rmKg),
    isWarmup: row.isWarmup,
    isFailure: row.isFailure,
    loggedAt: row.loggedAt,
  };
}
