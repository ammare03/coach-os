// `account-lifecycle/09` — one collector per domain schema, each knowing
// nothing about packaging (`../../jobs/data-export.ts` owns that). Every
// WHERE clause here uses the same denormalised owner columns DB§6 exists
// for and `../../trpc/authz/resource-registry.ts` already queries against
// — never a parallel definition of "who owns this row" that could drift
// from the one authorization already trusts (this task's own Risks
// section, and the AC "reuse ownsResource's predicates, never
// reimplement them").
//
// The one rule every function here is written to protect: **a coach's
// collectors never take a clientProfileId, and a client's collectors never
// take a coachProfileId.** There is no parameter that could accidentally
// widen a query to another data subject's rows — the role branch below
// decides which id is even in scope before any query runs.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

export type ExportRole = 'coach' | 'client';

export interface ExportSubject {
  readonly role: ExportRole;
  readonly userId: string;
  readonly coachProfileId: string | null;
  readonly clientProfileId: string | null;
}

/**
 * Resolves which profile row(s) belong to this user — the one lookup every
 * other collector in this module builds on. Throws on a user with neither
 * profile, which should be unreachable (every `users` row gets a matching
 * `coach_profiles` or `client_profiles` row at signup) — refusing loudly
 * here is safer than a collector silently returning empty sections for a
 * data-integrity bug this function is well-placed to catch first.
 */
export async function resolveExportSubject(db: DbClient, userId: string): Promise<ExportSubject> {
  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new Error(`resolveExportSubject: users ${userId} not found`);

  if (user.role === 'coach' || user.role === 'assistant') {
    const [coach] = await db
      .select({ id: schema.coachProfiles.id })
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.userId, userId));
    if (!coach) throw new Error(`resolveExportSubject: coach_profiles for ${userId} not found`);
    return { role: 'coach', userId, coachProfileId: coach.id, clientProfileId: null };
  }

  const [client] = await db
    .select({ id: schema.clientProfiles.id })
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.userId, userId));
  if (!client) throw new Error(`resolveExportSubject: client_profiles for ${userId} not found`);
  return { role: 'client', userId, coachProfileId: null, clientProfileId: client.id };
}

export interface ProfileExport {
  account: {
    id: string;
    email: string;
    name: string;
    role: string;
    timezone: string;
    locale: string;
    weightUnit: string;
    dateOfBirth: string | null;
    analyticsOptOut: boolean;
    aiProcessingOptOut: boolean;
    createdAt: Date;
  };
  notificationPreferences: (typeof schema.notificationPreferences.$inferSelect)[];
  coach: typeof schema.coachProfiles.$inferSelect | null;
  client: typeof schema.clientProfiles.$inferSelect | null;
}

/**
 * `profile.json`. Deliberately hand-picks the `users` columns rather than
 * `select()`-ing the whole row — `password_hash`, `internal_operator`, and
 * every other operational/security column stay out by construction, not by
 * remembering to strip them later (security-and-privacy skill §5's "never
 * in logs, analytics, AI prompts, exports" list — the same discipline,
 * applied here to the export itself for the columns that were never meant
 * to be portable content in the first place). `coach`/`client` below ARE
 * full-row selects — DB§18 explicitly allows a user's own profile fields,
 * including 🔴-classified ones like `injuries`, into their own export.
 */
export async function collectProfile(db: DbClient, subject: ExportSubject): Promise<ProfileExport> {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      timezone: schema.users.timezone,
      locale: schema.users.locale,
      weightUnit: schema.users.weightUnit,
      dateOfBirth: schema.users.dateOfBirth,
      analyticsOptOut: schema.users.analyticsOptOut,
      aiProcessingOptOut: schema.users.aiProcessingOptOut,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, subject.userId));
  if (!user) throw new Error(`collectProfile: users ${subject.userId} not found`);

  const notificationPreferences = await db
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, subject.userId));

  const coach = subject.coachProfileId
    ? ((
        await db
          .select()
          .from(schema.coachProfiles)
          .where(eq(schema.coachProfiles.id, subject.coachProfileId))
      )[0] ?? null)
    : null;
  const client = subject.clientProfileId
    ? ((
        await db
          .select()
          .from(schema.clientProfiles)
          .where(eq(schema.clientProfiles.id, subject.clientProfileId))
      )[0] ?? null)
    : null;

  return { account: user, notificationPreferences, coach, client };
}

