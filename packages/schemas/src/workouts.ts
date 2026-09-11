// Input schemas for `workouts.*` (upcoming, get, start, logSet, updateSet,
// complete, skip, history). `phase-09-workout-logger` fills the rest;
// `upcoming` lands early because `phase-08-offline-core/prefetch/01` needs
// it to populate the device's `local_workout_sessions` before the signal
// disappears, and P08 precedes P09 in build order.
import { z } from 'zod';

import { calendarDate, clientLocalId, id, strictObject } from './primitives.ts';

/**
 * The widest span `workouts.upcoming` will answer. Prefetch asks for two
 * days (today and tomorrow); the extra headroom exists so a later caller
 * can ask for a week without a schema change, while still bounding the
 * query — an unbounded range is a table scan anyone can request.
 */
export const MAX_UPCOMING_RANGE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/**
 * A client-local calendar range, inclusive at both ends. Both bounds are
 * `date`s and never timestamps: a session's `scheduled_date` is the
 * client's own local calendar day (`code-conventions` §6, `CLAUDE.md`
 * §25.5), so the range that selects one has to be expressed in the same
 * units.
 */
export const upcomingWorkoutsInput = strictObject({
  from: calendarDate,
  to: calendarDate,
})
  .refine((value) => value.to >= value.from, {
    message: 'to must not be earlier than from',
    path: ['to'],
  })
  .refine(
    (value) =>
      // Both sides are already `z.iso.date()`-validated, so `Date.parse`
      // yields UTC midnight for each and the difference is an exact whole
      // number of days — no timezone enters, because neither bound is an
      // instant.
      (Date.parse(value.to) - Date.parse(value.from)) / MS_PER_DAY < MAX_UPCOMING_RANGE_DAYS,
    { message: `the range may not span more than ${MAX_UPCOMING_RANGE_DAYS} days`, path: ['to'] },
  );
export type UpcomingWorkoutsInput = z.infer<typeof upcomingWorkoutsInput>;

/**
 * `workouts.startAdHoc` — a session with no program behind it
 * (`phase-09-workout-logger/today-card/04`). Both `assignment_id` and
 * `program_day_id` end up null, which DB§5.2's own comment says the columns
 * are nullable precisely to allow.
 *
 * Three things it deliberately does not take:
 *
 * - **No `clientId`.** The client is `ctx.user.clientProfileId` and never
 *   the wire (`api-conventions` §3, the same shape as `upcoming`), so there
 *   is no caller-supplied id `ownsResource` would have to guard.
 * - **No exercises.** An ad-hoc session starts empty and gains exercises
 *   inside the logger (`today-card/DESIGN-SPEC.md` §0) — an upfront picker
 *   would put a network-shaped `exercises.search` into the one flow that
 *   has to work with no signal.
 * - **No `status`.** Creating an ad-hoc session *is* starting it: the
 *   client is handed straight to the logger with no second "Start" step
 *   anywhere in frame `H`, so the row is born `in_progress`.
 */
export const startAdHocSessionInput = strictObject({
  /** DB§14.1's idempotency key. The outbox merges it into every payload it sends. */
  clientLocalId,
  /**
   * The client's own local calendar day, resolved on device
   * (`CLAUDE.md` §25.5). Device-authored on purpose: a client who has been
   * offline since last night is the only party that knows which local day
   * they were actually training on.
   */
  scheduledDate: calendarDate,
  /**
   * The instant the client tapped, captured on device and replayed verbatim
   * by the outbox — never `new Date()` at flush time, which is
   * `offline-sync` §10's "everything timestamped at reconnect". It is both
   * the session's `started_at` and, because creating the row is the only
   * local change being described, the `updated_at` DB§14.3's last-write-wins
   * comparison reads (`apps/api/src/lib/workout-session-upsert.ts`).
   */
  startedAt: z.date(),
});
export type StartAdHocSessionInput = z.infer<typeof startAdHocSessionInput>;

