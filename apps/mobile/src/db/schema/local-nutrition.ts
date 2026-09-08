// `local_meals`, `local_foods_cache` — DB§13.
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// DB§13 elides this table as "same shape" (as `local_set_logs`). Mirrors
// `packages/db/src/schema/nutrition.ts`'s `meals` header fields (loggedDate,
// mealType, loggedAt, notes) plus a denormalised `itemsJson` blob standing in
// for the server's separate `meal_items` table — a rendering cache, not a
// normalised join, same reasoning as `local_workout_sessions.payloadJson`.
// No coachId, no photoAssetId (device DB rules forbid caching a signed URL
// or its target beyond the render lifetime), no soft delete.
export const localMeals = sqliteTable('local_meals', {
  id: text('id').primaryKey(),
  clientLocalId: text('client_local_id').notNull().unique(),
  loggedDate: text('logged_date').notNull(), // ISO date, client-local calendar day
  mealType: text('meal_type').notNull(),
  loggedAt: integer('logged_at').notNull(), // epoch ms
  notes: text('notes'),
  // Denormalised meal_items snapshot for offline rendering:
  // [{ name, quantityG, calories, proteinG, carbsG, fatG }]
  itemsJson: text('items_json').notNull(),
  syncState: text('sync_state', { enum: ['synced', 'pending', 'conflict'] })
    .notNull()
    .default('pending'),
});

// Transcribed verbatim from DB§13's literal SQL — top ~200 foods, for
// offline search.
export const localFoodsCache = sqliteTable('local_foods_cache', {
  id: text('id').primaryKey(),
  name: text('name'),
  brand: text('brand'),
  barcode: text('barcode'),
  caloriesPer100g: real('calories_per_100g'),
  proteinG: real('protein_g'),
  carbsG: real('carbs_g'),
  fatG: real('fat_g'),
  lastUsedAt: integer('last_used_at'), // epoch ms
});

// Bootstrap DDL — see `local-training.ts`'s copy of this comment for why
// this exists alongside the typed definitions above instead of being
// generated from them.
export const LOCAL_NUTRITION_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS local_meals (
    id TEXT PRIMARY KEY,
    client_local_id TEXT NOT NULL UNIQUE,
    logged_date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    logged_at INTEGER NOT NULL,
    notes TEXT,
    items_json TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS local_foods_cache (
    id TEXT PRIMARY KEY,
    name TEXT,
    brand TEXT,
    barcode TEXT,
    calories_per_100g REAL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    last_used_at INTEGER
  )`,
];
