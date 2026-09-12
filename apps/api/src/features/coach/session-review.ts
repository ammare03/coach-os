import { PERSONAL_RECORD_TYPES, schema, type DbClient, type PersonalRecordType } from '@coachos/db';
import {
  parseNumeric,
  parseSessionClientNotes,
  parseSetNote,
  type ExerciseTarget,
} from '@coachos/utils';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

// `session.review` (`phase-10-coach-review-surfaces/session-review/01`) —
// §8.4's coach-side close: "full session with every set, PRs highlighted."
// The screen `coach.clients.trainingHistory` (`client-detail/02`) links
// into, and the detail of exactly one of its rows.
//
// **Five statements at most, none of them per row, and the fifth only when
// the session was prescribed at all.** The list one screen back had the same
// discipline for the same reason; here the N+1 trap is per SET rather than
// per session, and a PR lookup per set row would be one query per line of a
// 40-set session. One grouped read across every set id answers all of them.
//
// The fifth statement answers two questions at once — where a skip belongs
// (decision (c2)) and what each performed group was asked for (decision
// (f)) — because both are `program_exercises` rows for the same
// `program_day_id`. Reading them twice would be two statements for one
// table scan, so the condition is simply "this session has a program day".
//
// Guarded by `ownsResource('workoutSession', …)` at the router, never here
// (`api-conventions` §3). Nothing below re-checks `coach_id`.
//
// Seven decisions, in the order they matter:
//
// (a) **`reviewed_at` is written by a `query`, which `api-conventions` §2
//     otherwise forbids.** This is the one deliberate exception in the API,
//     and the task that asked for it (Approach step 3) states the product
//     reason: §8.2's "Needs review" counter is meant to clear the moment a
//     coach actually looks at the session, and a separate "mark reviewed"
//     tap is friction with no product value. A mutation cannot back a
//     `useQuery`, so making this a mutation would mean the screen firing
//     two calls — a read and a write — for one act of reading.
//
//     What keeps it safe is that the write is **idempotent and one-way**:
//     `WHERE reviewed_at IS NULL` means the second view, and the tenth,
//     change nothing (`retention-and-quota/03`'s "atomic UPDATE, never
//     read-then-write"). A retried or duplicated request is indistinguishable
//     from a single one, which is the property a `query` actually needs.
//
// (b) **Performed order is recovered from `set_logs.logged_at`, not from
//     the program.** Approach step 1 asks for the order the exercises were
//     actually done in. The program's `order_index` is the PLAN, and a
//     client who reordered or swapped their way through a session did not
//     follow it; `program_snapshot` freezes that same plan at start, so it
//     cannot answer either. `logged_at` is captured at the tap on the
//     device (`offline-sync` §10), so it survives a sync hours later in a
//     different place and is the only column that records what happened.
//     Groups therefore appear in order of their earliest set.
//
// (c) **Groups are keyed on `exercise_id`, because that is the only key the
//     row has.** The logger pages on `program_exercises.id`, so a back-off
//     block and its main block are two pages there and one group here.
//     `set_logs` carries no `program_exercise_id` (DB§5.2) and inventing
//     one is a `phase-01-data-layer` change, not a screen's
//     (`useSwapExercise.ts` decision (a) reaches the same conclusion from
//     the other side). The cost is bounded: two blocks of one movement
//     merge into one group, still in performed order, still with every set.
//
// (c2) **A skip is placed where the PROGRAM put the exercise, interleaved
//     into the performed sequence — never appended as a trailing block.** A
//     skip has no `logged_at`: it produced no set logs, which is what a skip
//     is, so decision (b)'s ordering key cannot reach it. But a coach
//     reading top to bottom needs "they skipped lateral raises after incline
//     press", not a footnote at the end that reads like a different session.
//     The only order a skip has a claim to is the one it was prescribed in,
//     so `program_exercises.order_index` for the session's day places it
//     relative to the exercises that did produce sets, and the performed
//     groups themselves are never reordered by it.
//
//     **The match is by NAME**, because the name is all a skip carries:
//     `client_notes` stores the client's own sentence and nothing else
//     (`session-notes.ts` decision (c)). A swapped group is matched on its
//     `substitutedFor` name when its own exercise id is not in the plan, so
//     a swap does not drag the skip after it out of position.
//
//     **The fallback is to append, in `client_notes` line order.** An ad-hoc
//     session has no `program_day_id` to appeal to and a skip of an exercise
//     no longer in the day matches nothing; both land after the work, which
//     is the honest answer — the order is unknown, not invented.
//
// (d) **Volume and duration are read, not recomputed.** `total_volume_kg`
//     is maintained by `recomputeSessionVolume` inside the same transaction
//     as every set write (DB§8.2), and `workouts.complete.test.ts` pins it
//     equal to `packages/utils`' `sessionVolumeKg` to the cent. Recomputing
//     here would be a third implementation of one rule and the first chance
//     for this screen to disagree with the history row that opened it.
//     Both columns are `null` rather than `0` when there is nothing to
//     report — a bodyweight session did not lift nothing (`COPY.md` CO§2).
//
// (e) **The client's NAME and IANA ZONE come from `identity.users`, joined
//     onto this session's own read — not from `v_client_overview`, which is
//     where `dashboard.ts` and `client-overview.ts` read the name.** That
//     view's `name` column *is* `users.name` (migration 0032), so the three
//     surfaces cannot disagree; what the view adds on top is seven
//     correlated subqueries counting a week of sessions, videos and
//     messages, none of which this screen draws. Paying for them to learn
//     one string would make the cheapest statement on the path the most
//     expensive. `users.timezone` is not in the view at all, and the same
//     join answers both.
//
//     The zone is returned **raw, never as a formatted time**. `startedAt`
//     rendered without one would render in the COACH's zone, which is
//     §25.5's exact trap — a coach in Mumbai reading a client in Toronto.
//     `scheduledDate` is untouched: it is already the client-local
//     `yyyy-MM-dd` and needs no zone to be correct.
//
// (f) **A performed group carries the prescription it was performed
//     against, as columns, not as a string.** The words are
//     `packages/utils`' `formatTargetScheme` — the same function the coach's
//     own program-day screen and the client's logger already print, so all
//     three read one scheme (`target-scheme.ts`'s header rule). Formatting
//     here would need the reader's `weight_unit`, which is a display
//     preference of whoever is looking (DB§5.1.1) and not a property of the
//     session, so the API returns kilograms and the device spells them.
//
//     `target` is **`null` on a substituted group**: the block was written
//     for the exercise the client replaced, so naming it as this exercise's
//     target would misreport what was asked for. It is `null` for an ad-hoc
//     session, which has no `program_day_id` to ask, and `null` for any
//     performed exercise the day does not prescribe — a client who added a
//     movement was asked for nothing, which is not the same as being asked
//     for zero. A **skip carries no target at all**: the row says only that
//     the exercise did not happen, and a scheme beside it would read as
//     work.
//
//     A day that prescribes one movement twice (a back-off block after the
//     main one) collapses to one group by decision (c), and the FIRST
//     block's target is the one it carries — the same "first occurrence
//     wins" rule `interleaveSkips` already applies to that movement's
//     position, for the same reason: the earlier block is the one the
//     coach's instruction for that exercise opens with.