/**
 * `workouts.start` — the scheduled→in_progress transition for an ASSIGNED
 * session (`phase-09-workout-logger/session-runtime/01`). The ad-hoc
 * counterpart above creates a row; this one only ever moves a row the
 * coach's program already materialised.
 *
 * The distinction is why this input is shaped differently from
 * `startAdHocSessionInput`: there is nothing to insert, so the row is named
 * by its id rather than by an idempotency key. Keying the transition on the
 * device's copy of `workout_sessions.client_local_id` would make it the
 * conflict target of an upsert that must never insert — and would insert a
 * second workout for any row whose stored key is null, since the column is
 * nullable and `sessions_client_local` is partial.
 */
export const startSessionInput = strictObject({
  /** The server's own id. `ownsResource('workoutSession', …)` guards it. */
  workoutSessionId: id,
  /**
   * Accepted because `apps/mobile`'s flush loop merges the outbox row's key
   * into every payload it sends, and `strictObject` rejects what it does not
   * name. **The server does not key on it** — idempotency here is the
   * transition's own (a session already in progress is left exactly as it
   * is), not `ON CONFLICT`'s. Echoed back so a caller can match a replayed
   * response to the mutation that produced it.
   */
  clientLocalId,
  /**
   * The instant the client tapped Start, captured on device and replayed
   * verbatim by the outbox — never `new Date()` at flush time, which is
   * `offline-sync` §10's "everything timestamped at reconnect". Applied only
   * to a session that is still `scheduled`, so a replay cannot move it.
   */
  startedAt: z.date(),
});
export type StartSessionInput = z.infer<typeof startSessionInput>;

/**
 * `workouts.complete` — the `in_progress`→`completed` transition
 * (`phase-09-workout-logger/session-runtime/07`). The last move in a
 * session's lifecycle, and the one that computes `total_volume_kg` and
 * `duration_seconds`.
 *
 * **The session is named by its `client_local_id`, not by its server id**,
 * and that is the one decision worth reading twice. `startSessionInput`
 * above takes a `workoutSessionId` because an assigned session was
 * materialised server-side long before the client left signal, so the device
 * always has one to name. Completion has no such guarantee: an ad-hoc
 * session is created on the device (`startAdHocSessionInput`), its row is
 * born in the outbox, and the flush loop writes no server id back — so a
 * client who starts an empty session in a basement and finishes it there has
 * no `workout_sessions.id` to send, and a procedure that demanded one would
 * be unable to complete the session in front of them. Every session row a
 * client can reach carries a non-null `client_local_id` — deterministic for
 * a materialised one (DB§14.5 mechanism 1), device-generated for an ad-hoc
 * one — so that is the key that always exists on both sides.
 *
 * Naming the row by that key does **not** make this an upsert. The server
 * resolves it with an UPDATE scoped by `client_id`, which cannot insert; the
 * duplicate `startSessionInput` warns about comes from `ON CONFLICT` taking
 * its INSERT branch for a null stored key, and there is no INSERT branch
 * here to take.
 *
 * Two things it deliberately does not take:
 *
 * - **No `durationSeconds`.** It is `completed_at - started_at`, computed by
 *   the server from two timestamps already on the row. A client's local
 *   clock is not the source of truth for a number the coach may review later,
 *   and there is nothing a caller could supply that the server cannot derive
 *   more honestly.
 * - **No `totalVolumeKg`.** Same rule, stronger: volume is a sum over the
 *   session's own `set_logs`, computed inside the completing transaction
 *   (DB§8.2). A device that had not finished syncing its sets would report a
 *   number the rows contradict.
 */
