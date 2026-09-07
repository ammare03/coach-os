import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import {
  customFirst,
  exerciseColumns,
  toExercise,
  visibleToCoach,
  type Exercise,
} from './visibility.ts';

// `exercises.search` (`exercise-library/02`) — a three-tier ladder, run
// cheapest-and-most-certain first and stopped as soon as the caller's limit
// is filled:
//
//   1. exact     lower(name) = lower(query)                → 'exact'
//   2. full-text search_vector @@ plainto_tsquery(query)   → 'fulltext'   (exercises_search, GIN)
//   3. trigram   similarity(name, query) > threshold       → 'fuzzy'      (exercises_trgm, GIN)
//
// Tier 3 is both the expensive one and the surprising one, so it only runs
// to top up a short result set. This is the shape every other search in the
// product copies — P13's food search against `nutrition.foods` is the same
// ladder (DB§22) — which is why the tiers are named rather than fused into
// one clever query.
//
// The visibility predicate is applied INSIDE each tier's `where`, never
// around the union: filtering afterwards works and is fragile, because a
// later refactor that reorders the tiers loses the filter in one branch and
// nothing about the code looks wrong.

// EXPLAIN (ANALYZE, BUFFERS) evidence, `exercise-library/02` Approach step 7
// and Verification step 3. Two sizes, because they say different things:
//
//   321 rows (DB§21's 121 global + 200 custom — the target scale):
//     tier 2  Seq Scan, 0.18ms      tier 3  Seq Scan, 1.42ms
//     tier 3 with both scan types disabled: 1.22ms — indistinguishable.
//     The planner is right: at 321 rows a GIN probe cannot beat reading
//     the whole table. Server-side p75 for the five representative queries
//     is single-digit ms, against a 100ms budget.
//
//   20,321 rows (a deliberate stress, far past anything real):
//     tier 2  Bitmap Index Scan on exercises_search, 7.4ms — the full-text
//             index is chosen on its own and scales.
//     tier 3  Seq Scan, 234ms. With `enable_seqscan = off`: Bitmap Index
//             Scan on exercises_trgm, 8.5ms. So the query IS in the
//             indexable form and the index IS usable — the planner simply
//             over-costs a GIN trigram probe (est. 985 vs 878 for the seq
//             scan) and picks wrong by a factor of 27.
//
// No change is warranted now: `exercises` is 121 rows plus a few hundred
// per coach, and a coach's custom library will not reach five figures.
// The pattern DOES repeat in P13 against `nutrition.foods`, where row
// counts genuinely are large — that is where this note earns its keep.
// Revisit here only if a coach's library passes ~5k rows, and cap the
// tier-3 top-up first (this task's Risks section).

/** Which tier produced a row. The picker uses this to decide whether to offer "did you mean". */
export type MatchKind = 'exact' | 'fulltext' | 'fuzzy';

export interface ExerciseSearchResult extends Exercise {
  matchKind: MatchKind;
}

export interface ExerciseSearchFilters {
  primaryMuscle?: string | undefined;
  equipment?: string | undefined;
  movementPattern?: (typeof schema.exercises.$inferSelect)['movementPattern'] | undefined;
}

/**
 * Below this, `plainto_tsquery` has nothing to stem and the result is
 * either everything or nothing.
 */
const MIN_FULLTEXT_LENGTH = 2;

/** `similarity('a', anything)` is noise. Three characters is the shortest trigram window. */
const MIN_TRIGRAM_LENGTH = 3;

/**
 * `pg_trgm`'s default `similarity_threshold` is 0.3, which is loose enough
 * to return "Front Squat" for "front raise" — a plausible-but-wrong result
 * a coach accepts without reading, which fragments the library exactly as
 * badly as no fuzzy matching at all. 0.4 was chosen against the DB§21 seed:
 * it keeps "romainian deadlift" → "Romanian Deadlift" and drops the
 * front-raise class of false positive. Written as an explicit
 * `similarity() >` predicate rather than a session `set_limit`, so another
 * feature changing the session default cannot silently change this search.
 */
const TRIGRAM_THRESHOLD = 0.4;

