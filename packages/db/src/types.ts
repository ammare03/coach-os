// Barrel — every table's inferred row types, re-exported. Starts empty on
// purpose (db-package-scaffold/05): no table exists yet. Features 2 through
// 6 each add their own exports here as they define tables; nothing
// redeclares a row shape anywhere else in the codebase (CLAUDE.md §17.1).
//
// The convention every later export follows, for a table `setLogs`
// (DATABASE.md DB§11.2's own example):
//
//   export type SetLog    = typeof setLogs.$inferSelect;
//   export type NewSetLog = typeof setLogs.$inferInsert;
//
// `apps/api` routers and `apps/mobile` features import the row type from
// here, never from `./schema/*` directly and never by hand-writing an
// `interface`/`type` that mirrors a table — `eslint.base.js`'s
// `local/no-hand-written-row-type` rule flags the common case of the
// latter.
import type {
  bodyMetrics,
  checkinTemplates,
  checkins,
  comments,
  conversations,
  habitLogs,
  habits,
  liveSessionParticipants,
  liveSessions,
  mediaAssets,
  messages,
  progressPhotos,
  reactions,
} from './schema/coaching.ts';
import type {
  authProviders,
  clientProfiles,
  coachClientNotes,
  coachProfiles,
  devices,
  invites,
  refreshTokens,
  users,
} from './schema/identity.ts';
import type {
  dailyNutritionSummary,
  foods,
  mealItems,
  mealPlanAssignments,
  mealPlanDays,
  mealPlanItems,
  mealPlans,
  meals,
  waterLogs,
} from './schema/nutrition.ts';
import type { auditLog, notificationPreferences, notifications } from './schema/platform.ts';
import type {
  assignments,
  exercises,
  personalRecords,
  programDays,
  programExercises,
  programs,
  programWeeks,
  setLogs,
  workoutSessions,
} from './schema/training.ts';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type AuthProvider = typeof authProviders.$inferSelect;
export type NewAuthProvider = typeof authProviders.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export type CoachProfile = typeof coachProfiles.$inferSelect;
export type NewCoachProfile = typeof coachProfiles.$inferInsert;

export type ClientProfile = typeof clientProfiles.$inferSelect;
export type NewClientProfile = typeof clientProfiles.$inferInsert;

// ⚠️ NEVER exposed to the client. No tRPC procedure returns this to
// role='client' (DATABASE.md DB§5.1's own in-line warning,
// identity-schema/04). Restated here as a forward pointer for whoever
// implements this table's router in P02/P03.
export type CoachClientNote = typeof coachClientNotes.$inferSelect;
export type NewCoachClientNote = typeof coachClientNotes.$inferInsert;

export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;

export type Program = typeof programs.$inferSelect;
export type NewProgram = typeof programs.$inferInsert;

export type ProgramWeek = typeof programWeeks.$inferSelect;
export type NewProgramWeek = typeof programWeeks.$inferInsert;

export type ProgramDay = typeof programDays.$inferSelect;
export type NewProgramDay = typeof programDays.$inferInsert;

export type ProgramExercise = typeof programExercises.$inferSelect;
export type NewProgramExercise = typeof programExercises.$inferInsert;

export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;

export type SetLog = typeof setLogs.$inferSelect;
export type NewSetLog = typeof setLogs.$inferInsert;

export type PersonalRecord = typeof personalRecords.$inferSelect;
export type NewPersonalRecord = typeof personalRecords.$inferInsert;

export type Food = typeof foods.$inferSelect;
export type NewFood = typeof foods.$inferInsert;

export type Meal = typeof meals.$inferSelect;
export type NewMeal = typeof meals.$inferInsert;

export type MealItem = typeof mealItems.$inferSelect;
export type NewMealItem = typeof mealItems.$inferInsert;

export type DailyNutritionSummary = typeof dailyNutritionSummary.$inferSelect;
export type NewDailyNutritionSummary = typeof dailyNutritionSummary.$inferInsert;

export type MealPlan = typeof mealPlans.$inferSelect;
export type NewMealPlan = typeof mealPlans.$inferInsert;

export type MealPlanDay = typeof mealPlanDays.$inferSelect;
export type NewMealPlanDay = typeof mealPlanDays.$inferInsert;

export type MealPlanItem = typeof mealPlanItems.$inferSelect;
export type NewMealPlanItem = typeof mealPlanItems.$inferInsert;

export type MealPlanAssignment = typeof mealPlanAssignments.$inferSelect;
export type NewMealPlanAssignment = typeof mealPlanAssignments.$inferInsert;

export type WaterLog = typeof waterLogs.$inferSelect;
export type NewWaterLog = typeof waterLogs.$inferInsert;

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;

export type CheckinTemplate = typeof checkinTemplates.$inferSelect;
export type NewCheckinTemplate = typeof checkinTemplates.$inferInsert;

export type Checkin = typeof checkins.$inferSelect;
export type NewCheckin = typeof checkins.$inferInsert;

export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type NewBodyMetric = typeof bodyMetrics.$inferInsert;

// ⚠️ HIGHEST SENSITIVITY — DATABASE.md DB§18. Never joined into any export,
// analytics, or AI prompt.
export type ProgressPhoto = typeof progressPhotos.$inferSelect;
export type NewProgressPhoto = typeof progressPhotos.$inferInsert;

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;

export type HabitLog = typeof habitLogs.$inferSelect;
export type NewHabitLog = typeof habitLogs.$inferInsert;

export type LiveSession = typeof liveSessions.$inferSelect;
export type NewLiveSession = typeof liveSessions.$inferInsert;

export type LiveSessionParticipant = typeof liveSessionParticipants.$inferSelect;
export type NewLiveSessionParticipant = typeof liveSessionParticipants.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

// ⚠️ Append-only — see the DO INSTEAD NOTHING warning on `auditLog` itself
// in schema/platform.ts.
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