type SessionStatus = (typeof schema.workoutSessions.$inferSelect)['status'];

/** One logged set, exactly as the client recorded it. */
export interface SessionReviewSet {
  /** `set_logs.id` — what `session-review/02`'s comment affordance keys off. */
  setLogId: string;
  setNumber: number;
  reps: number | null;
  /** Kilograms, always — display conversion happens on the device (`CLAUDE.md` §0). */
  weightKg: number | null;
  rpe: number | null;
  rir: number | null;
  /** Timed holds and carries. `null` for an ordinary rep-based set. */
  durationSeconds: number | null;
  /** Metres. Carries and cardio only. */
  distanceM: number | null;
  /** Epley, as the server computed it on write. `null` for a bodyweight or zero-rep set. */
  estimated1rmKg: number | null;
  isWarmup: boolean;
  isFailure: boolean;
  /**
   * The client's own words, with the substitution line lifted out into the
   * group's `substitutedFor`. Any other line survives verbatim
   * (`session-notes.ts` decision (b)).
   */
  notes: string | null;
  loggedAt: Date;
  /**
   * The records this set set and the client still holds, in
   * `PERSONAL_RECORD_TYPES` order. Empty for the ordinary set.
   *
   * The ORDER a surface names them in is that surface's own decision —
   * `apps/mobile/.../lib/pr-celebration.ts`'s `PR_PRIORITY` is the client
   * app's, and this is deliberately not it. These are the facts.
   */
  personalRecordTypes: PersonalRecordType[];
}

