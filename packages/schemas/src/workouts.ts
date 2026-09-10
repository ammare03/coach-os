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
