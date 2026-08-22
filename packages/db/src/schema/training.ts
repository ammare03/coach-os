// Drizzle tables for the `training` Postgres schema (DATABASE.md DB§5.2) —
// exercises, programs, assignments, workout_sessions, set_logs, and
// personal_records. Transcribed column-for-column, constraint-for-constraint;
// where this file and DATABASE.md ever disagree, DATABASE.md is the bug
// (CLAUDE.md §0, phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, trainingSchema } from './_shared.ts';
// `demo_asset_id` below references `coaching.media_assets(id)` per DB§5.2.
// That table didn't exist when this file was first written
// (training-schema/01), so it was declared as a plain `uuid` column with no
// `.references()`. coaching-schema/01 resolves it for real now that
// `./coaching.ts` exists, using the same `(): AnyPgColumn => …` thunk
// `identity.coach_profiles.parent_coach_id` uses for its self-reference —
// safe despite the resulting circular import (training.ts ⇄ coaching.ts)
// because the thunk is never called until Drizzle resolves the FK, by which
// point both modules have finished loading.
import { mediaAssets } from './coaching.ts';
import { assignmentStatus, movementPattern, sessionStatus } from './enums.ts';
import { clientProfiles, coachProfiles } from './identity.ts';

// `tsvector` has no built-in Drizzle column type — this is `customType`'s
// documented use case (identity-schema/01's `citext`, same pattern).
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const exercises = trainingSchema.table(
  'exercises',
  {
    ...id,
    // NULL = global library. A coach id = a coach-custom exercise, cascading
    // on the owning coach's deletion so custom exercises don't outlive their
    // creator (DB§5.2).
    coachId: uuid('coach_id').references(() => coachProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    aliases: text('aliases').array().notNull().default([]),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: text('secondary_muscles').array().notNull().default([]),
    equipment: text('equipment').notNull(), // open-ended value set stays text, not an enum — DB§4
    movementPattern: movementPattern('movement_pattern').notNull(),
    demoAssetId: uuid('demo_asset_id').references((): AnyPgColumn => mediaAssets.id, {
      onDelete: 'set null',
    }),
    cues: text('cues').array().notNull().default([]),
    isUnilateral: boolean('is_unilateral').notNull().default(false),
    isBodyweight: boolean('is_bodyweight').notNull().default(false),
    // Plate math, §8.4 — the increment `phase-09-workout-logger/set-entry/02`'s
    // plate calculator reads. Nullable with a default, matching DB§5.2 exactly
    // (no NOT NULL on this column).
    defaultIncrementKg: numeric('default_increment_kg', { precision: 4, scale: 2 }).default('2.5'),
    // Postgres STORED generated column — computed automatically on every
    // insert/update from `name` and `aliases`, never written to directly by
    // application code. DB§5.2's literal expression calls `array_to_string`
    // directly, but that built-in is STABLE, not IMMUTABLE (`pg_proc`), and
    // Postgres rejects any non-immutable function in a generated column's
    // expression outright — "generation expression is not immutable" — no
    // matter how the call is written (training-schema/01, a genuine DDL bug
    // in DATABASE.md, fixed here per CLAUDE.md §0). The fix routes through
    // `training.immutable_array_to_string`, a one-line SQL wrapper declared
    // IMMUTABLE (added by hand to this task's migration — Drizzle has no
    // `pgFunction` primitive), which produces byte-for-byte the same output
    // as the literal spec for every input. Get this expression right now:
    // a generated column's expression can't be altered without recreating
    // the column (DB§5.2's own risk note).
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, name || ' ' || training.immutable_array_to_string(aliases,' '))`,
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // `coach_id` is nullable, and a plain unique index treats NULL as
    // distinct from every other NULL — two global exercises with the same
    // name would not collide under a naive (coach_id, name) index. Coalescing
    // to a sentinel zero-UUID makes all global exercises share one
    // comparable value, so uniqueness applies within the global library as a
    // group, and separately within each coach's custom set. `lower(name)`
    // makes it case-insensitive (DB§5.2).
    coachNameUnique: uniqueIndex('exercises_coach_name')
      .on(
        sql`coalesce(${t.coachId}, '00000000-0000-0000-0000-000000000000')`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.archivedAt} IS NULL`),
    // Two search strategies coexisting deliberately (DB§22): full-text
    // handles whole-word and stemmed matches, trigram handles typos and
    // partial substring matches.
    searchIdx: index('exercises_search').using('gin', t.searchVector),
    trgmIdx: index('exercises_trgm').using('gin', t.name.op('gin_trgm_ops')),
  }),
);