function baseWhere(coachProfileId: string, filters: ExerciseSearchFilters): (SQL | undefined)[] {
  return [
    visibleToCoach(coachProfileId),
    // Archived rows are excluded here for the same reason `list` excludes
    // them: a coach who archived an exercise should not be offered it again.
    isNull(schema.exercises.archivedAt),
    filters.primaryMuscle ? eq(schema.exercises.primaryMuscle, filters.primaryMuscle) : undefined,
    filters.equipment ? eq(schema.exercises.equipment, filters.equipment) : undefined,
    filters.movementPattern
      ? eq(schema.exercises.movementPattern, filters.movementPattern)
      : undefined,
  ];
}

export async function searchExercises(
  db: DbClient,
  coachProfileId: string,
  rawQuery: string,
  limit: number,
  filters: ExerciseSearchFilters = {},
): Promise<ExerciseSearchResult[]> {
  const query = rawQuery.trim();

  // An empty query returns the head of the library rather than every row
  // ranked by nothing — it is how the picker opens, with something already
  // on screen instead of a box asking the coach to guess what is in it.
  if (query.length === 0) {
    const rows = await db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(and(...baseWhere(coachProfileId, filters)))
      .orderBy(customFirst, sql`lower(${schema.exercises.name}) ASC`)
      .limit(limit);
    return rows.map((row) => ({ ...toExercise(row), matchKind: 'fulltext' as const }));
  }

  const results: ExerciseSearchResult[] = [];
  const seen = new Set<string>();

  const collect = (
    rows: (Parameters<typeof toExercise>[0] & { id: string })[],
    matchKind: MatchKind,
  ): void => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push({ ...toExercise(row), matchKind });
    }
  };

  // Tier 1 — exact. Certain, and the only tier that can legitimately return
  // two rows for one string: a global and a custom exercise may share a
  // name across namespaces (DB§5.2), and the coach's own comes first.
  const exact = await db
    .select(exerciseColumns)
    .from(schema.exercises)
    .where(
      and(
        ...baseWhere(coachProfileId, filters),
        sql`lower(${schema.exercises.name}) = lower(${query})`,
      ),
    )
    .orderBy(customFirst, sql`lower(${schema.exercises.name}) ASC`)
    .limit(limit);
  collect(exact, 'exact');
  if (results.length >= limit) return results.slice(0, limit);

  // Tier 2 — full-text over the stored `search_vector`, which already
  // includes `aliases` (DB§5.2's generated column). This is what makes
  // "rdl" find "Romanian Deadlift" when the seed records it as an alias.
  if (query.length >= MIN_FULLTEXT_LENGTH) {
    const tsquery = sql`plainto_tsquery('english', ${query})`;
    const fulltext = await db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(
        and(
          ...baseWhere(coachProfileId, filters),
          sql`${schema.exercises.searchVector} @@ ${tsquery}`,
        ),
      )
      .orderBy(
        sql`ts_rank(${schema.exercises.searchVector}, ${tsquery}) DESC`,
        customFirst,
        sql`lower(${schema.exercises.name}) ASC`,
      )
      .limit(limit);
    collect(fulltext, 'fulltext');
    if (results.length >= limit) return results.slice(0, limit);
  }

  // Tier 3 — trigram, and only as a top-up. Running it unconditionally
  // would put the expensive, surprising tier on the path of every keystroke
  // that already had a good answer.
  if (query.length >= MIN_TRIGRAM_LENGTH) {
    const similarity = sql`similarity(${schema.exercises.name}, ${query})`;
    const fuzzy = await db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(
        and(
          ...baseWhere(coachProfileId, filters),
          // `%` (the operator the GIN trigram index answers) plus an
          // explicit threshold: the operator gets us the index scan, the
          // comparison pins the cutoff to this query rather than to
          // whatever `pg_trgm.similarity_threshold` happens to be.
          sql`${schema.exercises.name} % ${query}`,
          sql`${similarity} > ${TRIGRAM_THRESHOLD}`,
        ),
      )
      .orderBy(sql`${similarity} DESC`, customFirst, sql`lower(${schema.exercises.name}) ASC`)
      .limit(limit);
    collect(fuzzy, 'fuzzy');
  }

  return results.slice(0, limit);
}
