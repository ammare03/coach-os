import { createHash } from 'node:crypto';

import { schema, type Transaction } from '@coachos/db';
import { addCalendarDays, isoWeekdayOfCalendarDate, type CalendarDate } from '@coachos/utils';
import { asc, eq } from 'drizzle-orm';

// `assignment/03-session-materialisation.md` — the single highest-risk task
// in P07. Turns an assignment's program day/week structure into real
// `training.workout_sessions` rows on the client's own local calendar.
// Called once, from `createAssignment` (`../features/assignments/create-assignment.ts`),
// inside the SAME transaction as the assignment insert (see "Transactionality"
// below) — never on its own `db.transaction`.
//
// Five decisions this file makes and documents, because the task explicitly
// requires each to be resolved in code rather than left ambiguous:
//
// (a) day_number -> calendar date: WEEKDAY-ALIGNED, not a sequential offset.
//     `program_days.day_number` is CHECKed 1-7 (DB§5.2), and the product
//     reading of a "1-7" system is Monday=1 ... Sunday=7 — see
//     `calendarDateForProgramDay` below. A program starting mid-week gets a
//     SHORT FIRST WEEK: any day_number in week 1 that falls before
//     start_date's own weekday has already passed and materialises no
//     session at all (not a session dated in the past). Week 2 onward
//     always runs Monday through day_number 7, in full.
//
// (b) `client_local_id`: set DETERMINISTICALLY (uuidv5 of client/assignment/
//     scheduled-date), NOT null, contradicting this task's own Approach
//     step 5 ("server-generated sessions have no offline-idempotency need").
//     That framing is wrong for exactly the reason `training.ts`'s own
//     column comment gives: DB§14.5 documents `client_local_id` as
//     "DETERMINISTIC for scheduled sessions: uuidv5(client_id,
//     assignment_id, scheduled_date), so two devices produce the SAME key
//     and upsert one row." A materialised session is not a one-off
//     server-only row — it is the exact row `phase-08-offline-core`'s
//     prefetch caches onto the client's device, and the row the client's
//     own offline outbox will later try to UPSERT against (e.g. when the
//     client starts this session, or logs a set on it, while offline). If
//     that upsert's `ON CONFLICT (client_id, client_local_id)` target is
//     NULL here, the device's independently-and-deterministically-computed
//     key can never match this row, so the offline write either misses it
//     entirely or — worse — creates a second, duplicate session for the
//     same scheduled day. `sessions_client_day_unique` (the partial index
//     on `(client_id, program_day_id, scheduled_date)`) is real second-line
//     defence, but it is exactly that: a *second* line, not a substitute
//     for the first. The schema comment is both more specific (it names
//     this exact column, in this exact table) and more recently reasoned
//     (DB§14.5) than the task file's Approach step, so it is what this file
//     follows. `computeSessionClientLocalId` below is the exact formula —
//     match it bit-for-bit if `phase-08-offline-core` ever needs to derive
//     the same key client-side.
//
// (c) What materialisation must NOT write: a materialised session is a
//     SHELL. No target/prescription field (sets, reps, RPE, weight, tempo,
//     …) is copied onto the session — not even the day's own `name` — all
//     of that resolves LIVE through `program_day_id` at read time
//     (`../features/programs/versioning.md`'s live-reference decision).
//     `total_volume_kg` stays null (computed on completion, DB§8.3).
//     `program_snapshot` stays null: DB§14.6 documents it as "the
//     prescription frozen at START", written only when a client actually
//     starts a session, never at scheduling time. `assignment/04` audits
//     exactly this.
//
// (d) Where timezone matters, and where it very deliberately does not:
//     `assignments.start_date` and `workout_sessions.scheduled_date` are
//     both `date` columns holding CLIENT-LOCAL CALENDAR DAYS already (DB§5.2,
//     CLAUDE.md §17.4) — there is no UTC instant anywhere in the walk from
//     `start_date` through the program's week/day structure, so that walk
//     is pure calendar arithmetic (`addCalendarDays`/`isoWeekdayOfCalendarDate`,
//     `packages/utils`) and needs no timezone conversion at all. Running it
//     through `toLocalDate`/`localDateRangeUtc` (which convert a UTC
//     *instant*) would be a no-op at best and a redundant, bug-inviting
//     detour at worst — precisely the "sprinkling timezone conversions
//     where they do nothing" anti-pattern this file exists to avoid. The
//     client's `users.timezone` IS still read below, for two real reasons
//     that are not the date math: (1) so this file can never be accused of
//     silently defaulting to the coach's or the server's zone — the read
//     happens, and is asserted non-empty, even though today's arithmetic
//     doesn't consume the value; (2) a materialisation that ever needs a
//     "is this date in the client's past" comparison (this task does not)
//     would need it, and the shape is already here to extend. This file's
//     test suite proves the point directly: the SAME `start_date` and
//     program structure produce byte-identical `scheduled_date` output no
//     matter which timezone the client is in.
//
// (e) Transactionality and re-materialisation: `materialiseSessions` never
//     opens its own transaction — it takes `tx` with no default, exactly
//     `writeAuditLog`'s rule (`../lib/audit-log.ts`) — so a failure partway
//     through can never leave some of an assignment's sessions written and
//     others missing; the whole batch commits or rolls back with whatever
//     else `tx` is doing (in practice, the assignment insert itself: see
//     `../features/assignments/create-assignment.ts`). Running this
//     function TWICE for the same `assignmentId` is not silently
//     idempotent: the second run recomputes the identical set of
//     `scheduled_date` values and its `INSERT` collides with
//     `sessions_client_day_unique`, aborting the whole enclosing
//     transaction with a raw 23505. That is deliberate — a second call for
//     an assignment that already has sessions is a caller bug, and it
//     should fail loud, not silently no-op or duplicate. A program EDIT
//     never triggers re-materialisation: live-reference means an edited
//     program's content is already visible on next read through the
//     existing sessions' `program_day_id`, so there is nothing to
//     re-materialise (`../features/programs/versioning.md`). There is also
//     currently no procedure that changes an already-created assignment's
//     `start_date`, so the "what if start_date changes" case doesn't yet
//     arise — if one is ever added, it would need to archive/replace the
//     affected sessions explicitly, which is `assignment/04`'s or a later
//     task's concern, not this file's.

