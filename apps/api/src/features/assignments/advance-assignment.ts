import { schema, type Assignment, type DbClient, type Transaction } from '@coachos/db';
import {
  addCalendarDays,
  diffCalendarDays,
  isoWeekdayOfCalendarDate,
  toLocalDate,
} from '@coachos/utils';
import type { CalendarDate } from '@coachos/utils';
import { and, eq } from 'drizzle-orm';

// `assignment/05-week-advance-and-completion.md` — closes out the
// assignment lifecycle: `current_week` advancing as a client progresses,
// and the `status = 'active' -> 'completed'` transition once the program's
// final week is behind them.
//
// **(a) Computed-on-read, with a lazy write-back — not a scheduled job.**
// `assignments.current_week` genuinely exists as a stored, defaulted
// column (`packages/db/src/schema/training.ts`), which argues it's meant
// to be written, not purely derived at render time. But a BullMQ queue
// that ticks every assignment forward on a schedule is real infrastructure
// DB§15's queue registry doesn't list, and it introduces exactly the bug
// class this task's Risks section warns about: a missed run (a stuck
// worker, a deploy window, a cold start) leaves `current_week` silently
// stale for however long the job doesn't fire — wrong until someone
// notices. Computing on read has no such window: the value shown is
// ALWAYS correct for the instant it's read, because it's derived fresh
// every time, never trusted from a prior write.
//
// The resolution: `computeAssignmentWeekProgress` below is the pure,
// stateless truth (`week = f(start_date, today, duration_weeks)`, no
// dependency on whatever the stored column currently says).
// `syncAssignmentProgress` is the "lazy update" middle ground the task
// file itself proposes — it computes the correct value, and if the stored
// column disagrees, writes the correction back as a side effect of this
// one read. This keeps the stored column honest for any consumer that
// bypasses this module and reads `training.assignments` directly (a
// report, a future admin tool, `db:studio`) WITHOUT needing a scheduled
// job: every real access path in this feature (`assignments.get`,
// `assignments.create`'s active-assignment conflict check) runs through
// `syncAssignmentProgress`, so the column is corrected on the cadence of
// "this assignment was actually looked at" rather than "a cron tick
// happened to run" — the exact trade the task's Risks section asks for.
//
// One acknowledged gap, documented rather than silently accepted:
// `listAssignableClients` (`./assignable-clients.ts`) is a multi-row list
// and cannot call `syncAssignmentProgress` per row without a query-per-row
// loop (`code-conventions` §7). It instead recomputes
// `computeAssignmentWeekProgress` in memory for DISPLAY ONLY, with no
// write-back — so what a coach sees on that list is always numerically
// correct, but the stored `current_week`/`status` for a row nobody has
// individually opened stays uncorrected until it next goes through
// `syncAssignmentProgress`. This is bounded and self-healing (the very
// next `assignments.get` or `assignments.create` conflict-check on that
// assignment corrects it), never silently wrong to a user.
//
// **(b) The client's timezone decides "today," never the server's or the
// coach's** — read via `toLocalDate(new Date(), clientTimezone)`, the same
// function `../../../packages/utils/src/dates.ts` documents as "the one
// function every date-grouped feature is built on." This is the one place
// in this task where a UTC-instant-to-calendar-day conversion is real:
// unlike `../../lib/materialise-sessions.ts`'s decision (d) (pure calendar
// arithmetic, no instant involved anywhere), this module compares a stored
// calendar date against *right now*, and "right now" only becomes a
// calendar day in a specific timezone.
//
// **(c) Completion must not orphan scheduled sessions — soft-deleted, not
// `'skipped'`.** When an assignment becomes `'completed'` — whether because
// `syncAssignmentProgress` detected the final week has passed, or because a
// coach called `assignments.complete` manually while sessions were still
// scheduled in the future — any of that assignment's `workout_sessions`
// still sitting at `status = 'scheduled'` get `deleted_at = now()` in the
// SAME transaction as the status write (`discardOrphanedScheduledSessions`
// below). The FK itself never orphans anything (`assignment_id` stays a
// valid reference to the now-completed row, `onDelete: 'set null'` only
// fires on a real delete) — the risk this closes is PRODUCT-orphaning: a
// `'scheduled'` session sitting under a program the client is no longer
// following would otherwise linger forever on a client's calendar/Today
// card as something that will never happen and was never explicitly
// resolved. `status = 'skipped'` was the first cut of this and was
// rejected for three reasons:
//
//   1. `'skipped'` is a statement about the CLIENT's behaviour — they had a
//      session and didn't do it. Here the COACH ended the program and the
//      client never had the chance to skip anything; recording a skip is
//      factually wrong about a person, and any consumer that treats
//      `'skipped'` as a compliance/adherence signal (P10's adherence
//      engine, most concretely) inherits that error.
//   2. `sessions_client_day_unique` (`packages/db/src/schema/training.ts`)
//      is partial on `deleted_at IS NULL`, so a `'skipped'`-but-not-deleted
//      row keeps occupying its `(client_id, program_day_id, scheduled_date)`
//      slot. `../../lib/materialise-sessions.ts`'s decision (e) deliberately
//      made materialisation non-idempotent and made a collision on that
//      index abort loudly — so completing a program early and then
//      re-assigning the SAME program to the same client over any
//      overlapping date range would fail at the database with a raw unique
//      violation. Soft-deleting frees the slot; `'skipped'` alone does not.
//   3. `deleted_at` is DB§2's general soft-delete convention across this
//      schema. A consumer that already follows that convention (filters
//      `deleted_at IS NULL`) is correct by default here too, instead of
//      every consumer needing to separately know a magic `skip_reason`
//      string is a "this doesn't count" marker — exactly the kind of extra
//      rule P10's adherence engine would forget to apply.
//
// A session already `'in_progress'` or `'completed'` is left untouched —
// its own `status` still stands as the true record of what happened — only
// `'scheduled'` rows are discarded. **Known follow-on gap, not fixed here**
// (view change, its own migration/task): `client_dashboard_summary`
// (`packages/db/src/schema/coaching.ts`)'s `sessions_scheduled_7d` subquery
// filters neither `deleted_at` nor `status`, so a session discarded by this
// function can still drift into that trailing-7-day count. Logged in
// `docs/UNFORGET.md`, owner P10 `coach-review-surfaces/adherence-engine`.
//
// **(d) Manual pause/resume.** `assignments.pause`/`assignments.complete`
// (`assignment/01`) already close the lifecycle's two coach-driven exits.
// No `resume`/unpause procedure is added here: nothing in the app calls
// one (the assign sheet's conflict resolutions are "pause or complete
// only," per `assignment/01`'s own Approach step 3), and `current_week`
// deliberately does NOT advance for a `'paused'` assignment (see the
// `status !== 'active'` short-circuit in `syncAssignmentProgress` below) —
// pausing freezes progress by design, so there's no lifecycle gap a resume
// endpoint would need to close today. Adding an unused mutation would be
// the exact scope creep this task's own file-boundary note warns against;
// flagged in the PR description in case a future task finds a real caller
// for it.

