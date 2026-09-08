import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { buildBlock, buildExercise, buildSession } from './__fixtures__/upcoming.ts';
import { collectReferencedExerciseIds, prefetchExercises } from './exercises.ts';

type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

async function readCache(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM local_exercises_cache`);
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
});

describe('collectReferencedExerciseIds', () => {
  it('includes the prescribed exercise and every coach-approved swap', () => {
    const session = buildSession({
      exercises: [buildBlock({ exerciseId: 'exercise-1', alternatives: ['alt-a', 'alt-b'] })],
    });

    expect(collectReferencedExerciseIds([session])).toEqual(['exercise-1', 'alt-a', 'alt-b']);
  });

  it('deduplicates across sessions and blocks', () => {
    const first = buildSession({
      id: 'a',
      exercises: [buildBlock({ exerciseId: 'exercise-1', alternatives: ['alt-a'] })],
    });
    const second = buildSession({
      id: 'b',
      exercises: [
        buildBlock({ programExerciseId: 'block-2', exerciseId: 'alt-a' }),
        buildBlock({ programExerciseId: 'block-3', exerciseId: 'exercise-2' }),
      ],
    });

    expect(collectReferencedExerciseIds([first, second])).toEqual([
      'exercise-1',
      'alt-a',
      'exercise-2',
    ]);
  });

  it('returns nothing for a session with no blocks', () => {
    expect(collectReferencedExerciseIds([buildSession({ exercises: [] })])).toEqual([]);
  });
});

describe('prefetchExercises', () => {
  it('caches every exercise the sessions reference', async () => {
    const session = buildSession({
      exercises: [buildBlock({ exerciseId: 'exercise-1', alternatives: ['exercise-2'] })],
    });

    const result = await prefetchExercises({
      sessions: [session],
      exercises: [buildExercise(), buildExercise({ id: 'exercise-2', name: 'Goblet Squat' })],
    });

    expect(result).toEqual({ inserted: 2, updated: 0 });
    const rows = await readCache();
    expect(rows.map((row) => row.id).sort()).toEqual(['exercise-1', 'exercise-2']);
    expect(rows.find((row) => row.id === 'exercise-1')).toMatchObject({
      name: 'Back Squat',
      primary_muscle: 'quads',
      equipment: 'barbell',
      movement_pattern: 'squat',
      is_bodyweight: 0,
      default_increment_kg: 2.5,
      cues_json: JSON.stringify(['Brace hard', 'Knees out']),
    });
  });

  it('ignores an exercise no prefetched session references', async () => {
    const result = await prefetchExercises({
      sessions: [buildSession({ exercises: [buildBlock({ exerciseId: 'exercise-1' })] })],
      exercises: [buildExercise(), buildExercise({ id: 'unreferenced', name: 'Sled Push' })],
    });

    expect(result).toEqual({ inserted: 1, updated: 0 });
    expect((await readCache()).map((row) => row.id)).toEqual(['exercise-1']);
  });

  it('updates an already-cached exercise without duplicating it or resetting last_used_at', async () => {
    const fetched = { sessions: [buildSession()], exercises: [buildExercise()] };
    await prefetchExercises(fetched);

    // `last_used_at` is device-authored usage ranking, not server truth —
    // a refresh must leave it exactly where the client's own use put it.
    const db = await getLocalDb();
    db.run(sql`UPDATE local_exercises_cache SET last_used_at = ${1_757_000_000_000}`);

    const result = await prefetchExercises({
      sessions: fetched.sessions,
      exercises: [buildExercise({ name: 'Back Squat (High Bar)' })],
    });

    expect(result).toEqual({ inserted: 0, updated: 1 });
    const rows = await readCache();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Back Squat (High Bar)',
      last_used_at: 1_757_000_000_000,
    });
  });

  it('writes nothing when there is nothing to cache', async () => {
    const result = await prefetchExercises({ sessions: [], exercises: [] });

    expect(result).toEqual({ inserted: 0, updated: 0 });
    expect(await readCache()).toHaveLength(0);
  });
});
