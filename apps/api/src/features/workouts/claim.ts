import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

// DB§14.5 mechanism 3 — the session claim
// (`phase-09-workout-logger/session-runtime/08`).
//
// Mechanisms 1 and 2 (the deterministic `client_local_id` and
// `sessions_client_day_unique`) already guarantee that two devices logging
// Tuesday's session converge on ONE row. What they cannot address is the two
// devices then writing *sets* into it concurrently: set logs keep per-device
// random keys, because two devices logging "squat, set 1" are the same real
// set and a legitimate repeated set look identical from here, and there is no
// merge UI (DB§14.3). So the situation is prevented rather than reconciled —
// one device owns the session at a time.
//
// Six rules, in the order they matter:
//
// (a) **A claim may never strand a client.** This outranks correctness
//     everywhere in this file: a duplicate row is recoverable, a client
//     standing in a gym who cannot log is not (task 08 approach step 6).
//     Every branch below that could refuse ships a way through — the stale
//     rules take silently, `transfer` takes on request, and
//     `../../routers/support.ts` clears a claim for the phone that fell in
//     a river.
//
// (b) **Two timestamps, one column.** `claimed_at` is the LAST HEARTBEAT,
//     not the moment the claim was first taken — {@link heartbeatSession}
//     moves it. That is what makes {@link CLAIM_HEARTBEAT_STALE_MS} mean
//     "this device has gone quiet". DB§14.5's second rule, the six-hour
//     ceiling that holds "regardless of heartbeats", therefore cannot read
//     the same column: a device heartbeating forever would push it forever.
//     It is anchored on `started_at` instead — the session's own start,
//     which `../start.ts` sets once and never moves. Measuring the ceiling
//     from the session rather than from the claim makes it fire *earlier*
//     after a transfer, never later, and rule (a) says which direction to
//     err in. **A dedicated `claim_taken_at` column would be the exact
//     model**; it is not added here because DB§14.5 and the schema are out
//     of this task's scope, and `started_at` carries the rule faithfully.
//
// (c) **Neither the device id nor the instant is caller-supplied.** The
//     device id is the `did` claim off the access token
//     (`../../trpc/context.ts`) — from the wire, one device could name
//     another's id and hold a claim on the client's own session that nothing
//     could clear. The instant is the server's own clock, passed in as `at`
//     by the router: `claim` and `heartbeat` are live calls that are never
//     queued, so there is no offline case needing a device timestamp, and a
//     device clock is the single input that can invert every branch below —
//     fast, and a live claim never ages; slow, and a live holder is robbed
//     mid-set. `at` stays a parameter rather than a `new Date()` inside this
//     module only so the rules are testable without waiting out fifteen real
//     minutes; nothing may ever wire it back to an input field.
//
// (d) **Decide and write under one row lock.** {@link decideClaim} is pure
//     and the caller applies it inside a transaction that took `FOR UPDATE`
//     first, so two devices racing the same session serialise: the second
//     one's decision is evaluated against the row the first just committed.
//     A read-then-write outside a lock compares against a snapshot from
//     before the race and lets both devices believe they won.
//
// (e) **The heartbeat's write is throttled.** `platform.touch_updated_at`
//     (migration 0021) is an unconditional `BEFORE UPDATE`, so every write
//     here advances `workout_sessions.updated_at` to the server clock — and
//     that column is the basis DB§14.3's last-write-wins comparison for
//     `status` reads (`../../lib/workout-session-upsert.ts`). A 3-minute
//     ping would advance it twenty times an hour for a device that changed
//     nothing. {@link CLAIM_HEARTBEAT_WRITE_MIN_MS} collapses that to at
//     most one write per interval while keeping the stored value far
//     fresher than the staleness window needs.
//
// (f) **Nothing about the holding device leaves this module.** Not its id,
//     not when it claimed. The client's only decision is whether to
//     continue here, and `ERRORS.md` ER§1.4's copy asks that without any of
//     it (`packages/schemas/src/errors.ts`).