/** The week-progress a program's calendar structure implies for one date. */
export interface AssignmentWeekProgress {
  /** 1-indexed, capped at `durationWeeks` in both directions. */
  currentWeek: number;
  /** `true` once `today` is at least one calendar day past the program's final week. */
  isPastFinalWeek: boolean;
}

/**
 * Pure function: given an assignment's `startDate`, a calendar `today`, and
 * the program's `durationWeeks`, returns the week the client should be on.
 *
 * Uses the SAME Monday-of-week-one alignment `../../lib/materialise-sessions.ts`'s
 * `calendarDateForProgramDay` uses (decision (a) there) — week 1 is the
 * calendar week containing `startDate`, not a sequential 7-day offset from
 * it, so a program starting mid-week has a short first week and this
 * function's `currentWeek` agrees with which week that materialisation
 * actually scheduled a given session's `scheduled_date` into. Deliberately
 * NOT imported from that file (this module owns no dependency on it,
 * avoiding coupling to a file this task does not modify) — the two-line
 * "Monday of week one" formula is replicated here against the same
 * `packages/utils` primitives (`addCalendarDays`, `isoWeekdayOfCalendarDate`),
 * never reimplemented as raw date math (`CLAUDE.md` §25.5). This module's
 * own test suite cross-checks the two independently against each other.
 */
