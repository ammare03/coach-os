// Drizzle tables for the `nutrition` Postgres schema (DATABASE.md DB§5.3) —
// foods, meals, diary entries, and nutrition plans. Transcribed
// column-for-column, constraint-for-constraint; where this file and
// DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md §0,
// phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, nutritionSchema } from './_shared.ts';
import { foodSource, mealType } from './enums.ts';
import { clientProfiles, coachProfiles, users } from './identity.ts';

// `tsvector` has no built-in Drizzle column type — this is `customType`'s
// documented use case (identity-schema/01's `citext`, training-schema/01's
// own copy of this same helper).
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const foods = nutritionSchema.table(
  'foods',
  {
    ...id,
    source: foodSource('source').notNull(),
    externalId: text('external_id'),
    barcode: text('barcode'),
    name: text('name').notNull(),
    brand: text('brand'),
    // A client- or coach-submitted food outlives the user who added it.
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    servingSizeG: numeric('serving_size_g', { precision: 7, scale: 2 }),
    servingLabel: text('serving_label'), // free text, e.g. '1 medium', '1 cup'
    // The only macro column that is both NOT NULL and has an explicit
    // non-negative CHECK — the others default to zero with no explicit
    // lower bound beyond what their type implies. Preserved exactly as
    // DB§5.3 states it, not "cleaned up" into a uniform set of checks.
    caloriesPer100g: numeric('calories_per_100g', { precision: 7, scale: 2 }).notNull(),
    proteinG: numeric('protein_g', { precision: 6, scale: 2 }).notNull().default('0'),
    carbsG: numeric('carbs_g', { precision: 6, scale: 2 }).notNull().default('0'),
    fatG: numeric('fat_g', { precision: 6, scale: 2 }).notNull().default('0'),
    fiberG: numeric('fiber_g', { precision: 6, scale: 2 }),
    sugarG: numeric('sugar_g', { precision: 6, scale: 2 }),
    sodiumMg: numeric('sodium_mg', { precision: 8, scale: 2 }),
    isVerified: boolean('is_verified').notNull().default(false),
    usageCount: integer('usage_count').notNull().default(0), // popularity ranking in search
    // Postgres STORED generated column. Deliberately 'simple', NOT
    // 'english' — the config `training.exercises.search_vector` used
    // (training-schema/01). Exercise names are natural-language English;
    // food names and brands are frequently proper nouns, foreign-language
    // product names, and brand strings where English stemming would
    // actively hurt matching. `brand` is coalesced to '' before
    // concatenation since it's nullable, and `text || NULL` is NULL in SQL
    // — an uncoalesced brand would silently make every food with no brand
    // unsearchable by name, with no error anywhere (DB§5.3, this task's own
    // Risks section).
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(brand,'') || ' ' || name)`,
    ),
    ...timestamps,
  },
  (t) => ({
    caloriesNonNegative: check('foods_calories_per_100g_check', sql`${t.caloriesPer100g} >= 0`),
    // The same third-party record is never cached twice.
    sourceExternalIdUnique: uniqueIndex('foods_source_external_id_unique').on(
      t.source,
      t.externalId,
    ),
    // Most foods have a barcode but not all (coach-submitted quick-add items
    // typically don't) — DB§22's cookbook runs barcode lookup as the first
    // step in the search chain, so this stays tight and excludes the null
    // case rather than indexing absent barcodes.
    barcodeIdx: index('foods_barcode')
      .on(t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    // Same dual-strategy pattern as training.exercises (training-schema/01):
    // full-text handles whole-word/stemmed matches, trigram handles typos
    // and partial substring matches. DB§22's cookbook chains barcode ->
    // full-text -> trigram.
    searchIdx: index('foods_search').using('gin', t.searchVector),
    trgmIdx: index('foods_trgm').using('gin', t.name.op('gin_trgm_ops')),
  }),
);

// `photo_asset_id` references `coaching.media_assets(id)` per DB§5.3, but
// that table doesn't exist until coaching-schema (a later feature in this
// same phase) — same forward-reference problem as `identity.users.avatar_asset_id`
// (identity-schema/01). Strategy 1: a plain `uuid` column with no
// `.references()`; the FK constraint itself is added by an ALTER TABLE
// migration in coaching-schema once `media_assets` exists.
export const meals = nutritionSchema.table(
  'meals',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    // Denormalised, DB§6 — same rationale and same INSERT-only/trigger-guard
    // discipline as training.workout_sessions.coach_id (training-schema/03).
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    // CLIENT-LOCAL calendar day — the same distinction training-schema/03
    // established for scheduled_date, applying identically here per §17.4.
    // `logged_at` below is the actual timestamp; these are two different
    // columns with two different purposes and must not be confused.
    loggedDate: date('logged_date').notNull(),
    mealType: mealType('meal_type').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    photoAssetId: uuid('photo_asset_id'), // FK added later — see comment above
    // NOT NULL, matching set_logs's pattern (training-schema/04) — meal
    // logging is offline-capable by design, no server-only path.
    clientLocalId: text('client_local_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    clientLocalUnique: uniqueIndex('meals_client_local').on(t.clientId, t.clientLocalId),
    // DB§7: every FK is indexed, no exceptions — clientLocalUnique above
    // leads with client_id (non-partial, so it does satisfy that one), but
    // coach_id needs its own.
    coachIdIdx: index('meals_coach_id_idx').on(t.coachId),
  }),
);

export const mealItems = nutritionSchema.table(
  'meal_items',
  {
    ...id,
    mealId: uuid('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    // An item survives its food reference being removed — the item already
    // carries its own macro snapshot below.
    foodId: uuid('food_id').references(() => foods.id, { onDelete: 'set null' }),
    customName: text('custom_name'), // quick-add path, §8.5
    quantityG: numeric('quantity_g', { precision: 8, scale: 2 }).notNull(),
    // SNAPSHOT block, populated at insert time from whatever foods row (or
    // manual entry) was used, and never rewritten afterward regardless of
    // what happens to the foods row these values came from. Plain mutable
    // numeric columns with no generated-column magic and no FK-driven
    // default — a generated column tied to foods would recompute on every
    // read (or silently fail to update, depending on generation mode),
    // defeating the entire snapshot guarantee this comment exists to state
    // (DB§5.3, training-schema/04's personal_records is the same category
    // of decision: current-vs-history).
    calories: numeric('calories', { precision: 8, scale: 2 }).notNull(),
    proteinG: numeric('protein_g', { precision: 7, scale: 2 }).notNull().default('0'),
    carbsG: numeric('carbs_g', { precision: 7, scale: 2 }).notNull().default('0'),
    fatG: numeric('fat_g', { precision: 7, scale: 2 }).notNull().default('0'),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => ({
    quantityPositive: check('meal_items_quantity_g_check', sql`${t.quantityG} > 0`),
    // At least one of food_id/custom_name must be present — an item must be
    // traceable to something, even if that something is just a name the
    // client typed. OR, matching set_has_measurement's pattern
    // (training-schema/04), not AND.
    itemIdentified: check(
      'item_identified',
      sql`${t.foodId} IS NOT NULL OR ${t.customName} IS NOT NULL`,
    ),
    // DB§7: every FK is indexed, no exceptions.
    mealIdIdx: index('meal_items_meal_id_idx').on(t.mealId),
    foodIdIdx: index('meal_items_food_id_idx').on(t.foodId),
  }),
);

// No `id` column — this table breaks the implicit id/created_at/updated_at
// pattern every other table in the schema follows (DB§5's own boilerplate
// note). DB§5.3 states its primary key explicitly as the composite
// (client_id, date), and gives it `updated_at` only, no `created_at`: the
// row's first write and its creation are the same event by construction (it
// either exists with today's totals or doesn't exist yet). Deliberate —
// do NOT "fix" this table to match the shared id/timestamps pattern in a
// later migration (this task's own Risks section).
//
// Empty and unmaintained at the end of this task, by design: no trigger and
// no application code writes to it here. `derived-data/03` builds the
// transactional recompute function that keeps it correct on every
// meals/meal_items write, per DB§8.2's requirement that it be impossible to
// write a meal without updating the summary in the same transaction.
export const dailyNutritionSummary = nutritionSchema.table(
  'daily_nutrition_summary',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    totalCalories: numeric('total_calories', { precision: 8, scale: 2 }).notNull().default('0'),
    totalProteinG: numeric('total_protein_g', { precision: 7, scale: 2 }).notNull().default('0'),
    totalCarbsG: numeric('total_carbs_g', { precision: 7, scale: 2 }).notNull().default('0'),
    totalFatG: numeric('total_fat_g', { precision: 7, scale: 2 }).notNull().default('0'),
    // Snapshotted targets at the time, not a live join to client_profiles.
    targetCalories: integer('target_calories'),
    targetProteinG: integer('target_protein_g'),
    adherenceScore: numeric('adherence_score', { precision: 4, scale: 1 }),
    waterMl: integer('water_ml').notNull().default(0),
    mealsLogged: smallint('meals_logged').notNull().default(0),
    updatedAt: timestamps.updatedAt,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clientId, t.date] }),
  }),
);

// Structurally similar to training.programs (training-schema/02) — a
// coach-owned reusable template.
export const mealPlans = nutritionSchema.table(
  'meal_plans',
  {
    ...id,
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isTemplate: boolean('is_template').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    coachIdIdx: index('meal_plans_coach_id_idx').on(t.coachId),
  }),
);

export const mealPlanDays = nutritionSchema.table(
  'meal_plan_days',
  {
    ...id,
    mealPlanId: uuid('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    dayNumber: smallint('day_number').notNull(),
    // No `notes`/`name`/`is_rest_day` here, unlike training.program_days —
    // DB§5.3 gives this table exactly these two columns plus the implicit
    // id/created_at/updated_at boilerplate (DB§5); meal plans have no week
    // dimension, only a repeating 7-day cycle.
    ...timestamps,
  },
  (t) => ({
    dayNumberBound: check('meal_plan_days_day_number_check', sql`${t.dayNumber} BETWEEN 1 AND 7`),
    mealPlanDayUnique: uniqueIndex('meal_plan_days_meal_plan_id_day_number_unique').on(
      t.mealPlanId,
      t.dayNumber,
    ),
  }),
);

// Deliberately NO item_identified-style CHECK here, unlike meal_items
// (task 02) — DB§5.3's own comment flags this exact omission and transcribes
// it faithfully rather than silently "fixing" an apparent inconsistency
// (nutrition-schema/03's own Risks section). If this is genuinely a
// documentation gap rather than an intentional choice, that determination
// belongs in a CLAUDE.md §27 conversation, not in this schema file.
export const mealPlanItems = nutritionSchema.table(
  'meal_plan_items',
  {
    ...id,
    mealPlanDayId: uuid('meal_plan_day_id')
      .notNull()
      .references(() => mealPlanDays.id, { onDelete: 'cascade' }),
    mealType: mealType('meal_type').notNull(),
    foodId: uuid('food_id').references(() => foods.id, { onDelete: 'set null' }),
    customName: text('custom_name'),
    // No positive-quantity CHECK here either, unlike meal_items.quantity_g —
    // same faithful-transcription reasoning as the missing item_identified
    // check above; DB§5.3 simply doesn't specify one for this table.
    quantityG: numeric('quantity_g', { precision: 8, scale: 2 }).notNull(),
    orderIndex: smallint('order_index').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    // DB§7: every FK is indexed, no exceptions.
    mealPlanDayIdIdx: index('meal_plan_items_meal_plan_day_id_idx').on(t.mealPlanDayId),
    foodIdIdx: index('meal_plan_items_food_id_idx').on(t.foodId),
  }),
);

// created_at only, no updated_at — matching the same "no incidental edits"
// reasoning as identity.refreshTokens (identity-schema/02) and
// training.personalRecords (training-schema/04): an assignment's lifecycle
// is start and end (via ended_at), not arbitrary modification.
export const mealPlanAssignments = nutritionSchema.table(
  'meal_plan_assignments',
  {
    ...id,
    mealPlanId: uuid('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    // DB§7: every FK is indexed, no exceptions.
    mealPlanIdIdx: index('meal_plan_assignments_meal_plan_id_idx').on(t.mealPlanId),
    clientIdIdx: index('meal_plan_assignments_client_id_idx').on(t.clientId),
  }),
);

// The simplest table in the entire phase — no notes field, no soft delete,
// just a positive quantity on a day.
export const waterLogs = nutritionSchema.table(
  'water_logs',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    loggedDate: date('logged_date').notNull(), // client-local calendar day, matching every other logged_date/scheduled_date column in this phase
    amountMl: integer('amount_ml').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
    clientLocalId: text('client_local_id').notNull(),
    ...timestamps,
  },
  (t) => ({
    amountPositive: check('water_logs_amount_ml_check', sql`${t.amountMl} > 0`),
    clientLocalUnique: uniqueIndex('water_logs_client_id_client_local_id_unique').on(
      t.clientId,
      t.clientLocalId,
    ),
  }),
);
