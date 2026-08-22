// The five DB§3 schema-scoped table helpers, and the column groups every
// table repeats (DB§5's implicit `id`/`created_at`/`updated_at`, and the
// separate soft-delete pair). Every table in features 2 through 6 is
// declared through one of the five helpers below — a table declared with
// Drizzle's bare `pgTable` lands in the `public` schema and is a review
// blocker (db-package-scaffold/01).
import { sql } from 'drizzle-orm';
import { customType, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

// DB§3 — one database, five schemas, mirroring the feature slices. This is
// the extraction seam: each schema could become its own database later
// without renaming anything.
export const identitySchema = pgSchema('identity');
export const trainingSchema = pgSchema('training');
export const nutritionSchema = pgSchema('nutrition');
export const coachingSchema = pgSchema('coaching');
export const platformSchema = pgSchema('platform');

// DB§2 — primary keys are generated APP-SIDE as UUIDv7, never left to
// Postgres. UUIDv7 is time-ordered, so index inserts stay sequential
// instead of scattering across the btree the way UUIDv4 does — the
// difference that matters at the ~140M-row/year `set_logs` volume DB§23
// projects. `gen_random_uuid()` remains as the SQL-side default purely as a
// safety net for a direct `INSERT` that forgets to supply an id; the
// application must always supply one itself, so `$defaultFn` (JS-side) is
// what actually runs in practice.
export const id = {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(uuidv7),
};

// `timestamptz` is Drizzle's `timestamp(..., { withTimezone: true })` — DB§2
// is explicit that every timestamp is `timestamptz`, stored UTC, never a
// bare `timestamp` and never a separately stored offset. `updated_at`'s
// default here is only the INSERT-time value; DB§8.1's trigger
// (derived-data/01) is what keeps it current on every UPDATE.
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// DB§2 — soft delete is `deleted_at timestamptz null`, kept separate from
// `timestamps` because not every table has it, and DB§7's partial indexes
// assume its presence rather than guess at it.
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

// DB§2.1's `citext` extension, as a Drizzle column type — drizzle-orm has
// no built-in `citext`, so this is `customType`'s documented use case, not
// a workaround. Every email column in DB§5.1 uses this, never plain `text`
// with application-side lowercasing: the case-insensitive guarantee lives
// in the column type itself (identity-schema/01 §Risks).
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