/** One exercise, and every set the client logged against it. */
export interface SessionReviewExerciseGroup {
  /** Discriminant — this exercise was performed. */
  kind: 'performed';
  exerciseId: string;
  exerciseName: string;
  /**
   * The exercise the client was prescribed, before they swapped it — or
   * `null` for an ordinary one. Read back from the first set's note, which
   * is the only trace a substitution leaves (DB§5.2 has no column for it).
   */
  substitutedFor: string | null;
  /**
   * What the program day asked for, in the columns
   * `packages/utils`' `formatTargetScheme` reads — weights in kilograms,
   * unformatted, because the unit they are spelled in belongs to whoever is
   * reading (decision (f)).
   *
   * `null` on a substituted group, on an ad-hoc session, and on any
   * exercise the day does not prescribe.
   */
  target: ExerciseTarget | null;
  /** In `set_number` order, which is the order they were performed. */
  sets: SessionReviewSet[];
}

/** One exercise the client explicitly skipped, and what they said about it. */
export interface SessionReviewSkippedExercise {
  /** Discriminant — this exercise was skipped, and renders as a row saying so. */
  kind: 'skipped';
  exerciseName: string;
  /** The client's own wording of the reason, lowercase as the note stores it. */
  reasonLabel: string;
  /** Anything they added beyond the reason, or `null`. */
  note: string | null;
}

/**
 * One row of the session, performed or skipped.
 *
 * **One list, already ordered** — the screen renders `exercises` top to
 * bottom and never merges two arrays itself. Where a skip belongs among the
 * work is a judgement about the program and the client's notes, and both of
 * those are here rather than on the device (decision (c2)).
 */
export type SessionReviewEntry = SessionReviewExerciseGroup | SessionReviewSkippedExercise;

export interface SessionReview {
  sessionId: string;
  /** The client this session belongs to — the coach already owns them, by the time this returns. */
  clientId: string;
  /**
   * `users.name`, the same column `v_client_overview.name` projects, so the
   * header here and the row on the dashboard name one person identically
   * (decision (e)). `NOT NULL`, so never empty.
   */
  clientName: string;
  /**
   * The CLIENT's IANA zone (`users.timezone`, `NOT NULL`, default `'UTC'`)
   * — the only thing that makes `startedAt` renderable as a time of day
   * without silently showing it in the coach's zone (`CLAUDE.md` §25.5).
   * A zone, never a formatted instant: the device formats.
   */
  clientTimezone: string;
  /** `yyyy-MM-dd` — the CLIENT's local training day, never an instant (DB§5.3, `CLAUDE.md` §25.5). */
  scheduledDate: string;
  /** The session's own name, else the program day's, else `null`. */
  name: string | null;
  status: SessionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationSeconds: number | null;
  /** Kilograms. `null`, never `0`, for a session with nothing weighted in it. */
  totalVolumeKg: number | null;
  /** The client's own 1–10 rating of the whole session, or `null`. */
  perceivedExertion: number | null;
  /** What the client wrote, with the skip lines lifted out into `exercises`. */
  clientNotes: string | null;
  /** The WHOLE-session skip reason. `null` unless `status === 'skipped'`. */
  skipReason: string | null;
  /**
   * Never `null`: this read is what sets it. A caller wanting to know
   * whether the coach had seen this session BEFORE opening it is asking a
   * question this procedure structurally cannot answer (decision (a)).
   */
  reviewedAt: Date;
  /**
   * Every exercise of the session, performed and skipped, in one already-
   * ordered list: performed groups in the order they were done (decision
   * (b)), each skip interleaved at its prescribed position (decision (c2)).
   */
  exercises: SessionReviewEntry[];
}