export const completeSessionInput = strictObject({
  /**
   * `workout_sessions.client_local_id` — the session's own key, which is
   * also `local_workout_sessions.client_local_id` on the device. **Not** the
   * mutation's key below: the two are different values with different jobs,
   * and a single `clientLocalId` field would silently become whichever one
   * the flush loop merged in last.
   */
  sessionClientLocalId: clientLocalId,
  /**
   * The mutation's own idempotency key, merged into the payload by the flush
   * loop, which is why `strictObject` has to name it. The server does not key
   * on it — idempotency here is the transition's own, exactly as it is for
   * `startSessionInput`: a session already `completed` is returned untouched.
   */
  clientLocalId,
  /**
   * The instant the client tapped Finish, captured on device and replayed
   * verbatim by the outbox — never `new Date()` at flush time, which is
   * `offline-sync` §10's "everything timestamped at reconnect". A client who
   * finishes at 19:00 in a basement and syncs at 21:00 finished at 19:00.
   */
  completedAt: z.date(),
});
export type CompleteSessionInput = z.infer<typeof completeSessionInput>;

/**
 * `workouts.claim` — DB§14.5 mechanism 3, taken at the moment the client
 * taps Start and **before** the logger opens
 * (`phase-09-workout-logger/session-runtime/08`).
 *
 * Three things it deliberately does not take:
 *
 * - **No `deviceId`.** It is the `did` claim on the access token, read from
 *   `ctx.deviceId` and never the wire (`apps/api/src/trpc/context.ts`). A
 *   caller-supplied device id would let one device name another device's id
 *   and take, or falsely hold, a claim on the client's own session.
 * - **No instant.** The staleness decision is made entirely against the
 *   server's own clock. This procedure carried an `at` until the instant was
 *   found to be the one untrusted input the whole rule rests on: a device
 *   whose clock runs fast reports a claim that never ages, so the other
 *   device is asked to confirm a transfer that should have been silent; one
 *   running slow makes a live holder look abandoned and its session is taken
 *   out from under it mid-set. Neither is exotic — a wrong phone clock is
 *   ordinary. And unlike `workouts.start`, there is no offline case that
 *   needs the device's own instant: a claim is a live call on a live
 *   connection and is **never queued** (see below), so the server's clock is
 *   within a round trip of the tap and is the only one of the two that
 *   cannot be wrong.
 * - **No `clientId`.** The client is `ctx.user.clientProfileId`, the same
 *   shape as `upcoming` and `startAdHoc` above; `workoutSessionId` is the
 *   one caller-supplied id, and `ownsResource` guards it.
 *
 * This procedure is **never queued in the outbox.** It is a live call on a
 * live connection: with no signal there is no claim check at all, because
 * blocking an offline start on one would break the case the product exists
 * for (task 08's own Risks section). A queued claim would also be answering
 * a question hours after the client stopped asking it.
 */
export const claimSessionInput = strictObject({
  /** The server's own id. `ownsResource('workoutSession', …)` guards it. */
  workoutSessionId: id,
  /**
   * Whether the caller has already been told the session is claimed and the
   * client chose "Continue here" (`ERRORS.md` ER§1.4). `false` — the
   * default — makes a live claim held by another device throw
   * `SESSION_CLAIMED_ELSEWHERE` instead of taking it.
   *
   * A **stale** claim transfers regardless of this flag and with no sheet:
   * six hours since the session started, or fifteen minutes without a
   * heartbeat, means the holder is a phone in a drawer, and a client
   * standing in a gym must never be unable to log because of it (DB§14.5).
   */
  transfer: z.boolean().default(false),
});
export type ClaimSessionInput = z.infer<typeof claimSessionInput>;

/**
 * `workouts.heartbeat` — the liveness touch the active device sends every
 * few minutes while the logger is open (task 08 approach step 5). It is what
 * makes the fifteen-minute staleness rule safe in both directions: a dead
 * app releases the session quickly, a live one holds it.
 *
 * Shaped like {@link claimSessionInput} minus `transfer`, and that omission
 * is the whole difference between the two procedures. A heartbeat that could
 * transfer would steal the session back from a device the client had just
 * deliberately moved to, once per interval, forever.
 *
 * It carries no instant either, and for the stronger version of the same
 * reason: a heartbeat's entire claim is "I am alive **now**", so an instant
 * the caller chooses is the one part of it that cannot be taken on trust.
 */
export const heartbeatSessionInput = strictObject({
  workoutSessionId: id,
});
export type HeartbeatSessionInput = z.infer<typeof heartbeatSessionInput>;