/**
 * A fixed namespace UUID for `computeSessionClientLocalId` below, scoped
 * ONLY to `training.workout_sessions.client_local_id` for materialised
 * sessions — never reused for any other uuidv5 use case. Deliberately a
 * DIFFERENT constant from `packages/db/src/seed/lib/deterministic-id.ts`'s
 * `SEED_NAMESPACE`, whose own comment reserves it "never reused for
 * anything else"; this file mints its own for the same reason, and does
 * not import the seed module — seed code is dev/ops tooling with its own
 * determinism contract (byte-identical `pnpm db:seed` output), not part of
 * this package's runtime surface.
 */
const SESSION_CLIENT_LOCAL_ID_NAMESPACE = '7c1d9f2a-4e6b-5a3c-8d21-0f7b6c9e4a52';

function parseUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * uuidv5(SESSION_CLIENT_LOCAL_ID_NAMESPACE, `${clientId}:${assignmentId}:${scheduledDate}`)
 * — DB§14.5's exact formula. RFC 4122 §4.3: SHA-1 of namespace bytes + name
 * bytes, with the version/variant nibbles stamped over the hash's first 16
 * bytes. Same `clientId`/`assignmentId`/`scheduledDate` in -> same uuid out,
 * on every machine, forever — the whole point (decision (b) above). This is
 * intentionally the same small, dependency-free algorithm
 * `packages/db/src/seed/lib/deterministic-id.ts` uses, reimplemented here
 * rather than imported (see that decision's note on why), and it MUST stay
 * bit-for-bit reproducible: `phase-08-offline-core` will need to compute
 * this exact value client-side to upsert against a materialised session.
 */
export function computeSessionClientLocalId(
  clientId: string,
  assignmentId: string,
  scheduledDate: CalendarDate,
): string {
  const namespaceBytes = parseUuid(SESSION_CLIENT_LOCAL_ID_NAMESPACE);
  const nameBytes = Buffer.from(`${clientId}:${assignmentId}:${scheduledDate}`, 'utf8');
  const hash = createHash('sha1').update(namespaceBytes).update(nameBytes).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // variant RFC 4122

  return formatUuid(bytes);
}

/**
 * Maps one `program_days` row (identified by its week's `weekNumber` and
 * its own `dayNumber`) to the calendar date it lands on, given the
 * assignment's `startDate`. Decision (a)'s formula: `dayNumber` is a real
 * ISO weekday (1 = Monday … 7 = Sunday, matching `program_days_day_number_check`'s
 * own 1-7 bound), aligned so that week 1's Monday is the Monday of the
 * calendar week `startDate` falls in — which is `startDate` itself only
 * when `startDate` happens to be a Monday.
 *
 * Returns `null` for a week-1 `dayNumber` that falls before `startDate`'s
 * own weekday: that day has already passed by the time the program starts,
 * so week 1 is intentionally SHORT rather than scheduling a session in the
 * client's past. Every later week (weekNumber >= 2) always runs the full
 * Monday-to-`dayNumber` span.
 */
export function calendarDateForProgramDay(
  startDate: CalendarDate,
  weekNumber: number,
  dayNumber: number,
): CalendarDate | null {
  const startWeekday = isoWeekdayOfCalendarDate(startDate);
  if (weekNumber === 1 && dayNumber < startWeekday) return null;

  const mondayOfWeekOne = addCalendarDays(startDate, -(startWeekday - 1));
  const mondayOfThisWeek = addCalendarDays(mondayOfWeekOne, 7 * (weekNumber - 1));
  return addCalendarDays(mondayOfThisWeek, dayNumber - 1);
}

/**
 * One materialised session, returned so a caller/test can assert on the
 * batch without a second read. `sessionId` rather than `id`, matching
 * `copy-program-days.ts`'s `DayCopyResult` precedent — an object literal
 * with a bare `id` field reads as a hand-written database row type
 * (`local/no-hand-written-row-type`), and this is a result, not a row.
 */
export interface MaterialisedSession {
  sessionId: string;
  programDayId: string;
  weekNumber: number;
  dayNumber: number;
  scheduledDate: CalendarDate;
}

/**
 * Reads an assignment's `program_id`/`start_date`/`client_id`, the client's
 * timezone (decision (d): read, asserted, and deliberately not threaded
 * into the date math), and the program's full week/day structure, then
 * writes one `workout_sessions` shell row (decision (c)) per non-rest day,
 * all inside the caller's `tx`.
 */
export async function materialiseSessions(
  tx: Transaction,
  assignmentId: string,
): Promise<MaterialisedSession[]> {
  const [assignment] = await tx
    .select({
      id: schema.assignments.id,
      programId: schema.assignments.programId,
      clientId: schema.assignments.clientId,
      startDate: schema.assignments.startDate,
    })
    .from(schema.assignments)
    .where(eq(schema.assignments.id, assignmentId))
    .limit(1);
  if (!assignment) {
    throw new Error(`materialiseSessions: no training.assignments row for id "${assignmentId}"`);
  }

  const [client] = await tx
    .select({
      coachId: schema.clientProfiles.coachId,
      timezone: schema.users.timezone,
    })
    .from(schema.clientProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.clientProfiles.userId))
    .where(eq(schema.clientProfiles.id, assignment.clientId))
    .limit(1);
  if (!client) {
    throw new Error(
      `materialiseSessions: no training.client_profiles row for id "${assignment.clientId}"`,
    );
  }
  // Decision (d): read from the client's own row, never defaulted from the
  // coach or the server process — asserted non-empty and then, correctly,
  // not used below. `users.timezone` is NOT NULL with a default of 'UTC'
  // (identity-schema/01), so this should never fire; it exists as the loud
  // failure this file's whole risk profile (CLAUDE.md §25.5) calls for over
  // a silent wrong-date bug.
  if (!client.timezone) {
    throw new Error(
      `materialiseSessions: client "${assignment.clientId}" has no timezone recorded`,
    );
  }

  const days = await tx
    .select({
      programDayId: schema.programDays.id,
      weekNumber: schema.programWeeks.weekNumber,
      dayNumber: schema.programDays.dayNumber,
      isRestDay: schema.programDays.isRestDay,
    })
    .from(schema.programDays)
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .where(eq(schema.programWeeks.programId, assignment.programId))
    .orderBy(asc(schema.programWeeks.weekNumber), asc(schema.programDays.dayNumber));

  const toInsert: (typeof schema.workoutSessions.$inferInsert)[] = [];
  const materialised: MaterialisedSession[] = [];

  for (const day of days) {
    if (day.isRestDay) continue; // rest days materialise no session (DB§5.2, in scope)

    const scheduledDate = calendarDateForProgramDay(
      assignment.startDate,
      day.weekNumber,
      day.dayNumber,
    );
    if (scheduledDate === null) continue; // short first week (decision (a))

    const clientLocalId = computeSessionClientLocalId(
      assignment.clientId,
      assignment.id,
      scheduledDate,
    );

    toInsert.push({
      clientId: assignment.clientId,
      coachId: client.coachId,
      assignmentId: assignment.id,
      programDayId: day.programDayId,
      scheduledDate,
      status: 'scheduled',
      clientLocalId,
      // Everything else — name, totalVolumeKg, programSnapshot, and every
      // started/completed/reviewed field — stays at its column default
      // (null), per decision (c). Never set here.
    });
    materialised.push({
      sessionId: '', // filled in below, matched back by programDayId — see the note above the INSERT
      programDayId: day.programDayId,
      weekNumber: day.weekNumber,
      dayNumber: day.dayNumber,
      scheduledDate,
    });
  }

  if (toInsert.length === 0) return [];

  // Matched back by `programDayId` rather than by RETURNING position —
  // `copy-program-days.ts`'s own rule: "a multi-row INSERT … RETURNING
  // returns in VALUES order in practice, and 'in practice' is not a thing
  // to hang a copy's correctness on." `programDayId` is unique within this
  // batch (the loop above visits each `program_days` row at most once), so
  // it is a safe join key.
  const inserted = await tx.insert(schema.workoutSessions).values(toInsert).returning({
    id: schema.workoutSessions.id,
    programDayId: schema.workoutSessions.programDayId,
  });
  const insertedByProgramDayId = new Map(inserted.map((row) => [row.programDayId, row.id]));

  return materialised.map((session) => {
    const sessionId = insertedByProgramDayId.get(session.programDayId);
    if (!sessionId) {
      throw new Error(
        `insert into training.workout_sessions did not return a row for program day "${session.programDayId}"`,
      );
    }
    return { ...session, sessionId };
  });
}