export interface TrainingExport {
  sessions: (typeof schema.workoutSessions.$inferSelect & {
    setLogs: (typeof schema.setLogs.$inferSelect)[];
  })[];
  personalRecords: (typeof schema.personalRecords.$inferSelect)[];
  programs: (typeof schema.programs.$inferSelect)[];
}

/**
 * `training/sessions.json` (with `set_logs` nested), `personal-records.json`,
 * `programs.json`. A coach's own authored programs (`training.exercises` is
 * folded into the coach's own catalogue and isn't separately packaged as
 * its own file — the exercises a coach's programs reference are visible in
 * `programExercises`' `exerciseId`, and re-exporting the entire exercise
 * library redundantly per program adds size without adding portable
 * content) — never a client's sessions, sets, or records, matching the
 * role table's "—" for a coach on this whole row.
 */
export async function collectTraining(
  db: DbClient,
  subject: ExportSubject,
): Promise<TrainingExport> {
  if (subject.role === 'coach') {
    if (!subject.coachProfileId)
      throw new Error('collectTraining: coach subject missing coachProfileId');
    const programs = await db
      .select()
      .from(schema.programs)
      .where(eq(schema.programs.coachId, subject.coachProfileId));
    return { sessions: [], personalRecords: [], programs };
  }

  if (!subject.clientProfileId)
    throw new Error('collectTraining: client subject missing clientProfileId');
  const sessions = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.clientId, subject.clientProfileId));
  const sessionIds = sessions.map((s) => s.id);
  const setLogs = sessionIds.length
    ? await db
        .select()
        .from(schema.setLogs)
        .where(inArray(schema.setLogs.workoutSessionId, sessionIds))
    : [];
  const personalRecords = await db
    .select()
    .from(schema.personalRecords)
    .where(eq(schema.personalRecords.clientId, subject.clientProfileId));

  return {
    sessions: sessions.map((session) => ({
      ...session,
      setLogs: setLogs.filter((s) => s.workoutSessionId === session.id),
    })),
    personalRecords,
    programs: [],
  };
}

export interface NutritionExport {
  meals: (typeof schema.meals.$inferSelect & { items: (typeof schema.mealItems.$inferSelect)[] })[];
  dailySummaries: (typeof schema.dailyNutritionSummary.$inferSelect)[];
  waterLogs: (typeof schema.waterLogs.$inferSelect)[];
  mealPlans: (typeof schema.mealPlans.$inferSelect)[];
  mealPlanAssignments: (typeof schema.mealPlanAssignments.$inferSelect)[];
}

/**
 * `nutrition/meals.json` (with `meal_items` nested) and `daily-summaries.json`
 * — client only, per the role table's "—" for a coach's own nutrition
 * (a coach logs no meals of their own through this product). A coach's
 * authored `meal_plans`/`meal_plan_assignments` are the one nutrition-adjacent
 * thing a coach DOES own (the templates and who they're assigned to, never
 * the assignee's actual diary) — included on the coach branch for the same
 * "own authored content" reason `programs` is.
 */
