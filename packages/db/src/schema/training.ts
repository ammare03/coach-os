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
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, trainingSchema } from './_shared.ts';
import { movementPattern } from './enums.ts';
import { coachProfiles } from './identity.ts';

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
