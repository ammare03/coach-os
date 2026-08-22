// Drizzle tables for the `training` Postgres schema (DATABASE.md DB§5.2) —
// exercises, programs, assignments, workout_sessions, set_logs, and
// personal_records. Transcribed column-for-column, constraint-for-constraint;
// where this file and DATABASE.md ever disagree, DATABASE.md is the bug
// (CLAUDE.md §0, phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
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
import { assignmentStatus, movementPattern, sessionStatus } from './enums.ts';
import { clientProfiles, coachProfiles } from './identity.ts';

// `tsvector` has no built-in Drizzle column type — this is `customType`'s
// documented use case (identity-schema/01's `citext`, same pattern).
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// `demo_asset_id` references `coaching.media_assets(id)` per DB§5.2, but that
// table doesn't exist until coaching-schema (a later feature in this same
// phase) — same forward-reference problem as `identity.users.avatar_asset_id`
// (identity-schema/01). Strategy 1: a plain `uuid` column with no
// `.references()`; the FK constraint itself is added by an ALTER TABLE
// migration in coaching-schema once `media_assets` exists.
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
    demoAssetId: uuid('demo_asset_id'), // FK added later — see comment above
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
    // the same transaction; the trigger that blocks drift outside the
    // documented client-transfer procedure is built in derived-data/02, not
    // here — this column exists now without that guard (training-schema/03).
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
