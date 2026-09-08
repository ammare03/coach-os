import {
  schema,
  type Comment,
  type DbClient,
  type Meal,
  type SetLog,
  type WorkoutSession,
} from '@coachos/db';
import { localDateRangeUtc, parseNumeric, type CalendarDate } from '@coachos/utils';
import { and, asc, between, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

// `clientApp.history` — the trailing-30-days read
// `phase-08-offline-core/prefetch/02` consumes, so that `offline-sync` §1's
// "reading the last 30 days of history and all coach comments" is true with
// no signal. Built here ahead of P12 and P13 for the same reason
// `../workouts/upcoming.ts` was built ahead of P09.
//
// Four decisions worth knowing before changing anything here:
//
// (a) ONE response, not three. Sessions, meals, and comments come back
//     together because three round trips on the connection prefetch exists
//     to beat is a query waterfall (`UI-UX.md` §UX8,
//     `frontend-performance`) — the same decision `upcoming.ts` (c) made
//     for sessions and their exercises.
//
// (b) It is a point-in-time SNAPSHOT, not a feature read. P12's
//     `comments.list` (one thread, cursor-paginated) and P13's
//     `nutrition.diary` (one day, with targets and the daily summary) are
//     differently shaped questions over the same rows; they build their
//     own procedures and neither is expected to reshape this one. This one
//     answers "give me everything I might want to look at offline", which
//     no feature screen ever asks.
//
// (c) Sessions carry their SET LOGS, not their prescription. A past
//     session is read to see what was actually done; the live prescription
//     belongs to `workouts.upcoming`, which owns today and tomorrow. Each
//     set carries its exercise's name so a history screen can render with
//     nothing but this response and `local_workout_sessions.payload_json`.
//
// (d) Comments have no calendar-day column, so the range is resolved
//     through the CALLER'S STORED timezone (`users.timezone`), passed in by
//     the router — never the server's own clock and never a device-reported
//     zone (`code-conventions` §6). `created_at` is an instant; `from`/`to`
//     are the client's local days; `localDateRangeUtc` is the only thing
//     allowed to bridge them.

export interface HistorySetLog extends Pick<
  SetLog,
  | 'id'
  | 'clientLocalId'
  | 'workoutSessionId'
  | 'exerciseId'
  | 'setNumber'
  | 'reps'
  | 'rir'
  | 'isWarmup'
  | 'isFailure'
  | 'notes'
  | 'loggedAt'
> {
  /** Denormalised so a history screen needs no exercise lookup offline — decision (c). */
  exerciseName: string;
  /** `numeric` columns parsed once, here (`code-conventions` §3). */
  weightKg: number | null;
  rpe: number | null;
}

export interface HistorySession extends Pick<
  WorkoutSession,
  | 'id'
  | 'clientLocalId'
  | 'programDayId'
  | 'name'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'durationSeconds'
  | 'perceivedExertion'
  | 'clientNotes'
  | 'updatedAt'
> {
  scheduledDate: CalendarDate;
  /** The program day's own label — "Push A", which the session's own `name` is not. */
  dayName: string | null;
  totalVolumeKg: number | null;
  setLogs: HistorySetLog[];
}

export interface HistoryMealItem {
  /** The food's name, or the client's own quick-add label — whichever the item carries. */
  name: string;
  quantityG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface HistoryMeal extends Pick<
  Meal,
  'id' | 'clientLocalId' | 'mealType' | 'loggedAt' | 'notes' | 'updatedAt'
> {
  loggedDate: CalendarDate;
  items: HistoryMealItem[];
}

export interface HistoryComment extends Pick<
  Comment,
  | 'id'
  | 'targetType'
  | 'targetId'
  | 'authorUserId'
  | 'body'
  | 'voiceNoteAssetId'
  | 'videoReplyAssetId'
  | 'timestampMs'
  | 'parentCommentId'
  | 'isAiGenerated'
  | 'createdAt'
> {
  /** `jsonb`, shape owned by §8.6's annotator; opaque to this read and to the device. */
  annotation: unknown;
}

export interface ClientHistory {
  sessions: HistorySession[];
  meals: HistoryMeal[];
  comments: HistoryComment[];
}

export interface ClientHistoryRange {
  from: CalendarDate;
  to: CalendarDate;
}

async function listSessions(
  db: DbClient,
  clientProfileId: string,
  range: ClientHistoryRange,
): Promise<HistorySession[]> {
  const sessionRows = await db
    .select({
      id: schema.workoutSessions.id,
      clientLocalId: schema.workoutSessions.clientLocalId,
      programDayId: schema.workoutSessions.programDayId,
      name: schema.workoutSessions.name,
      scheduledDate: schema.workoutSessions.scheduledDate,
      status: schema.workoutSessions.status,
      startedAt: schema.workoutSessions.startedAt,
      completedAt: schema.workoutSessions.completedAt,
      durationSeconds: schema.workoutSessions.durationSeconds,
      perceivedExertion: schema.workoutSessions.perceivedExertion,
      clientNotes: schema.workoutSessions.clientNotes,
      totalVolumeKg: schema.workoutSessions.totalVolumeKg,
      updatedAt: schema.workoutSessions.updatedAt,
      dayName: schema.programDays.name,
    })
    .from(schema.workoutSessions)
    .leftJoin(schema.programDays, eq(schema.programDays.id, schema.workoutSessions.programDayId))
    .where(
      and(
        eq(schema.workoutSessions.clientId, clientProfileId),
        between(schema.workoutSessions.scheduledDate, range.from, range.to),
        isNull(schema.workoutSessions.deletedAt),
      ),
    )
    .orderBy(asc(schema.workoutSessions.scheduledDate), asc(schema.workoutSessions.id));

  if (sessionRows.length === 0) return [];

  const setRows = await db
    .select({
      id: schema.setLogs.id,
      clientLocalId: schema.setLogs.clientLocalId,
      workoutSessionId: schema.setLogs.workoutSessionId,
      exerciseId: schema.setLogs.exerciseId,
      exerciseName: schema.exercises.name,
      setNumber: schema.setLogs.setNumber,
      reps: schema.setLogs.reps,
      weightKg: schema.setLogs.weightKg,
      rpe: schema.setLogs.rpe,
      rir: schema.setLogs.rir,
      isWarmup: schema.setLogs.isWarmup,
      isFailure: schema.setLogs.isFailure,
      notes: schema.setLogs.notes,
      loggedAt: schema.setLogs.loggedAt,
    })
    .from(schema.setLogs)
    .innerJoin(schema.exercises, eq(schema.exercises.id, schema.setLogs.exerciseId))
    .where(
      and(
        inArray(
          schema.setLogs.workoutSessionId,
          sessionRows.map((row) => row.id),
        ),
        isNull(schema.setLogs.deletedAt),
      ),
    )
    .orderBy(asc(schema.setLogs.workoutSessionId), asc(schema.setLogs.setNumber));

  const setsBySession = new Map<string, HistorySetLog[]>();
  for (const row of setRows) {
    const sets = setsBySession.get(row.workoutSessionId) ?? [];
    sets.push({
      id: row.id,
      clientLocalId: row.clientLocalId,
      workoutSessionId: row.workoutSessionId,
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: row.weightKg === null ? null : parseNumeric(row.weightKg, 2),
      rpe: row.rpe === null ? null : parseNumeric(row.rpe, 1),
      rir: row.rir,
      isWarmup: row.isWarmup,
      isFailure: row.isFailure,
      notes: row.notes,
      loggedAt: row.loggedAt,
    });
    setsBySession.set(row.workoutSessionId, sets);
  }

  return sessionRows.map((row) => ({
    id: row.id,
    clientLocalId: row.clientLocalId,
    programDayId: row.programDayId,
    name: row.name,
    scheduledDate: row.scheduledDate,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationSeconds: row.durationSeconds,
    perceivedExertion: row.perceivedExertion,
    clientNotes: row.clientNotes,
    totalVolumeKg: row.totalVolumeKg === null ? null : parseNumeric(row.totalVolumeKg, 2),
    updatedAt: row.updatedAt,
    dayName: row.dayName,
    setLogs: setsBySession.get(row.id) ?? [],
  }));
}

async function listMeals(
  db: DbClient,
  clientProfileId: string,
  range: ClientHistoryRange,
): Promise<HistoryMeal[]> {
  const mealRows = await db
    .select({
      id: schema.meals.id,
      clientLocalId: schema.meals.clientLocalId,
      loggedDate: schema.meals.loggedDate,
      mealType: schema.meals.mealType,
      loggedAt: schema.meals.loggedAt,
      notes: schema.meals.notes,
      updatedAt: schema.meals.updatedAt,
    })
    .from(schema.meals)
    .where(
      and(
        eq(schema.meals.clientId, clientProfileId),
        between(schema.meals.loggedDate, range.from, range.to),
        isNull(schema.meals.deletedAt),
      ),
    )
    .orderBy(asc(schema.meals.loggedDate), asc(schema.meals.loggedAt), asc(schema.meals.id));

  if (mealRows.length === 0) return [];

  const itemRows = await db
    .select({
      mealId: schema.mealItems.mealId,
      id: schema.mealItems.id,
      customName: schema.mealItems.customName,
      foodName: schema.foods.name,
      quantityG: schema.mealItems.quantityG,
      calories: schema.mealItems.calories,
      proteinG: schema.mealItems.proteinG,
      carbsG: schema.mealItems.carbsG,
      fatG: schema.mealItems.fatG,
    })
    .from(schema.mealItems)
    // LEFT, not INNER: `meal_items.food_id` is nullable — the quick-add
    // path carries only a `custom_name`, and an inner join would silently
    // drop exactly the items a client typed themselves.
    .leftJoin(schema.foods, eq(schema.foods.id, schema.mealItems.foodId))
    .where(
      inArray(
        schema.mealItems.mealId,
        mealRows.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.mealItems.mealId), asc(schema.mealItems.id));

  const itemsByMeal = new Map<string, HistoryMealItem[]>();
  for (const row of itemRows) {
    const items = itemsByMeal.get(row.mealId) ?? [];
    items.push({
      // `item_identified` guarantees at least one of the two is present.
      name: row.customName ?? row.foodName ?? '',
      quantityG: parseNumeric(row.quantityG, 2),
      calories: parseNumeric(row.calories, 2),
      proteinG: parseNumeric(row.proteinG, 2),
      carbsG: parseNumeric(row.carbsG, 2),
      fatG: parseNumeric(row.fatG, 2),
    });
    itemsByMeal.set(row.mealId, items);
  }

  return mealRows.map((row) => ({
    id: row.id,
    clientLocalId: row.clientLocalId,
    loggedDate: row.loggedDate,
    mealType: row.mealType,
    loggedAt: row.loggedAt,
    notes: row.notes,
    updatedAt: row.updatedAt,
    items: itemsByMeal.get(row.id) ?? [],
  }));
}

async function listComments(
  db: DbClient,
  clientProfileId: string,
  range: ClientHistoryRange,
  timeZone: string,
): Promise<HistoryComment[]> {
  // Decision (d) — the client's local days turned into the UTC instants
  // that bound them, once, here.
  const { start } = localDateRangeUtc(range.from, timeZone);
  const { end } = localDateRangeUtc(range.to, timeZone);

  const rows = await db
    .select({
      id: schema.comments.id,
      targetType: schema.comments.targetType,
      targetId: schema.comments.targetId,
      authorUserId: schema.comments.authorUserId,
      body: schema.comments.body,
      voiceNoteAssetId: schema.comments.voiceNoteAssetId,
      videoReplyAssetId: schema.comments.videoReplyAssetId,
      timestampMs: schema.comments.timestampMs,
      annotation: schema.comments.annotation,
      parentCommentId: schema.comments.parentCommentId,
      isAiGenerated: schema.comments.isAiGenerated,
      createdAt: schema.comments.createdAt,
    })
    .from(schema.comments)
    .where(
      and(
        eq(schema.comments.clientId, clientProfileId),
        gte(schema.comments.createdAt, start),
        lt(schema.comments.createdAt, end),
        isNull(schema.comments.deletedAt),
      ),
    )
    .orderBy(asc(schema.comments.createdAt), asc(schema.comments.id));

  return rows;
}

/**
 * Everything the client may want to read offline over `range`: their
 * sessions with the sets they logged, their meals with the items in them,
 * and every comment on their own work.
 *
 * The three reads are independent and run concurrently — one response
 * (decision (a)) does not mean one serial query chain.
 */
export async function getClientHistory(
  db: DbClient,
  clientProfileId: string,
  range: ClientHistoryRange,
  timeZone: string,
): Promise<ClientHistory> {
  const [sessions, meals, comments] = await Promise.all([
    listSessions(db, clientProfileId, range),
    listMeals(db, clientProfileId, range),
    listComments(db, clientProfileId, range, timeZone),
  ]);
  return { sessions, meals, comments };
}
