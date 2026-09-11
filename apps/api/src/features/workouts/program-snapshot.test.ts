import type { UpcomingSessionExercise } from './program-blocks.ts';
import { readProgramSnapshot, wrapProgramSnapshot } from './program-snapshot.ts';

// The JSONB column is server-written, so this guard is not defending
// against a hostile client — it is defending against an OLD one. A row
// frozen by a build that wrote a different envelope must degrade to "no
// snapshot" rather than throw, because the throw would land in the middle
// of a client's workout and the degradation costs them nothing they can
// see (`session-runtime/09`, Approach step 8).

function block(overrides: Partial<UpcomingSessionExercise> = {}): UpcomingSessionExercise {
  return {
    programExerciseId: '0199a000-0000-7000-8000-000000000001',
    exerciseId: '0199b000-0000-7000-8000-000000000001',
    orderIndex: 0,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRpe: 8,
    targetRir: null,
    targetWeightKg: 60,
    targetPercent1rm: null,
    targetRestSeconds: 120,
    tempo: null,
    supersetGroup: null,
    alternatives: [],
    coachNotes: null,
    ...overrides,
  };
}

describe('wrapProgramSnapshot / readProgramSnapshot', () => {
  it('round-trips a prescription through the envelope', () => {
    const blocks = [block(), block({ orderIndex: 1, targetSets: 4 })];

    const stored: unknown = JSON.parse(JSON.stringify(wrapProgramSnapshot(blocks)));

    expect(readProgramSnapshot(stored)).toEqual(blocks);
  });

  it('reads a frozen EMPTY day as an empty prescription, not as absent', () => {
    // A coach may freeze a day with no blocks on it. "[]" and "never
    // frozen" are different facts: the first keeps the session frozen.
    const stored: unknown = JSON.parse(JSON.stringify(wrapProgramSnapshot([])));

    expect(readProgramSnapshot(stored)).toEqual([]);
  });

  it('returns null for a column that was never written', () => {
    expect(readProgramSnapshot(null)).toBeNull();
    expect(readProgramSnapshot(undefined)).toBeNull();
  });

  it('returns null for an envelope from a version this build does not know', () => {
    expect(readProgramSnapshot({ version: 99, exercises: [block()] })).toBeNull();
  });

  it('returns null rather than throwing on a shape it cannot read', () => {
    expect(readProgramSnapshot({ exercises: [block()] })).toBeNull();
    expect(readProgramSnapshot({ version: 1 })).toBeNull();
    expect(readProgramSnapshot({ version: 1, exercises: 'nope' })).toBeNull();
    expect(readProgramSnapshot([block()])).toBeNull();
    expect(readProgramSnapshot('{}')).toBeNull();
    expect(readProgramSnapshot(7)).toBeNull();
  });

  it('rejects an entry that is missing the two ids the logger pages on', () => {
    const withoutKey: Record<string, unknown> = { ...block() };
    delete withoutKey.programExerciseId;

    expect(readProgramSnapshot({ version: 1, exercises: [withoutKey] })).toBeNull();
    expect(readProgramSnapshot({ version: 1, exercises: [{ programExerciseId: 'a' }] })).toBeNull();
  });

  it('rejects an entry whose numerics came back as strings', () => {
    // The whole point of storing parsed numbers (`./program-blocks.ts`):
    // a snapshot carrying "60.00" would render a target line the live one
    // never would, and nothing downstream re-parses.
    expect(
      readProgramSnapshot({ version: 1, exercises: [{ ...block(), targetWeightKg: '60.00' }] }),
    ).toBeNull();
    expect(
      readProgramSnapshot({ version: 1, exercises: [{ ...block(), targetSets: '3' }] }),
    ).toBeNull();
  });
});