export function computeAssignmentWeekProgress(
  startDate: CalendarDate,
  today: CalendarDate,
  durationWeeks: number,
): AssignmentWeekProgress {
  const startWeekday = isoWeekdayOfCalendarDate(startDate);
  const mondayOfWeekOne = addCalendarDays(startDate, -(startWeekday - 1));
  const daysSinceWeekOneMonday = diffCalendarDays(mondayOfWeekOne, today);
  const rawWeek = Math.floor(daysSinceWeekOneMonday / 7) + 1;

  return {
    currentWeek: Math.min(Math.max(rawWeek, 1), durationWeeks),
    isPastFinalWeek: rawWeek > durationWeeks,
  };
}

/** The up-to-date view `syncAssignmentProgress` returns, after any write-back. */
export type AssignmentProgress = Pick<Assignment, 'id' | 'currentWeek' | 'status' | 'completedAt'>;

/**
 * Soft-deletes (`deleted_at = now()`) any `'scheduled'` session under
 * `assignmentId` — decision (c). `status` is left exactly as it was
 * (`'scheduled'`); `deleted_at` alone is what marks it discarded, per
 * DB§2's general soft-delete convention. Takes `tx` with no default
 * (`../../lib/audit-log.ts`'s own rule): always called as part of the same
 * transaction as the assignment's `status` write, so a session can never
 * end up discarded under an assignment that then fails to actually
 * complete, or vice versa.
 */
export async function discardOrphanedScheduledSessions(
  tx: Transaction,
  assignmentId: string,
): Promise<void> {
  await tx
    .update(schema.workoutSessions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.workoutSessions.assignmentId, assignmentId),
        eq(schema.workoutSessions.status, 'scheduled'),
      ),
    );
}

/**
 * The one real "read path" this task builds (decision (a)): reads an
 * `'active'` assignment's true week/completion state and, if the stored
 * columns disagree, corrects them as a side effect, inside one transaction
 * with `discardOrphanedScheduledSessions` when completion fires. Called from
 * `assignments.get` and from `create-assignment.ts`'s active-assignment
 * conflict check — every place this feature actually looks at a specific
 * assignment by id.
 *
 * A `'paused'`, `'completed'`, or `'cancelled'` assignment is returned
 * as-is with no computation or write — only `'active'` assignments
 * progress or auto-complete (decision (d)'s note on pause freezing
 * progress).
 *
 * Returns `null` if `assignmentId` names no row — callers that reach this
 * through `ownsResource('assignment', …)` never see that case in practice
 * (the guard already 404s a nonexistent id), but this stays a normal
 * return rather than a thrown assertion so a call site can decide how to
 * react.
 */
export async function syncAssignmentProgress(
  db: DbClient,
  assignmentId: string,
): Promise<AssignmentProgress | null> {
  const [row] = await db
    .select({
      id: schema.assignments.id,
      startDate: schema.assignments.startDate,
      currentWeek: schema.assignments.currentWeek,
      status: schema.assignments.status,
      completedAt: schema.assignments.completedAt,
      durationWeeks: schema.programs.durationWeeks,
      // Decision (b): the CLIENT's timezone, read off their own user row —
      // never the coach's, never the server's.
      clientTimezone: schema.users.timezone,
    })
    .from(schema.assignments)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.assignments.programId))
    .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.assignments.clientId))
    .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
    .where(eq(schema.assignments.id, assignmentId))
    .limit(1);
  if (!row) return null;

  if (row.status !== 'active') {
    return {
      id: row.id,
      currentWeek: row.currentWeek,
      status: row.status,
      completedAt: row.completedAt,
    };
  }

  const today = toLocalDate(new Date(), row.clientTimezone);
  const progress = computeAssignmentWeekProgress(row.startDate, today, row.durationWeeks);

  if (progress.isPastFinalWeek) {
    const completedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.assignments)
        .set({ status: 'completed', completedAt, currentWeek: row.durationWeeks })
        .where(eq(schema.assignments.id, assignmentId));
      await discardOrphanedScheduledSessions(tx, assignmentId);
    });
    return { id: row.id, currentWeek: row.durationWeeks, status: 'completed', completedAt };
  }

  if (progress.currentWeek !== row.currentWeek) {
    await db
      .update(schema.assignments)
      .set({ currentWeek: progress.currentWeek })
      .where(eq(schema.assignments.id, assignmentId));
  }

  return { id: row.id, currentWeek: progress.currentWeek, status: 'active', completedAt: null };
}
