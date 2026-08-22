// Drizzle tables for the `training` Postgres schema (DATABASE.md DB§5.2) —
// exercises, programs, assignments, workout_sessions, set_logs, and
// personal_records. Transcribed column-for-column, constraint-for-constraint;
// where this file and DATABASE.md ever disagree, DATABASE.md is the bug
// (CLAUDE.md §0, phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  numeric,
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
