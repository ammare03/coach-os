// One valid and one invalid case per `exercises.*` input schema
// (`exercise-library/01`, Files table). The strictness and the length caps
// themselves are proved generically by `conventions.test.ts`; what is
// specific to this module is which fields are optional, what the cursor
// accepts, and the `limit` default.
import {
  getExerciseInput,
  listExercisesInput,
  movementPatternValue,
  searchExercisesInput,
} from '../exercises.ts';

const VALID_ID = '00000000-0000-7000-8000-000000000001';

describe('listExercisesInput', () => {
  it('accepts an empty input and defaults the page size', () => {
    const parsed = listExercisesInput.parse({});

    expect(parsed.limit).toBe(30);
    expect(parsed.cursor).toBeUndefined();
  });

  it('accepts every filter at once', () => {
    const parsed = listExercisesInput.parse({
      primaryMuscle: 'hamstrings',
      equipment: 'Barbell',
      movementPattern: 'hinge',
      limit: 10,
    });

    expect(parsed.movementPattern).toBe('hinge');
  });

  it('rejects a movement pattern outside DB§4 enum', () => {
    expect(() => listExercisesInput.parse({ movementPattern: 'plyometric' })).toThrow();
  });

  it('rejects a limit above the page ceiling', () => {
    expect(() => listExercisesInput.parse({ limit: 101 })).toThrow();
  });

  it('rejects a cursor the API did not issue', () => {
    // Not base64url — a caller assembling a keyset by hand is a caller
    // choosing which rows to skip.
    expect(() => listExercisesInput.parse({ cursor: 'Squat Rack/=' })).toThrow();
  });

  it('rejects an unknown key rather than stripping it', () => {
    expect(() => listExercisesInput.parse({ offset: 20 })).toThrow();
  });
});

describe('getExerciseInput', () => {
  it('accepts a uuid', () => {
    expect(getExerciseInput.parse({ exerciseId: VALID_ID }).exerciseId).toBe(VALID_ID);
  });

  it('rejects a non-uuid id', () => {
    expect(() => getExerciseInput.parse({ exerciseId: 'barbell-back-squat' })).toThrow();
  });
});

describe('searchExercisesInput', () => {
  it('accepts an empty query, which is how the picker opens', () => {
    expect(searchExercisesInput.parse({ query: '' }).query).toBe('');
  });

  it('rejects a query long enough to be a payload', () => {
    expect(() => searchExercisesInput.parse({ query: 'a'.repeat(101) })).toThrow();
  });
});

describe('movementPatternValue', () => {
  it('carries exactly DB§4 eight patterns', () => {
    expect(movementPatternValue.options).toEqual([
      'squat',
      'hinge',
      'push',
      'pull',
      'carry',
      'core',
      'isolation',
      'other',
    ]);
  });
});