/** Drizzle hands `numeric` back as a string (`code-conventions` §3) — parsed once, here. */
function parseNumericOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Statement 1 — the side effect, and the only write on this path.
 *
 * `WHERE reviewed_at IS NULL` is decision (a)'s whole safety argument: the
 * second view matches no row, so `updated_at`'s trigger never fires and the
 * dashboard counter is decremented exactly once. `deleted_at IS NULL` keeps
 * a withdrawn session from being quietly marked reviewed by a stale link.
 */
export function markReviewedQuery(db: DbClient, sessionId: string, now: Date) {
  return db
    .update(schema.workoutSessions)
    .set({ reviewedAt: now })
    .where(
      and(
        eq(schema.workoutSessions.id, sessionId),
        isNull(schema.workoutSessions.reviewedAt),
        isNull(schema.workoutSessions.deletedAt),
      ),
    );
}

/**
 * Statement 2 — the session row and the name it falls back to.
 *
 * LEFT, not INNER, on `program_days`: an ad-hoc session has no
 * `program_day_id` at all (§8.4 allows one) and a program day can be
 * deleted out from under a logged session (`ON DELETE SET NULL`). Either
 * way the session still opens — the same reasoning
 * `client-training-history.ts` gives for the list this screen is the detail
 * of.
 *
 * The two INNER joins below it carry decision (e)'s name and zone, so the
 * header costs no statement of its own.
 */
export function sessionQuery(db: DbClient, sessionId: string) {
  return (
    db
      .select({
        sessionId: schema.workoutSessions.id,
        clientId: schema.workoutSessions.clientId,
        // Decision (e) — the two identity fields, from the column
        // `v_client_overview.name` itself projects, without the view's seven
        // correlated counts.
        clientName: schema.users.name,
        clientTimezone: schema.users.timezone,
        scheduledDate: schema.workoutSessions.scheduledDate,
        sessionName: schema.workoutSessions.name,
        programDayName: schema.programDays.name,
        status: schema.workoutSessions.status,
        startedAt: schema.workoutSessions.startedAt,
        completedAt: schema.workoutSessions.completedAt,
        durationSeconds: schema.workoutSessions.durationSeconds,
        totalVolumeKg: schema.workoutSessions.totalVolumeKg,
        perceivedExertion: schema.workoutSessions.perceivedExertion,
        clientNotes: schema.workoutSessions.clientNotes,
        skipReason: schema.workoutSessions.skipReason,
        reviewedAt: schema.workoutSessions.reviewedAt,
        // Decision (c2)'s only input — the day whose `order_index` places a skip.
        programDayId: schema.workoutSessions.programDayId,
      })
      .from(schema.workoutSessions)
      .leftJoin(schema.programDays, eq(schema.programDays.id, schema.workoutSessions.programDayId))
      // INNER on both: `workout_sessions.client_id` and `client_profiles.user_id`
      // are `NOT NULL` and neither FK can go away under a logged session
      // (`ON DELETE RESTRICT` / `CASCADE` respectively), so a session that
      // exists always has the person who trained it.
      .innerJoin(
        schema.clientProfiles,
        eq(schema.clientProfiles.id, schema.workoutSessions.clientId),
      )
      .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
      .where(
        and(eq(schema.workoutSessions.id, sessionId), isNull(schema.workoutSessions.deletedAt)),
      )
      .limit(1)
  );
}

/**
 * Statement 3 — every set of the session, with the exercise's name
 * resolved here rather than on the device.
 *
 * `ORDER BY logged_at, set_number, id` is decision (b) made concrete: the
 * first key gives the groups their performed order, the second orders the
 * sets inside a group when a whole set of them synced in one batch and
 * share an instant, and `id` (uuidv7, time-ordered) breaks the remaining
 * tie so the response is stable across two identical calls.
 *
 * INNER on `exercises`: `set_logs.exercise_id` is `NOT NULL` with `ON
 * DELETE RESTRICT`, so a logged set always has its library row.
 */