export async function collectNutrition(
  db: DbClient,
  subject: ExportSubject,
): Promise<NutritionExport> {
  if (subject.role === 'coach') {
    if (!subject.coachProfileId)
      throw new Error('collectNutrition: coach subject missing coachProfileId');
    const mealPlans = await db
      .select()
      .from(schema.mealPlans)
      .where(eq(schema.mealPlans.coachId, subject.coachProfileId));
    const mealPlanIds = mealPlans.map((p) => p.id);
    const mealPlanAssignments = mealPlanIds.length
      ? await db
          .select()
          .from(schema.mealPlanAssignments)
          .where(inArray(schema.mealPlanAssignments.mealPlanId, mealPlanIds))
      : [];
    return { meals: [], dailySummaries: [], waterLogs: [], mealPlans, mealPlanAssignments };
  }

  if (!subject.clientProfileId)
    throw new Error('collectNutrition: client subject missing clientProfileId');
  const meals = await db
    .select()
    .from(schema.meals)
    .where(eq(schema.meals.clientId, subject.clientProfileId));
  const mealIds = meals.map((m) => m.id);
  const mealItems = mealIds.length
    ? await db.select().from(schema.mealItems).where(inArray(schema.mealItems.mealId, mealIds))
    : [];
  const dailySummaries = await db
    .select()
    .from(schema.dailyNutritionSummary)
    .where(eq(schema.dailyNutritionSummary.clientId, subject.clientProfileId));
  const waterLogs = await db
    .select()
    .from(schema.waterLogs)
    .where(eq(schema.waterLogs.clientId, subject.clientProfileId));
  const mealPlanAssignments = await db
    .select()
    .from(schema.mealPlanAssignments)
    .where(eq(schema.mealPlanAssignments.clientId, subject.clientProfileId));

  return {
    meals: meals.map((meal) => ({ ...meal, items: mealItems.filter((i) => i.mealId === meal.id) })),
    dailySummaries,
    waterLogs,
    mealPlans: [],
    mealPlanAssignments,
  };
}

export interface CoachingExport {
  checkins: (typeof schema.checkins.$inferSelect)[];
  bodyMetrics: (typeof schema.bodyMetrics.$inferSelect)[];
  habits: (typeof schema.habits.$inferSelect & {
    logs: (typeof schema.habitLogs.$inferSelect)[];
  })[];
  comments: (typeof schema.comments.$inferSelect)[];
  messages: (typeof schema.messages.$inferSelect)[];
  liveSessions: (typeof schema.liveSessions.$inferSelect)[];
  coachNotes: (typeof schema.coachClientNotes.$inferSelect)[];
}

/**
 * `coaching/check-ins.json`, `body-metrics.json`, `habits.json`,
 * `comments.json`, `messages.json` — plus `live-sessions.json` and, for a
 * coach only, their own `coach_client_notes` ("their own professional
 * notes", the role table's own words — never returned to a client, matching
 * `code-conventions`'s standing "never exposed to the client" rule on this
 * table, so `coachNotes` is always `[]` on the client branch, not merely
 * unfiltered-and-happens-to-be-empty).
 *
 * `checkins`/`bodyMetrics`/`habits`/`liveSessions` are client-only per the
 * role table's "—" row for a coach's client-content — the coach branch
 * below returns them empty rather than omitting the fields, so every
 * caller gets one consistent shape regardless of role.
 */
export async function collectCoaching(
  db: DbClient,
  subject: ExportSubject,
): Promise<CoachingExport> {
  const comments =
    subject.role === 'coach' && subject.coachProfileId
      ? await collectCoachComments(db, subject.userId)
      : subject.clientProfileId
        ? await db
            .select()
            .from(schema.comments)
            .where(eq(schema.comments.clientId, subject.clientProfileId))
        : [];

  const messages = await collectMessages(db, subject);

  if (subject.role === 'coach') {
    if (!subject.coachProfileId)
      throw new Error('collectCoaching: coach subject missing coachProfileId');
    const coachNotes = await db
      .select()
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.coachId, subject.coachProfileId));
    return {
      checkins: [],
      bodyMetrics: [],
      habits: [],
      liveSessions: [],
      comments,
      messages,
      coachNotes,
    };
  }

  if (!subject.clientProfileId)
    throw new Error('collectCoaching: client subject missing clientProfileId');
  const checkins = await db
    .select()
    .from(schema.checkins)
    .where(eq(schema.checkins.clientId, subject.clientProfileId));
  const bodyMetrics = await db
    .select()
    .from(schema.bodyMetrics)
    .where(eq(schema.bodyMetrics.clientId, subject.clientProfileId));
  const habits = await db
    .select()
    .from(schema.habits)
    .where(eq(schema.habits.clientId, subject.clientProfileId));
  const habitIds = habits.map((h) => h.id);
  const habitLogs = habitIds.length
    ? await db.select().from(schema.habitLogs).where(inArray(schema.habitLogs.habitId, habitIds))
    : [];
  const liveSessions = await db
    .select()
    .from(schema.liveSessions)
    .where(eq(schema.liveSessions.clientId, subject.clientProfileId));

  return {
    checkins,
    bodyMetrics,
    habits: habits.map((habit) => ({
      ...habit,
      logs: habitLogs.filter((l) => l.habitId === habit.id),
    })),
    liveSessions,
    comments,
    messages,
    coachNotes: [],
  };
}

