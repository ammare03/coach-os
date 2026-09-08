import type {
  HistoryComment,
  HistoryMeal,
  HistoryMealItem,
  HistorySession,
  HistorySetLog,
} from 'api/src/features/clientApp/history.ts';
import type { MyFood } from 'api/src/features/nutrition/my-foods.ts';

// Builders for `clientApp.history` and `nutrition.myFoods`, shared by this
// folder's task-02 suites. Not a `*.test.ts` file, so Jest never collects
// it as a suite. Shapes are imported from the API feature modules, never
// re-declared — a drift there should fail typecheck here
// (`code-conventions` §3), the same rule `./upcoming.ts` follows.

export function buildSetLog(overrides: Partial<HistorySetLog> = {}): HistorySetLog {
  return {
    id: 'set-1',
    clientLocalId: 'set-local-1',
    workoutSessionId: 'session-1',
    exerciseId: 'exercise-1',
    exerciseName: 'Back Squat',
    setNumber: 1,
    reps: 5,
    weightKg: 102.5,
    rpe: 8.5,
    rir: null,
    isWarmup: false,
    isFailure: false,
    notes: null,
    loggedAt: new Date('2026-08-10T18:10:00.000Z'),
    ...overrides,
  };
}

export function buildHistorySession(overrides: Partial<HistorySession> = {}): HistorySession {
  return {
    id: 'session-1',
    clientLocalId: 'session-local-1',
    programDayId: 'day-1',
    name: null,
    scheduledDate: '2026-08-10',
    status: 'completed',
    startedAt: new Date('2026-08-10T17:00:00.000Z'),
    completedAt: new Date('2026-08-10T18:00:00.000Z'),
    durationSeconds: 3600,
    perceivedExertion: 8,
    clientNotes: 'Felt strong',
    totalVolumeKg: 5400,
    updatedAt: new Date('2026-08-10T18:00:05.000Z'),
    dayName: 'Push A',
    setLogs: [buildSetLog()],
    ...overrides,
  };
}

export function buildMealItem(overrides: Partial<HistoryMealItem> = {}): HistoryMealItem {
  return {
    name: 'Dal',
    quantityG: 150,
    calories: 247.5,
    proteinG: 46.5,
    carbsG: 0,
    fatG: 5.4,
    ...overrides,
  };
}

export function buildHistoryMeal(overrides: Partial<HistoryMeal> = {}): HistoryMeal {
  return {
    id: 'meal-1',
    clientLocalId: 'meal-local-1',
    loggedDate: '2026-08-10',
    mealType: 'lunch',
    loggedAt: new Date('2026-08-10T12:00:00.000Z'),
    notes: 'Post-session',
    updatedAt: new Date('2026-08-10T12:00:01.000Z'),
    items: [buildMealItem()],
    ...overrides,
  };
}

export function buildHistoryComment(overrides: Partial<HistoryComment> = {}): HistoryComment {
  return {
    id: 'comment-1',
    targetType: 'workout_session',
    targetId: 'session-1',
    authorUserId: 'coach-user-1',
    body: 'Nice depth on set three',
    voiceNoteAssetId: null,
    videoReplyAssetId: null,
    timestampMs: null,
    annotation: null,
    parentCommentId: null,
    isAiGenerated: false,
    createdAt: new Date('2026-08-10T19:00:00.000Z'),
    ...overrides,
  };
}

export function buildMyFood(overrides: Partial<MyFood> = {}): MyFood {
  return {
    id: 'food-1',
    name: 'Ragi Mudde',
    brand: null,
    barcode: '8901234567890',
    servingSizeG: 100,
    servingLabel: '1 ball',
    caloriesPer100g: 132,
    proteinG: 3.2,
    carbsG: 28.1,
    fatG: 0.5,
    ranking: 'personal',
    logCount: 12,
    lastLoggedAt: new Date('2026-08-14T07:30:00.000Z'),
    ...overrides,
  };
}
