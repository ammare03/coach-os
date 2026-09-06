import { schema } from '@coachos/db';
import { sql, type SQL } from 'drizzle-orm';

// The keyset `exercises.list` paginates on (`exercise-library/01`, Approach
// steps 3 and 4). DB§22 bans `OFFSET` on a list that grows, and the sort key
// is `lower(name)` because Postgres' default collation puts every uppercase
// letter before every lowercase one — a coach's custom "band pull-apart"
// would otherwise land after "Zercher Squat".
//
// `id` breaks ties: exercise names are unique only within a namespace
// (DB§5.2's partial unique index), so a global and a custom exercise can
// legitimately share one, and a keyset on the name alone would skip a row.
//
// EXPLAIN (ANALYZE), seeded library, all three filters plus the keyset
// (`exercise-library/01` Verification step 3): Postgres reaches the rows
// through an Index Scan on `exercises_coach_name` — DB§5.2's partial unique
// index on `(coalesce(coach_id, nil), lower(name)) WHERE archived_at IS
// NULL`, which happens to be exactly this list's predicate and sort prefix
// — then quicksorts the ~20 survivors. 0.25ms at 121 rows. No extra index
// is warranted: the sort is over the filtered set, not the table, and
// `exercises` will not approach 10k rows for a long time. Revisit if the
// picker's per-keystroke path (`exercise-library/05`) ever shows up in the
// §19 budget.

const SEPARATOR = '\u001f';

export interface ExerciseCursor {
  name: string;
  exerciseId: string;
}

/** Opaque on the wire — base64url, so nothing about the sort key invites a client to assemble one. */
export function encodeExerciseCursor(cursor: ExerciseCursor): string {
  return Buffer.from(`${cursor.name}${SEPARATOR}${cursor.exerciseId}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Returns `null` for anything that does not decode to exactly one
 * separator and a non-empty id. A malformed cursor restarts the list from
 * the top rather than throwing: it is never a state the client can recover
 * from by retrying, and a 400 in the middle of an infinite scroll is worse
 * than a rewind.
 */
export function decodeExerciseCursor(raw: string): ExerciseCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separatorAt = decoded.lastIndexOf(SEPARATOR);
  if (separatorAt < 0) return null;
  const name = decoded.slice(0, separatorAt);
  const exerciseId = decoded.slice(separatorAt + 1);
  if (exerciseId.length === 0) return null;
  return { name, exerciseId };
}

/** `ORDER BY lower(name), id` — the one ordering the cursor below assumes. */
export const exerciseListOrder: SQL[] = [
  sql`lower(${schema.exercises.name}) ASC`,
  sql`${schema.exercises.id} ASC`,
];

/**
 * The row-comparison keyset predicate. Postgres compares the tuple
 * left-to-right, which is exactly the ordering above — expressing it as two
 * OR'd inequalities instead is the classic way to get this subtly wrong.
 */
export function afterCursor(cursor: ExerciseCursor): SQL {
  return sql`(lower(${schema.exercises.name}), ${schema.exercises.id}) > (${cursor.name.toLowerCase()}, ${cursor.exerciseId}::uuid)`;
}