export function setsQuery(db: DbClient, sessionId: string) {
  return (
    db
      .select({
        setLogId: schema.setLogs.id,
        exerciseId: schema.setLogs.exerciseId,
        exerciseName: schema.exercises.name,
        setNumber: schema.setLogs.setNumber,
        reps: schema.setLogs.reps,
        weightKg: schema.setLogs.weightKg,
        rpe: schema.setLogs.rpe,
        rir: schema.setLogs.rir,
        durationSeconds: schema.setLogs.durationSeconds,
        distanceM: schema.setLogs.distanceM,
        estimated1rmKg: schema.setLogs.estimated1rmKg,
        isWarmup: schema.setLogs.isWarmup,
        isFailure: schema.setLogs.isFailure,
        notes: schema.setLogs.notes,
        loggedAt: schema.setLogs.loggedAt,
      })
      .from(schema.setLogs)
      .innerJoin(schema.exercises, eq(schema.exercises.id, schema.setLogs.exerciseId))
      // A set the client withdrew is not work they did — the same predicate
      // `recomputeSessionVolume` applies, so the sets shown and the volume
      // stated are computed over the same rows.
      .where(and(eq(schema.setLogs.workoutSessionId, sessionId), isNull(schema.setLogs.deletedAt)))
      .orderBy(asc(schema.setLogs.loggedAt), asc(schema.setLogs.setNumber), asc(schema.setLogs.id))
  );
}

/**
 * Statement 4 — every record on the page, in one grouped read.
 *
 * **"Records this set took and the client still holds", not "records beaten
 * on the day".** `personal_records` holds only the CURRENT record per
 * `(client, exercise, record_type)` (DB§5.2), credited to the `set_log` that
 * reached it, so joining through `set_log_id` answers the first question and
 * cannot answer the second. That is the same meaning `personal-records/02`
 * fixed for the client's own session summary and
 * `client-training-history.ts` for the row that opened this screen; three
 * surfaces must not count differently.
 *
 * Scoped by `client_id` as well as by set id — redundant (every set here is
 * this client's) and it is what puts the planner on
 * `personal_records_client_id_exercise_id_record_type_unique` rather than
 * on a scan.
 */
export function personalRecordsQuery(db: DbClient, clientProfileId: string, setLogIds: string[]) {
  return db
    .select({
      setLogId: schema.personalRecords.setLogId,
      recordType: schema.personalRecords.recordType,
    })
    .from(schema.personalRecords)
    .where(
      and(
        eq(schema.personalRecords.clientId, clientProfileId),
        inArray(schema.personalRecords.setLogId, setLogIds),
      ),
    );
}

/**
 * Statement 5, and the only conditional one — the day's prescription: the
 * order that places a skip (decision (c2)) and the target scheme each
 * performed group was asked for (decision (f)).
 *
 * Issued **only** when the session has a `program_day_id`, and then exactly
 * once however many blocks, skips or sets it has. It answers both questions
 * because both are the same rows: a second read scoped to the same
 * `program_day_id` would be a sixth statement for a table this one has
 * already scanned.
 *
 * The LIVE program day, not `program_snapshot`: `complete.ts` sets the
 * snapshot back to `null` on the statement that completes a session
 * (decision (g) there), so the sessions a coach reviews are exactly the
 * sessions that no longer have one. The live day is the only prescription
 * left, and under the live-reference model (`../programs/versioning.md`,
 * `CLAUDE.md` §27) it is the program as it stands — a coach who reordered
 * the day since sees the skip at its new position, which is the same
 * trade-off every other program-derived read in the API already makes.
 *
 * INNER on `exercises`: `program_exercises.exercise_id` is `NOT NULL` with
 * `ON DELETE RESTRICT`, so a prescribed block always has its library row.
 */