export const programs = trainingSchema.table(
  'programs',
  {
    ...id,
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    durationWeeks: smallint('duration_weeks').notNull(),
    isTemplate: boolean('is_template').notNull().default(true),
    version: integer('version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    durationWeeksBound: check(
      'programs_duration_weeks_check',
      sql`${t.durationWeeks} BETWEEN 1 AND 104`,
    ),
    // DB§7: every FK is indexed, no exceptions.
    coachIdIdx: index('programs_coach_id_idx').on(t.coachId),
  }),
);

export const programWeeks = trainingSchema.table(
  'program_weeks',
  {
    ...id,
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    weekNumber: smallint('week_number').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    weekNumberPositive: check('program_weeks_week_number_check', sql`${t.weekNumber} > 0`),
    // A program cannot have two "week 3"s. Also satisfies DB§7's "every FK
    // is indexed" for program_id — this leads with it.
    programWeekUnique: uniqueIndex('program_weeks_program_id_week_number_unique').on(
      t.programId,
      t.weekNumber,
    ),
  }),
);

export const programDays = trainingSchema.table(
  'program_days',
  {
    ...id,
    programWeekId: uuid('program_week_id')
      .notNull()
      .references(() => programWeeks.id, { onDelete: 'cascade' }),
    dayNumber: smallint('day_number').notNull(),
    name: text('name').notNull(), // coach-facing label, e.g. 'Push A'
    notes: text('notes'),
    isRestDay: boolean('is_rest_day').notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    dayNumberBound: check('program_days_day_number_check', sql`${t.dayNumber} BETWEEN 1 AND 7`),
    // A week cannot have two "day 3"s — scoped to the WEEK, not the program
    // (a mistake here would silently prevent every program from having a
    // "day 1" in more than one week). Also satisfies DB§7's FK-indexing rule
    // for program_week_id.
    weekDayUnique: uniqueIndex('program_days_program_week_id_day_number_unique').on(
      t.programWeekId,
      t.dayNumber,
    ),
  }),
);

