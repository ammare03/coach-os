import type {
  UpcomingExercise,
  UpcomingSession,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';

// Builders for `workouts.upcoming`'s response, shared by this folder's two
// suites. Not a `*.test.ts` file, so Jest never collects it as a suite.
// The shapes are imported from the API feature module, never re-declared —
// a drift there should fail typecheck here (`code-conventions` §3).

export function buildBlock(
  overrides: Partial<UpcomingSessionExercise> = {},
): UpcomingSessionExercise {
  return {
    programExerciseId: 'block-1',
    exerciseId: 'exercise-1',
    orderIndex: 1,
    targetSets: 4,
    targetRepsMin: 6,
    targetRepsMax: 8,
    targetRpe: 8.5,
    targetRir: null,
    targetWeightKg: 62.5,
    targetPercent1rm: null,
    targetRestSeconds: 120,
    tempo: '3010',
    supersetGroup: null,
    alternatives: [],
    coachNotes: null,
    ...overrides,
  };
}

export function buildSession(overrides: Partial<UpcomingSession> = {}): UpcomingSession {
  return {
    id: 'session-1',
    clientLocalId: 'local-1',
    assignmentId: 'assignment-1',
    programDayId: 'day-1',
    name: null,
    scheduledDate: '2026-08-15',
    status: 'scheduled',
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-08-14T09:00:00.000Z'),
    dayName: 'Push A',
    dayNotes: 'Leave one in reserve',
    exercises: [buildBlock()],
    ...overrides,
  };
}

export function buildExercise(overrides: Partial<UpcomingExercise> = {}): UpcomingExercise {
  return {
    id: 'exercise-1',
    name: 'Back Squat',
    primaryMuscle: 'quads',
    equipment: 'barbell',
    movementPattern: 'squat',
    isBodyweight: false,
    defaultIncrementKg: 2.5,
    cues: ['Brace hard', 'Knees out'],
    demoAssetId: 'asset-1',
    demoVideoUrl: 'https://r2.test/demos/back-squat.mp4',
    ...overrides,
  };
}