/**
 * How long a claim survives without a heartbeat. Past this the holder is
 * assumed gone and the session transfers with no confirmation — DB§14.5's
 * "has not heartbeated in 15 minutes".
 */
export const CLAIM_HEARTBEAT_STALE_MS = 15 * 60 * 1_000;

/**
 * The hard ceiling, measured from `started_at` — rule (b). DB§14.5: a claim
 * older than six hours is takeable "regardless of heartbeats", which is what
 * stops a device left running on a bench from owning a session forever.
 */
export const CLAIM_CEILING_MS = 6 * 60 * 60 * 1_000;

/**
 * The minimum age a stored `claimed_at` must reach before a heartbeat is
 * written back — rule (e). Comfortably inside
 * {@link CLAIM_HEARTBEAT_STALE_MS}: even if one interval is missed, the
 * stored value stays well under the staleness window.
 */
export const CLAIM_HEARTBEAT_WRITE_MIN_MS = 5 * 60 * 1_000;

/** The three claim columns, plus the ceiling's anchor. */
export interface ClaimState {
  activeDeviceId: string | null;
  claimedAt: Date | null;
  startedAt: Date | null;
}

/**
 * Whether a claim held by some other device is takeable with no
 * confirmation. Both halves of DB§14.5's rule are required and neither is
 * sufficient: the heartbeat rule alone lets a device that never stops
 * pinging hold forever, and the ceiling alone leaves a six-hour hole after a
 * client's phone dies.
 */
export function isClaimStale(state: ClaimState, at: Date): boolean {
  // A device id with no timestamp beside it cannot be aged, so it is not
  // evidence of anything. Treat it as gone rather than as immortal.
  if (state.claimedAt === null) return true;

  const sinceHeartbeatMs = at.getTime() - state.claimedAt.getTime();
  if (sinceHeartbeatMs > CLAIM_HEARTBEAT_STALE_MS) return true;

  const anchor = state.startedAt ?? state.claimedAt;
  return at.getTime() - anchor.getTime() > CLAIM_CEILING_MS;
}

export type ClaimOutcome =
  /** Nobody held it. */
  | 'claimed'
  /** This device already held it; the heartbeat is refreshed. */
  | 'renewed'
  /** Another device held it, and it is now this device's. */
  | 'transferred'
  /** Another device holds it, live, and the caller did not ask to take it. */
  | 'held_elsewhere';

export interface ClaimDecision {
  outcome: ClaimOutcome;
  /** Whether the columns actually need writing — rule (e). */
  write: boolean;
}

export interface DecideClaimInput extends ClaimState {
  /** This connection's device, from the access token — rule (c). */
  deviceId: string;
  /** The instant the device acted, captured on device. */
  at: Date;
  /**
   * The client answered "Continue here" to `SESSION_CLAIMED_ELSEWHERE`.
   * Never set by {@link heartbeatSession} — a heartbeat that could transfer
   * would steal the session back, once per interval, from the device the
   * client had just deliberately moved to.
   */
  transfer: boolean;
}

/**
 * The whole rule, as a pure function so every branch is testable without a
 * database. The caller is responsible for evaluating it under the row lock —
 * rule (d).
 */
export function decideClaim(input: DecideClaimInput): ClaimDecision {
  const { activeDeviceId, claimedAt, deviceId, at, transfer } = input;

  if (activeDeviceId === null) return { outcome: 'claimed', write: true };

  if (activeDeviceId === deviceId) {
    // Rule (e). Also skipped when `at` is not newer than what is stored: a
    // request delayed in flight must not drag the heartbeat backwards.
    const write =
      claimedAt === null || at.getTime() - claimedAt.getTime() >= CLAIM_HEARTBEAT_WRITE_MIN_MS;
    return { outcome: 'renewed', write };
  }

  if (isClaimStale(input, at)) return { outcome: 'transferred', write: true };
  if (transfer) return { outcome: 'transferred', write: true };

  return { outcome: 'held_elsewhere', write: false };
}

