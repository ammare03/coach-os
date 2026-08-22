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
  index,
  integer,
  numeric,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, nutritionSchema } from './_shared.ts';
import { foodSource } from './enums.ts';
import { users } from './identity.ts';

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
