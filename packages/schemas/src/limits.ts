// Shared caps (`error-and-validation/03` step 4). DB§2 keeps text columns
// unbounded at the database — length limits live in Zod, nowhere else — so
// these constants are the *only* thing standing between a client and a
// 40MB message body or an unbounded `WHERE id = ANY($1)`. Named here so a
// second author raising one under pressure edits one line, not an inlined
// number scattered across a dozen schema files, and so the review is "is
// 500 the right number" instead of "where did this number come from".

/** Hard ceiling on any list procedure's `limit` — headroom, not a target: a dashboard page (`CLAUDE.md` §8.2) is 30 rows. */
export const MAX_PAGE_SIZE = 100;

/** What a list procedure returns when the caller omits `limit`. */
export const DEFAULT_PAGE_SIZE = 30;

/**
 * The array cap `../authorization-middleware/03-owns-resource.md` step 5
 * defers to for a `WHERE id = ANY($1)` selector. A Studio coach's 75 seats
 * fits; an unbounded array does not — bulk edits past this size are a
 * background job (`../background-jobs/`), not a synchronous request.
 */
export const MAX_ID_ARRAY = 100;

/** Names, titles, labels. */
export const MAX_SHORT_TEXT = 200;

/** Coach notes, client notes, session notes. */
export const MAX_NOTE_TEXT = 2000;

/** Message and comment bodies. */
export const MAX_BODY_TEXT = 10000;

/** `specialties`, `equipment_access`, `dietary_restrictions`. */
export const MAX_TAG_ARRAY = 20;