export function prescriptionQuery(db: DbClient, programDayId: string) {
  return db
    .select({
      exerciseId: schema.programExercises.exerciseId,
      exerciseName: schema.exercises.name,
      orderIndex: schema.programExercises.orderIndex,
      targetSets: schema.programExercises.targetSets,
      targetRepsMin: schema.programExercises.targetRepsMin,
      targetRepsMax: schema.programExercises.targetRepsMax,
      targetRpe: schema.programExercises.targetRpe,
      targetRir: schema.programExercises.targetRir,
      targetWeightKg: schema.programExercises.targetWeightKg,
      targetPercent1rm: schema.programExercises.targetPercent1rm,
      targetRestSeconds: schema.programExercises.targetRestSeconds,
      tempo: schema.programExercises.tempo,
    })
    .from(schema.programExercises)
    .innerJoin(schema.exercises, eq(schema.exercises.id, schema.programExercises.exerciseId))
    .where(eq(schema.programExercises.programDayId, programDayId))
    .orderBy(asc(schema.programExercises.orderIndex));
}

/**
 * The scales `program_blocks.ts` parses the same three columns at, restated
 * rather than imported so the two files are visibly the same decision — a
 * coach and their client must read one number, and `numeric(_,1)` parsed at
 * scale 2 would show `8.00` on one side of the product (`code-conventions`
 * §3's numeric trap).
 */
const INTENSITY_SCALE = 1;
const WEIGHT_SCALE = 2;

/** One prescribed row turned into the shape `formatTargetScheme` takes, numerics parsed once. */
function toExerciseTarget(row: {
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetRpe: string | null;
  targetRir: number | null;
  targetWeightKg: string | null;
  targetPercent1rm: string | null;
  targetRestSeconds: number | null;
  tempo: string | null;
}): ExerciseTarget {
  return {
    targetSets: row.targetSets,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetRpe: row.targetRpe === null ? null : parseNumeric(row.targetRpe, INTENSITY_SCALE),
    targetRir: row.targetRir,
    targetWeightKg:
      row.targetWeightKg === null ? null : parseNumeric(row.targetWeightKg, WEIGHT_SCALE),
    targetPercent1rm:
      row.targetPercent1rm === null ? null : parseNumeric(row.targetPercent1rm, INTENSITY_SCALE),
    targetRestSeconds: row.targetRestSeconds,
    tempo: row.tempo,
  };
}

/** A `record_type` the CHECK constraint allows but this build has never heard of is dropped, not rendered. */
function isRecordType(value: string): value is PersonalRecordType {
  return (PERSONAL_RECORD_TYPES as readonly string[]).includes(value);
}

const RECORD_TYPE_RANK = new Map<PersonalRecordType, number>(
  PERSONAL_RECORD_TYPES.map((type, index) => [type, index]),
);

/** One prescribed block: decision (c2)'s three positioning fields, plus decision (f)'s scheme. */
export interface PrescribedBlock {
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  target: ExerciseTarget;
}

/**
 * Decision (f) applied to the whole session: every performed group given the
 * block it was performed against, or left at `null`.
 *
 * Mutates in place because `interleaveSkips` is about to fold the same
 * objects into one ordered list, and a second array of copies is two things
 * that can disagree.
 */
export function attachTargets(
  performed: SessionReviewExerciseGroup[],
  prescribed: PrescribedBlock[],
): void {
  if (prescribed.length === 0) return;

  const byExerciseId = new Map<string, ExerciseTarget>();
  for (const block of prescribed) {
    // First occurrence wins — `prescriptionQuery` returns `order_index`
    // ascending, and decision (f)'s back-off case names the earlier block.
    if (!byExerciseId.has(block.exerciseId)) byExerciseId.set(block.exerciseId, block.target);
  }

  for (const group of performed) {
    // A swap is the prescribed SLOT filled differently, which is enough to
    // position a skip (`interleaveSkips`) and not enough to name a target:
    // the block's reps and load were written for the movement that was
    // replaced (decision (f)).
    if (group.substitutedFor !== null) continue;
    group.target = byExerciseId.get(group.exerciseId) ?? null;
  }
}