/**
 * "Comments they wrote AND comments they received" for a coach
 * (`09`'s role table). `comments` has no reliable "who does this concern
 * from the coach's side" column beyond the client thread it's attached
 * to (`../../trpc/authz/resource-registry.ts`'s own comment on why
 * `comment` needs a live join) — so "received" is read as: replies
 * (`parent_comment_id`) to a comment this coach authored. That is a real,
 * bounded definition ("someone responded to my own feedback"), not an
 * approximation of "every comment on every one of my clients' threads",
 * which would be client-authored content this export must never include
 * on the coach's side (this task's single most important rule).
 */
async function collectCoachComments(
  db: DbClient,
  coachUserId: string,
): Promise<(typeof schema.comments.$inferSelect)[]> {
  const authored = await db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.authorUserId, coachUserId));
  const authoredIds = authored.map((c) => c.id);
  const replies = authoredIds.length
    ? await db
        .select()
        .from(schema.comments)
        .where(
          and(
            inArray(schema.comments.parentCommentId, authoredIds),
            isNotNull(schema.comments.parentCommentId),
          ),
        )
    : [];
  const byId = new Map([...authored, ...replies].map((c) => [c.id, c]));
  return [...byId.values()];
}

/** `messages.json` — every message in a conversation this subject is party to. */
async function collectMessages(
  db: DbClient,
  subject: ExportSubject,
): Promise<(typeof schema.messages.$inferSelect)[]> {
  const conversations =
    subject.role === 'coach' && subject.coachProfileId
      ? await db
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.coachId, subject.coachProfileId))
      : subject.clientProfileId
        ? await db
            .select({ id: schema.conversations.id })
            .from(schema.conversations)
            .where(eq(schema.conversations.clientId, subject.clientProfileId))
        : [];
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length === 0) return [];
  return db
    .select()
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, conversationIds));
}

// `Pick`ed from the inferred row type, not a hand-written duplicate of it
// (CLAUDE.md §17.1, DATABASE.md DB§11.2) — `includedAsBytes` is the one
// field this manifest adds that `media_assets` itself doesn't have.
export type MediaManifestEntry = Pick<
  typeof schema.mediaAssets.$inferSelect,
  'id' | 'kind' | 'storageKey' | 'mimeType' | 'sizeBytes' | 'createdAt'
> & {
  /** Photos/images ship as real bytes; video ships as a manifest entry with a link — Approach step 4. */
  includedAsBytes: boolean;
};

/**
 * `media/MANIFEST.json`'s row list. Client-only, matching the role table's
 * "Their own progress photos and videos" — a coach's own media (avatar,
 * brand logo, an exercise demo they filmed) is account/business asset
 * configuration, not personal content the way a client's uploads are, and
 * isn't named anywhere in the archive spec's fixed tree; left out
 * deliberately rather than invented.
 */
export async function collectMediaManifest(
  db: DbClient,
  subject: ExportSubject,
): Promise<MediaManifestEntry[]> {
  if (subject.role === 'coach' || !subject.clientProfileId) return [];

  const assets = await db
    .select()
    .from(schema.mediaAssets)
    .where(
      or(
        eq(schema.mediaAssets.clientId, subject.clientProfileId),
        eq(schema.mediaAssets.ownerUserId, subject.userId),
      ),
    );

  return assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    includedAsBytes: asset.kind === 'image',
  }));
}
