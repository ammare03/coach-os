import type { UpcomingExercise, UpcomingSession } from 'api/src/features/workouts/upcoming.ts';
import { eq, inArray } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../db/client.ts';
import { localExercisesCache } from '../../db/schema/local-training.ts';

// `prefetch/01` Approach step 3 — every exercise a prefetched session
// references, written to `local_exercises_cache` so the logger can name a
// movement, show its cues, and do plate math with no signal.
//
// Three things this file deliberately does NOT do:
//
// 1. It does not fetch. `workouts.upcoming` returns the sessions and their
//    exercise set in one response (`api/src/features/workouts/upcoming.ts`
//    decision (c)) — a second round trip here would be a query waterfall on
//    the exact bad connection prefetch exists to beat, and the `exercises`
//    router is coach-only besides. `sessions.ts` owns the call; this owns
//    the extraction and the write.
//
// 2. It does not download demo video bytes. `local_exercises_cache` as
//    `local-database/02` built it has no demo-URL column, and adding one is
//    a `meta.schema_version` bump owned by that task, not this one — so the
//    URL rides in the session's `payload_json` (`./sessions.ts`), which is
//    where the logger reads its render data from anyway. The bytes are
//    `phase-11-media-pipeline/playback/04`'s job. Known limitation until
//    P11 lands: an offline client has the exercise but may not have its
//    video.
//
// 3. It does not touch `last_used_at`. That column ranks the cache by the
//    client's own usage (mirroring `local_foods_cache`); a background
//    refresh is not a use, and overwriting it would make every exercise
//    look equally recent.

/**
 * Every exercise id the given sessions reference — the prescribed movement
 * of each block plus its coach-approved `alternatives`, since a swap has to
 * work offline too. Deduplicated, insertion-ordered.
 */
export function collectReferencedExerciseIds(sessions: UpcomingSession[]): string[] {
  return [
    ...new Set(
      sessions.flatMap((session) =>
        session.exercises.flatMap((block) => [block.exerciseId, ...block.alternatives]),
      ),
    ),
  ];
}

export interface PrefetchExercisesResult {
  inserted: number;
  updated: number;
}

function cacheRow(exercise: UpcomingExercise): typeof localExercisesCache.$inferInsert {
  return {
    id: exercise.id,
    name: exercise.name,
    primaryMuscle: exercise.primaryMuscle,
    equipment: exercise.equipment,
    movementPattern: exercise.movementPattern,
    isBodyweight: exercise.isBodyweight,
    defaultIncrementKg: exercise.defaultIncrementKg,
    cuesJson: JSON.stringify(exercise.cues),
  };
}

/**
 * Writes the exercises the given sessions reference into
 * `local_exercises_cache`.
 *
 * Read-through, not upsert-through: existing ids are read first and then
 * updated or inserted individually. `ON CONFLICT DO UPDATE` would be
 * shorter, but this table has a device-authored column (`last_used_at`)
 * that must survive a refresh, and an explicit UPDATE naming its columns
 * is the version that cannot clobber it by accident.
 */
export async function writeExerciseCache(
  db: LocalDb,
  exercises: UpcomingExercise[],
): Promise<PrefetchExercisesResult> {
  if (exercises.length === 0) return { inserted: 0, updated: 0 };

  const existing = await db
    .select({ id: localExercisesCache.id })
    .from(localExercisesCache)
    .where(
      inArray(
        localExercisesCache.id,
        exercises.map((exercise) => exercise.id),
      ),
    );
  const existingIds = new Set(existing.map((row) => row.id));

  let inserted = 0;
  let updated = 0;
  for (const exercise of exercises) {
    const row = cacheRow(exercise);
    if (existingIds.has(exercise.id)) {
      const { id: _id, ...columns } = row;
      await db.update(localExercisesCache).set(columns).where(eq(localExercisesCache.id, _id));
      updated += 1;
    } else {
      await db.insert(localExercisesCache).values(row);
      inserted += 1;
    }
  }
  return { inserted, updated };
}

export interface PrefetchExercisesOptions {
  db?: LocalDb;
}

/**
 * Caches every exercise the prefetched sessions reference.
 *
 * The intersection is deliberate rather than trusting the response
 * wholesale: the server sends the referenced set, and this filters to the
 * ids the sessions actually name, so a widened response can never quietly
 * fill the device's cache with the whole library.
 */
export async function prefetchExercises(
  fetched: { sessions: UpcomingSession[]; exercises: UpcomingExercise[] },
  options: PrefetchExercisesOptions = {},
): Promise<PrefetchExercisesResult> {
  const referenced = new Set(collectReferencedExerciseIds(fetched.sessions));
  const wanted = fetched.exercises.filter((exercise) => referenced.has(exercise.id));
  if (wanted.length === 0) return { inserted: 0, updated: 0 };

  const db = options.db ?? (await getLocalDb());
  return writeExerciseCache(db, wanted);
}