/**
 * Decision (c2), in one pass: every skip placed among the work, the work
 * itself never reordered.
 *
 * A skip is emitted immediately before the first performed group prescribed
 * AFTER it. Anything still unplaced when the work runs out is appended —
 * skips whose planned position is later than every performed group first, in
 * prescribed order, then the ones with no planned position at all, in the
 * order their lines appear in `client_notes`.
 *
 * Performed groups' planned indices need not ascend: a client may work the
 * day out of order, and this rule stays well defined when they do, because
 * it only ever asks "is this group prescribed after that skip".
 */
export function interleaveSkips(
  performed: SessionReviewExerciseGroup[],
  skips: SessionReviewSkippedExercise[],
  prescribed: PrescribedBlock[],
): SessionReviewEntry[] {
  if (skips.length === 0) return performed;

  const indexByExerciseId = new Map<string, number>();
  const indexByName = new Map<string, number>();
  for (const block of prescribed) {
    // First occurrence wins. A day may prescribe one movement twice (a
    // back-off block after the main one), and the earlier position is the
    // one a skip of that movement is about — the client never reached the
    // second either.
    if (!indexByExerciseId.has(block.exerciseId)) {
      indexByExerciseId.set(block.exerciseId, block.orderIndex);
    }
    if (!indexByName.has(block.exerciseName)) {
      indexByName.set(block.exerciseName, block.orderIndex);
    }
  }

  // The group's own exercise, else the one it replaced — a swap is still
  // the prescribed slot, filled differently.
  const plannedIndexOf = (group: SessionReviewExerciseGroup): number | undefined =>
    indexByExerciseId.get(group.exerciseId) ??
    (group.substitutedFor === null ? undefined : indexByName.get(group.substitutedFor));

  const pending: { skip: SessionReviewSkippedExercise; at: number }[] = [];
  const unplaceable: SessionReviewSkippedExercise[] = [];
  for (const skip of skips) {
    const at = indexByName.get(skip.exerciseName);
    if (at === undefined) unplaceable.push(skip);
    else pending.push({ skip, at });
  }
  // Stable: `Array.prototype.sort` is specified stable, so two skips
  // prescribed at the same index keep their `client_notes` line order.
  pending.sort((a, b) => a.at - b.at);

  const entries: SessionReviewEntry[] = [];
  let next = 0;
  for (const group of performed) {
    const planned = plannedIndexOf(group);
    if (planned !== undefined) {
      for (let queued = pending[next]; queued !== undefined && queued.at < planned;) {
        entries.push(queued.skip);
        next += 1;
        queued = pending[next];
      }
    }
    entries.push(group);
  }
  for (; next < pending.length; next += 1) {
    const queued = pending[next];
    if (queued !== undefined) entries.push(queued.skip);
  }
  entries.push(...unplaceable);

  return entries;
}

