import type {
  UpcomingContext,
  UpcomingDayContext,
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

export function buildDayContext(overrides: Partial<UpcomingDayContext> = {}): UpcomingDayContext {
  return {
    date: '2026-08-15',
    isRestDay: false,
    weekNumber: 6,
    dayName: 'Push A',
    ...overrides,
  };
}

/**
 * `workouts.upcoming`'s context object (`today-card/01`). The default is a
 * client mid-program on a training day; the two states the Today card has
 * to tell apart are `buildContext({ hasActiveAssignment: false, ... })` and
 * a `days` entry with `isRestDay: true`.
 */
export function buildContext(overrides: Partial<UpcomingContext> = {}): UpcomingContext {
  return {
    hasActiveAssignment: true,
    programName: 'Hypertrophy Block 2',
    totalWeeks: 12,
    days: [buildDayContext(), buildDayContext({ date: '2026-08-16', dayName: 'Pull A' })],
    ...overrides,
  };
}

/** The whole response, for a fetcher stub. */
export function buildUpcoming(
  overrides: Partial<{
    sessions: UpcomingSession[];
    exercises: UpcomingExercise[];
    context: UpcomingContext;
  }> = {},
) {
  return {
    sessions: [buildSession()],
    exercises: [buildExercise()],
    context: buildContext(),
    ...overrides,
  };
}
