// Shared building blocks every feature schema composes rather than
// redefining (CLAUDE.md §6.4). Every bound below is traceable to a `CHECK`
// constraint — or, where a `numeric(p,s)` column has no explicit `CHECK`,
// to the precision/scale of the column itself — in DATABASE.md DB§5. Where
// DATABASE.md has no constraint, this file does not invent one: an
// unconstrained column is a decision, and a schema stricter than the
// database would reject data the database would have accepted.
import { z } from 'zod';

// Re-exported so a §6.1 feature-schema module can import it alongside every
// other primitive from this one file — `layout.test.ts` holds each of those
// modules to importing nothing but `zod` and `./primitives.ts`, precisely
// so a router schema never reaches into an arbitrary set of sibling files.
export { strictObject } from './strict.ts';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// `.max(36)` on every UUID/email/timezone primitive below is a fixed
// format bound (36 chars is exactly a textual UUID's length; 320 is RFC
// 5321's email length ceiling; 64 comfortably exceeds the longest real
// IANA zone name), not a DATABASE.md-derived one — `conventions.test.ts`
// requires every string reachable from an input schema to carry a
// `.max()`, on the DoS-shaped principle that an unbounded string is a
// bound this file failed to set, not a bound the database chose not to
// have. `z.uuid()`/`z.email()` validate *shape*; they don't themselves
// produce the `max_length` check that walker looks for.

/**
 * A row id. Generated app-side as **UUIDv7** (DB§2 — time-ordered, so index
 * inserts stay sequential). This schema validates UUID *shape* only; which
 * version was generated is the generator's concern, not the validator's.
 */
export const id = z.uuid().max(36);

/**
 * The offline idempotency key (DB§14.1). UUIDv7, generated on the device at
 * the moment of user action and **never regenerated on retry** — the server
 * upserts on `(owner, client_local_id)`, so replaying the same mutation ten
 * times must produce one row, which only holds if the key never changes.
 * Same shape as {@link id}; kept as a separate export because the two mean
 * different things at call sites.
 */
export const clientLocalId = z.uuid().max(36);

/**
 * Case-insensitive, trimmed, lowercased on parse — matching the `citext`
 * column type (DB§2.1) so two users can never register with emails that
 * differ only in case or incidental whitespace.
 */
export const email = z.string().trim().toLowerCase().max(320).pipe(z.email().max(320));

function isSupportedTimeZone(value: string): boolean {
  try {
    // Throws RangeError for an unrecognised zone; this is the runtime's own
    // IANA database, which is more current and more correct than any regex
    // this file could maintain by hand.
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * An IANA timezone identifier (e.g. `"Asia/Kolkata"`), validated against the
 * runtime's own zone database rather than a regex — a regex can confirm the
 * *shape* of `"Asia/Kolkata"` but not that the zone actually exists.
 */
export const timezone = z.string().max(64).refine(isSupportedTimeZone, {
  message: 'Not a recognised IANA timezone identifier',
});

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

/**
 * A calendar day, `"yyyy-MM-dd"`, with **no time or timezone component** —
 * the shape `workout_sessions.scheduled_date` and `meals.logged_date` are
 * stored in (DB§2: "Calendar dates" row). `z.iso.date()` already rejects a
 * datetime string and an out-of-range calendar date (Feb 30, a non-leap
 * Feb 29 — real calendar math, not a regex), and the `.brand()` makes the
 * type itself reject a timestamp passed where a calendar date belongs
 * (CLAUDE.md §17.4, §25.5) — see primitives.test.ts for the compile-time
 * proof.
 */
export const calendarDate = z.iso.date().max(10).brand('CalendarDate');
export type CalendarDate = z.infer<typeof calendarDate>;

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

/**
 * DB§11.2: Drizzle returns Postgres `numeric` columns as **strings** in
 * JavaScript. `packages/schemas` is the one boundary where that gets parsed
 * back to a number — never worked around by switching the column to
 * `float`, which would lose precision on weights and macros. Every bounded
 * numeric primitive below accepts a `number` *or* a numeric `string` on
 * input and yields a `number` after parsing.
 */
function boundedNumeric(min: number, max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.number().min(min).max(max),
  );
}

function boundedInt(min: number, max?: number) {
  const schema = max === undefined ? z.number().int().min(min) : z.number().int().min(min).max(max);
  return z.preprocess((value) => (typeof value === 'string' ? Number(value) : value), schema);
}

/**
 * Kilograms. Mirrors `training.set_logs.weight_kg numeric(6,2) CHECK
 * (weight_kg >= 0)` — the lower bound is the explicit `CHECK`; the upper
 * bound is what `numeric(6,2)` can hold (6 total digits, 2 after the
 * decimal point). `CLAUDE.md` §0/§17.2: every weight in this database is
 * kilograms, always — conversion for display happens only in
 * `packages/utils`, never here.
 */
export const weightKg = boundedNumeric(0, 9999.99);

/**
 * Centimetres. Mirrors `identity.client_profiles.height_cm numeric(5,1)
 * CHECK (height_cm BETWEEN 50 AND 260)`.
 */
export const heightCm = boundedNumeric(50, 260);

/**
 * Mirrors `training.workout_sessions.duration_seconds integer CHECK
 * (duration_seconds >= 0)`. No upper bound exists in the database, so none
 * is invented here.
 */
export const durationSeconds = boundedInt(0);

/**
 * Rate of Perceived Exertion, 1–10. Mirrors `training.set_logs.rpe
 * numeric(3,1) CHECK (rpe BETWEEN 1 AND 10)` — one decimal place, matching
 * the column's scale of 1. Postgres would silently round a second decimal
 * digit rather than reject it; this schema rejects it instead, which is the
 * whole point of validating here rather than only in the database (the
 * "bounds-mirroring rule" — the `CHECK` is the guarantee, this is the
 * helpful error).
 */
export const rpe = boundedNumeric(1, 10).refine((value) => Math.round(value * 10) === value * 10, {
  message: 'RPE takes at most one decimal place',
});

/**
 * Reps In Reserve, 0–10. Mirrors `training.set_logs.rir smallint CHECK
 * (rir BETWEEN 0 AND 10)`.
 */
export const rir = boundedInt(0, 10);

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * The keyset pagination cursor — the last item's `created_at`, opaque to
 * the caller. DB§22 bans `OFFSET` on any list that grows, so every list
 * procedure passes this instead. This validates the cursor's *shape* only;
 * `./pagination.ts`'s `paginationInput` composes it with the caller-facing
 * `limit` field and its cap, which is why the full input schema lives there
 * and not here — this file is primitives, not policy.
 */
export const paginationCursor = z.iso.datetime();