export type ClaimResult =
  | ({ status: 'decided' } & ClaimDecision)
  /**
   * No row for this client. `ownsResource` has already run, so this is a row
   * purged between the guard and here, or one that never existed — one
   * answer for both, since anything finer is an existence oracle
   * (`ERRORS.md` ER§2.1).
   */
  | { status: 'not_found' }
  /**
   * The access token carries no device id, so there is nothing to write into
   * `active_device_id`. The caller proceeds unclaimed rather than refusing:
   * rule (a), and a token shape is not the client's problem.
   */
  | { status: 'no_device' };

export interface ClaimSessionInput {
  workoutSessionId: string;
  deviceId: string | null;
  at: Date;
  transfer: boolean;
}

/**
 * Takes, renews, or declines to take the claim on one session, and reports
 * which. Never throws for a claim reason — `../../routers/workouts.ts` is
 * what turns `held_elsewhere` into `SESSION_CLAIMED_ELSEWHERE`, and only for
 * the live call the client is waiting on.
 */
export async function claimSession(
  db: DbClient,
  clientProfileId: string,
  input: ClaimSessionInput,
): Promise<ClaimResult> {
  if (input.deviceId === null) return { status: 'no_device' };
  const deviceId = input.deviceId;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        activeDeviceId: schema.workoutSessions.activeDeviceId,
        claimedAt: schema.workoutSessions.claimedAt,
        startedAt: schema.workoutSessions.startedAt,
      })
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.id, input.workoutSessionId),
          eq(schema.workoutSessions.clientId, clientProfileId),
          isNull(schema.workoutSessions.deletedAt),
        ),
      )
      // Rule (d). The lock is taken before the decision, not after it.
      .for('update')
      .limit(1);

    if (!row) return { status: 'not_found' as const };

    const decision = decideClaim({ ...row, deviceId, at: input.at, transfer: input.transfer });

    if (decision.write) {
      await tx
        .update(schema.workoutSessions)
        .set({ activeDeviceId: deviceId, claimedAt: input.at })
        .where(eq(schema.workoutSessions.id, input.workoutSessionId));
    }

    return { status: 'decided' as const, ...decision };
  });
}

/**
 * The liveness touch, sent every few minutes while the logger is open. Same
 * core as {@link claimSession} with `transfer` pinned false — a heartbeat
 * never takes a session from a device that legitimately holds it.
 *
 * It *does* take a free or stale one. A device that started while offline
 * never got to claim, and its first heartbeat after the signal returns is
 * the natural moment to record who is actually logging.
 */
export function heartbeatSession(
  db: DbClient,
  clientProfileId: string,
  input: Omit<ClaimSessionInput, 'transfer'>,
): Promise<ClaimResult> {
  return claimSession(db, clientProfileId, { ...input, transfer: false });
}

/**
 * `SUPPORT.md` SU§3's lost-phone release. Clears the two claim columns and
 * touches nothing else — not the status, not a set, not the prescription.
 *
 * Returns whether a claim was there to clear, which is the whole of what the
 * operator is told: no device id, no timestamp, nothing about the session's
 * contents (DB§18).
 */
export async function clearSessionClaim(
  db: DbClient,
  workoutSessionId: string,
): Promise<{ found: boolean; cleared: boolean }> {
  const [row] = await db
    .select({ activeDeviceId: schema.workoutSessions.activeDeviceId })
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, workoutSessionId))
    .limit(1);

  if (!row) return { found: false, cleared: false };
  if (row.activeDeviceId === null) return { found: true, cleared: false };

  await db
    .update(schema.workoutSessions)
    .set({ activeDeviceId: null, claimedAt: null })
    .where(eq(schema.workoutSessions.id, workoutSessionId));

  return { found: true, cleared: true };
}