export const programExercises = trainingSchema.table(
  'program_exercises',
  {
    ...id,
    programDayId: uuid('program_day_id')
      .notNull()
      .references(() => programDays.id, { onDelete: 'cascade' }),
    // RESTRICT, unlike this table's other three FKs (all cascade): an
    // exercise referenced by a program cannot be deleted out from under it.
    // This is why the exercise-library feature's archive behaviour uses
    // `archived_at` rather than deletion (P07).
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: smallint('order_index').notNull(),
    targetSets: smallint('target_sets').notNull(),
    targetRepsMin: smallint('target_reps_min'),
    targetRepsMax: smallint('target_reps_max'),
    targetRpe: numeric('target_rpe', { precision: 3, scale: 1 }),
    targetRir: smallint('target_rir'),
    targetWeightKg: numeric('target_weight_kg', { precision: 6, scale: 2 }),
    targetPercent1rm: numeric('target_percent_1rm', { precision: 4, scale: 1 }),
    targetRestSeconds: smallint('target_rest_seconds'),
    tempo: text('tempo'), // 4-digit eccentric/pause/concentric/pause, e.g. '3010' — CLAUDE.md §26
    supersetGroup: text('superset_group'),
    // Coach-approved swap list, §8.4 — `phase-09-workout-logger/
    // session-modifications/02` reads this when a client swaps an exercise
    // mid-session. No array-element FK: Postgres doesn't support one: the
    // application layer (`phase-07-exercise-and-program-authoring/
    // program-builder/05`) is responsible for only ever writing real
    // exercise ids here (DB§5.2's own documented gap).
    alternatives: uuid('alternatives').array().notNull().default([]),
    coachNotes: text('coach_notes'),
    ...timestamps,
  },
  (t) => ({
    targetSetsBound: check(
      'program_exercises_target_sets_check',
      sql`${t.targetSets} BETWEEN 1 AND 20`,
    ),
    targetRepsMinPositive: check(
      'program_exercises_target_reps_min_check',
      sql`${t.targetRepsMin} > 0`,
    ),
    // Genuine cross-column CHECK, not two independent single-column checks.
    targetRepsMaxGteMin: check(
      'program_exercises_target_reps_max_check',
      sql`${t.targetRepsMax} >= ${t.targetRepsMin}`,
    ),
    targetRpeBound: check(
      'program_exercises_target_rpe_check',
      sql`${t.targetRpe} BETWEEN 1 AND 10`,
    ),
    targetRirBound: check(
      'program_exercises_target_rir_check',
      sql`${t.targetRir} BETWEEN 0 AND 10`,
    ),
    targetPercent1rmBound: check(
      'program_exercises_target_percent_1rm_check',
      sql`${t.targetPercent1rm} BETWEEN 1 AND 150`,
    ),
    tempoFormat: check('program_exercises_tempo_check', sql`${t.tempo} ~ '^[0-9X]{4}$'`),
    supersetGroupFormat: check(
      'program_exercises_superset_group_check',
      sql`${t.supersetGroup} ~ '^[A-Z]$'`,
    ),
    // An exercise's order within a day is unique. Also satisfies DB§7's
    // FK-indexing rule for program_day_id.
    dayOrderUnique: uniqueIndex('program_exercises_program_day_id_order_index_unique').on(
      t.programDayId,
      t.orderIndex,
    ),
    // DB§7: every FK is indexed, no exceptions — dayOrderUnique above
    // covers program_day_id but not this one.
    exerciseIdIdx: index('program_exercises_exercise_id_idx').on(t.exerciseId),
  }),
);

export const assignments = trainingSchema.table(
  'assignments',
  {
    ...id,
    // An assigned program cannot be deleted while the assignment references
    // it (DB§5.2).
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    currentWeek: smallint('current_week').notNull().default(1),
    status: assignmentStatus('status').notNull().default('active'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // Only one active assignment per client at a time. A client with a
    // 'paused' assignment and a newly created 'active' one is valid and
    // common (pausing one program to start another) — this index places no
    // restriction on how many paused or completed assignments exist, only
    // that at most one may be 'active'.
    oneActive: uniqueIndex('assignments_one_active')
      .on(t.clientId)
      .where(sql`${t.status} = 'active'`),
    // DB§7: every FK is indexed, no exceptions — none of these three share a
    // leading column with oneActive above (a different column, and partial).
    programIdIdx: index('assignments_program_id_idx').on(t.programId),
    clientIdIdx: index('assignments_client_id_idx').on(t.clientId),
    coachIdIdx: index('assignments_coach_id_idx').on(t.coachId),
  }),
);