export async function getSessionReview(
  db: DbClient,
  sessionId: string,
  now: Date = new Date(),
): Promise<SessionReview> {
  // Before the read, not after: a coach who opened the screen has reviewed
  // it, and `reviewedAt` in the response is then the value the row actually
  // holds rather than one the resolver predicted.
  await markReviewedQuery(db, sessionId, now);

  const [[session], setRows] = await Promise.all([
    sessionQuery(db, sessionId),
    setsQuery(db, sessionId),
  ]);

  // `ownsResource` ignores `deleted_at` deliberately (`resource-registry.ts`
  // — ownership answers *whose*, not *whether it is still there*), so a
  // withdrawn session passes the guard and falls out here.
  // `NOT_YOUR_CLIENT`, not a distinct "no such session": the two must be
  // indistinguishable or the pair is an enumeration oracle (ER§2.1).
  if (session === undefined) {
    throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
  }

  // Statements 4 and 5, together and only when each can change the answer:
  // the record read needs a set to hang a record on, and the prescription
  // read needs a day to have prescribed one. Neither depends on the other,
  // so they cost one round trip rather than two (decision (f)).
  const [recordRows, prescribed] = await Promise.all([
    setRows.length > 0
      ? personalRecordsQuery(
          db,
          session.clientId,
          setRows.map((row) => row.setLogId),
        )
      : [],
    session.programDayId !== null ? prescriptionQuery(db, session.programDayId) : [],
  ]);

  const recordsBySet = new Map<string, PersonalRecordType[]>();
  for (const row of recordRows) {
    // `personal_records.set_log_id` is nullable (`ON DELETE SET NULL`), so
    // the column's type admits null even though `inArray` cannot match one.
    if (row.setLogId === null || !isRecordType(row.recordType)) continue;
    const existing = recordsBySet.get(row.setLogId);
    if (existing) existing.push(row.recordType);
    else recordsBySet.set(row.setLogId, [row.recordType]);
  }
  for (const types of recordsBySet.values()) {
    types.sort((a, b) => (RECORD_TYPE_RANK.get(a) ?? 0) - (RECORD_TYPE_RANK.get(b) ?? 0));
  }

  // Insertion order IS performed order — `setsQuery` returned the rows
  // sorted by `logged_at`, so a group is created the first time its
  // exercise appears and `Map` preserves that (decision (b)).
  const groups = new Map<string, SessionReviewExerciseGroup>();
  for (const row of setRows) {
    const { substitutedFor, freeText } = parseSetNote(row.notes);

    let group = groups.get(row.exerciseId);
    if (group === undefined) {
      group = {
        kind: 'performed',
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        substitutedFor: null,
        target: null,
        sets: [],
      };
      groups.set(row.exerciseId, group);
    }
    // The line is written on the FIRST set of a substituted exercise only
    // (`useSwapExercise.ts`'s `substitutionNote`), so the first non-null
    // wins and a later set never clears it.
    group.substitutedFor ??= substitutedFor;

    group.sets.push({
      setLogId: row.setLogId,
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: parseNumericOrNull(row.weightKg),
      rpe: parseNumericOrNull(row.rpe),
      rir: row.rir,
      durationSeconds: row.durationSeconds,
      distanceM: parseNumericOrNull(row.distanceM),
      estimated1rmKg: parseNumericOrNull(row.estimated1rmKg),
      isWarmup: row.isWarmup,
      isFailure: row.isFailure,
      notes: freeText,
      loggedAt: row.loggedAt,
      personalRecordTypes: recordsBySet.get(row.setLogId) ?? [],
    });
  }

  const parsedNotes = parseSessionClientNotes(session.clientNotes);
  const freeText = parsedNotes.freeText;
  // `@coachos/utils` owns the note's vocabulary, not this response's shape —
  // the discriminant is added here, at the one boundary that has both.
  const skips: SessionReviewSkippedExercise[] = parsedNotes.skips.map((skip) => ({
    kind: 'skipped',
    ...skip,
  }));
  const performed = [...groups.values()];

  const blocks: PrescribedBlock[] = prescribed.map((row) => ({
    exerciseId: row.exerciseId,
    exerciseName: row.exerciseName,
    orderIndex: row.orderIndex,
    target: toExerciseTarget(row),
  }));
  attachTargets(performed, blocks);

  return {
    sessionId: session.sessionId,
    clientId: session.clientId,
    clientName: session.clientName,
    clientTimezone: session.clientTimezone,
    scheduledDate: session.scheduledDate,
    name: session.sessionName ?? session.programDayName ?? null,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    durationSeconds: session.durationSeconds,
    totalVolumeKg: parseNumericOrNull(session.totalVolumeKg),
    perceivedExertion: session.perceivedExertion,
    clientNotes: freeText,
    // Carried only where it means something. `skip_reason` is NOT NULL for
    // a skipped session by `session_skip_reason`'s CHECK, and stale on any
    // other status.
    skipReason: session.status === 'skipped' ? session.skipReason : null,
    // `markReviewedQuery` ran before the read, so the column is non-null
    // whichever branch set it. The fallback is unreachable in practice and
    // exists so the contract above ("never `null`") is a type, not a hope.
    reviewedAt: session.reviewedAt ?? now,
    exercises: interleaveSkips(performed, skips, blocks),
  };
}