export const workoutSessions = trainingSchema.table(
  'workout_sessions',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    // Denormalised, DB§6 — duplicates client_id -> client_profiles.coach_id
    // so `phase-02-api-foundation/authorization-middleware/03-owns-resource.md`
    // can check "does this coach own this session's client" in one indexed
    // lookup instead of a join. Set on INSERT only, from the parent, inside
    // the same transaction. Guarded by `workout_sessions_no_owner_change`
    // (derived-data/02, migrations/0022_guard_triggers.sql) — an UPDATE
    // outside a transaction with `SET LOCAL app.allow_owner_change = true`
    // is rejected.
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    // A session survives its assignment being removed; ad-hoc sessions (no
    // assignment at all) are allowed per §8.4.
    assignmentId: uuid('assignment_id').references(() => assignments.id, { onDelete: 'set null' }),
    programDayId: uuid('program_day_id').references(() => programDays.id, {
      onDelete: 'set null',
    }),
    name: text('name'),
    // CLIENT-LOCAL calendar day — deliberately `date`, never `timestamptz`.
    // CLAUDE.md §17.4 and §25.5 both flag this as the number-one source of
    // bugs in every fitness app ever built: a workout logged at 00:30 in a
    // positive-UTC-offset timezone belongs to the client's local day, and a
    // timestamp invites naive UTC-boundary math that gets that day wrong.
    scheduledDate: date('scheduled_date').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    perceivedExertion: smallint('perceived_exertion'),
    clientNotes: text('client_notes'),
    status: sessionStatus('status').notNull().default('scheduled'),
    skipReason: text('skip_reason'),
    // Denormalised aggregate, DB§8.3 — maintained by application code inside
    // the same transaction as the write that changes it, never by trigger
    // (DB§8.2: needs business logic — which sets count, how warmups are
    // excluded — that doesn't belong in plpgsql).
    totalVolumeKg: numeric('total_volume_kg', { precision: 10, scale: 2 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }), // coach opened it
    // Offline idempotency, DB§14. Nullable here (unlike set_logs' NOT NULL
    // counterpart, task 04) — DETERMINISTIC for scheduled sessions:
    // uuidv5(client_id, assignment_id, scheduled_date), so two devices
    // produce the SAME key and upsert one row (DB§14.5).
    clientLocalId: text('client_local_id'),
    activeDeviceId: text('active_device_id'), // session claim, DB§14.5
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // The prescription frozen at start. A coach's mid-session edit lands on
    // the NEXT session, never this one (DB§14.6).
    programSnapshot: jsonb('program_snapshot'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    sessionCompletion: check(
      'session_completion',
      sql`${t.status} <> 'completed' OR (${t.startedAt} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`,
    ),
    sessionSkipReason: check(
      'session_skip_reason',
      sql`${t.status} <> 'skipped' OR ${t.skipReason} IS NOT NULL`,
    ),
    // DB§14's exact idempotency mechanism: the server's write path does
    // INSERT ... ON CONFLICT (client_id, client_local_id) DO UPDATE, which
    // only works because this index exists to conflict against. Compound on
    // BOTH columns, not client_local_id alone — the value is only unique
    // within one client's own mutation stream, since it's generated
    // independently on each device.
    clientLocalUnique: uniqueIndex('sessions_client_local')
      .on(t.clientId, t.clientLocalId)
      .where(sql`${t.clientLocalId} IS NOT NULL`),
    // Second line of defence for the two-device case (DB§14.5): even if a
    // device somehow generates a non-deterministic key, one scheduled
    // program day per client per date can only ever produce one session row.
    clientDayUnique: uniqueIndex('sessions_client_day_unique')
      .on(t.clientId, t.programDayId, t.scheduledDate)
      .where(sql`${t.programDayId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    // DB§7: every FK is indexed, no exceptions. Both unique indexes above
    // are PARTIAL, so neither one satisfies this rule on its own (matching
    // identity.ts's invites_pending precedent) — every FK here gets its own
    // plain index.
    clientIdIdx: index('workout_sessions_client_id_idx').on(t.clientId),
    coachIdIdx: index('workout_sessions_coach_id_idx').on(t.coachId),
    assignmentIdIdx: index('workout_sessions_assignment_id_idx').on(t.assignmentId),
    programDayIdIdx: index('workout_sessions_program_day_id_idx').on(t.programDayId),
  }),
);

export const setLogs = trainingSchema.table(
  'set_logs',
  {
    ...id,
    // A set has no meaning independent of its session.
    workoutSessionId: uuid('workout_session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    // RESTRICT, matching program_exercises's pattern (task 02) — an exercise
    // logged in history cannot be deleted out from under it.
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    // Denormalised, DB§6 — same rationale and same INSERT-only/trigger-guard
    // discipline as workout_sessions.coach_id (training-schema/03). Guarded
    // by `set_logs_no_owner_change` (derived-data/02,
    // migrations/0022_guard_triggers.sql) — DB§8.3's own worked example.
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    setNumber: smallint('set_number').notNull(),
    reps: smallint('reps'),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    rpe: numeric('rpe', { precision: 3, scale: 1 }),
    rir: smallint('rir'),
    durationSeconds: integer('duration_seconds'), // timed holds/carries
    distanceM: numeric('distance_m', { precision: 8, scale: 2 }), // carries/cardio
    isWarmup: boolean('is_warmup').notNull().default(false),
    isFailure: boolean('is_failure').notNull().default(false),
    notes: text('notes'),
    estimated1rmKg: numeric('estimated_1rm_kg', { precision: 6, scale: 2 }), // Epley, computed on write by application code (packages/utils) — not by the database
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    // REQUIRED for offline dedup — unlike workout_sessions.client_local_id
    // (nullable, task 03), every set log is offline-capable by design, with
    // no server-only creation path.
    clientLocalId: text('client_local_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // At least one of reps/duration_seconds/distance_m must be non-null —
    // an OR across the three optional measurement columns (not an AND: a
    // rep-based lift legitimately has null duration_seconds and distance_m).
    // Lets one table represent a rep-based lift, a timed plank, and a
    // farmer's-carry distance without three separate tables, while still
    // rejecting a set that logged nothing measurable at all.
    setHasMeasurement: check(
      'set_has_measurement',
      sql`${t.reps} IS NOT NULL OR ${t.durationSeconds} IS NOT NULL OR ${t.distanceM} IS NOT NULL`,
    ),
    // Plain (non-partial) unique, in contrast to sessions_client_local
    // (task 03) — client_local_id is NOT NULL here, so a partial
    // `WHERE client_local_id IS NOT NULL` clause would be a no-op filter.
    // Deliberate, not an inconsistency (DB§5.2).
    clientLocalUnique: uniqueIndex('set_logs_client_local').on(t.clientId, t.clientLocalId),
    // The index behind the single most frequently run query in the workout
    // logger, "last time you did this exercise" (DB§22's cookbook).
    // Equality columns first, range/sort last (DB§7's composite-index rule):
    // client_id and exercise_id are both equality filters, logged_at DESC
    // is the sort — this exact column order is what makes the index usable
    // for that query shape.
    clientExerciseIdx: index('set_logs_client_exercise')
      .on(t.clientId, t.exerciseId, t.loggedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // DB§7's own named index — satisfies the workout_session_id FK-indexing
    // rule and doubles as the natural ordering for rendering one session's
    // sets. exercise_id gets its own plain index: neither unique index above
    // leads with it, so it isn't covered on its own (same reasoning applied
    // to workout_sessions in task 03).
    sessionIdx: index('set_logs_session').on(t.workoutSessionId, t.setNumber),
    exerciseIdIdx: index('set_logs_exercise_id_idx').on(t.exerciseId),
  }),
);

export const personalRecords = trainingSchema.table(
  'personal_records',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    recordType: text('record_type').notNull(), // CHECK (record_type IN (...)) — DB§5.2 uses text + CHECK, not an enum
    value: numeric('value', { precision: 10, scale: 2 }).notNull(),
    // The record survives even if the specific set that achieved it is
    // later edited or removed.
    setLogId: uuid('set_log_id').references(() => setLogs.id, { onDelete: 'set null' }),
    achievedAt: timestamp('achieved_at', { withTimezone: true }).notNull(),
    // DB§5.2 gives this table created_at only — no updated_at. This table
    // holds only the CURRENT record per (client, exercise, record_type);
    // history lives in set_logs itself, queryable by ordering on
    // estimated_1rm_kg or weight_kg (DB§5.2's own comment).
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    recordTypeCheck: check(
      'personal_records_record_type_check',
      sql`${t.recordType} IN ('1rm_estimated', 'max_weight', 'max_reps', 'max_volume')`,
    ),
    // One current record per client, per exercise, per record type — a
    // client can hold a '1rm_estimated' record and a 'max_reps' record for
    // the same exercise simultaneously (different rows), but not two
    // '1rm_estimated' records for the same exercise. Also satisfies DB§7's
    // FK-indexing rule for client_id.
    clientExerciseTypeUnique: uniqueIndex(
      'personal_records_client_id_exercise_id_record_type_unique',
    ).on(t.clientId, t.exerciseId, t.recordType),
    // DB§7: every FK is indexed, no exceptions — exercise_id and set_log_id
    // aren't the leading column of the unique index above.
    exerciseIdIdx: index('personal_records_exercise_id_idx').on(t.exerciseId),
    setLogIdIdx: index('personal_records_set_log_id_idx').on(t.setLogId),
  }),
);
