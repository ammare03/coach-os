import {
  schema,
  type DbClient,
  type Exercise,
  type ProgramExercise,
  type WorkoutSession,
} from '@coachos/db';
import { parseNumeric, type CalendarDate } from '@coachos/utils';
import { and, asc, between, eq, inArray, isNull } from 'drizzle-orm';

// `workouts.upcoming` — the one read `phase-08-offline-core/prefetch/01`
// consumes. Built here, ahead of `phase-09-workout-logger`, because P08
// precedes P09 in build order and prefetch has nothing to prefetch without
// it. `phase-09-workout-logger/today-card/02` extends this rather than
// adding a second procedure over the same rows.
//
// Four decisions worth knowing before changing anything here:
//
// (a) It answers for ONE client — the caller — and takes no `clientId`.
//     The router builds it on `clientProcedure` and passes
//     `ctx.user.clientProfileId`, so `ownsResource` has nothing to guard:
//     there is no caller-supplied id that could name someone else's row
//     (`api-conventions` §3, the same shape as `clientApp.coach`).
//
// (b) The prescription resolves LIVE through `program_day_id`, never from
//     `workout_sessions.program_snapshot` (`../programs/versioning.md`). A
//     materialised session is a shell (`../../lib/materialise-sessions.ts`
//     decision (c)); everything the logger renders comes from the program
//     day it points at.
//
// (c) Sessions and their exercises come back in ONE response, not two. The
//     `exercises` router is coach-only, so a client has no procedure to
//     resolve an exercise id against — and even if it had one, a second
//     round trip is a query waterfall on exactly the connection prefetch
//     exists to beat (`frontend-performance`, `UI-UX.md` §UX8).
//     `alternatives` are in that set too: a coach-approved swap has to
//     work with no signal.
//
// (d) The demo video URL is signed here and cached by the device as a URL
//     only. `phase-11-media-pipeline/playback/04` owns downloading the
//     bytes; until it lands, an offline client gets the exercise's data
//     and cues but not necessarily its video (prefetch task 01, Approach
//     step 4). A signing failure degrades to null and never fails the
//     read — a missing demo video must not cost a client their workout.

/** Seven days, SigV4's own ceiling — a URL signed tonight still plays tomorrow. */
const DEMO_URL_TTL_SECONDS = 604_800;

/** Resolves an R2 object key to a URL the device can play. Injected in tests. */
export type DemoUrlResolver = (storageKey: string) => Promise<string | null>;

export interface UpcomingSessionExercise extends Pick<
  ProgramExercise,
  | 'orderIndex'
  | 'targetSets'
  | 'targetRepsMin'
  | 'targetRepsMax'
  | 'targetRir'
  | 'targetRestSeconds'
  | 'tempo'
  | 'supersetGroup'
  | 'alternatives'
  | 'coachNotes'
> {
  programExerciseId: string;
  exerciseId: string;
  /** `numeric` columns parsed once, here, and never re-parsed downstream (`code-conventions` §3). */
  targetRpe: number | null;
  targetWeightKg: number | null;
  targetPercent1rm: number | null;
}

export interface UpcomingSession extends Pick<
  WorkoutSession,
  | 'id'
  | 'clientLocalId'
  | 'assignmentId'
  | 'programDayId'
  | 'name'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'updatedAt'
> {
  scheduledDate: CalendarDate;
  /** The program day's own label and notes — "Push A", which the session's own `name` is not. */
  dayName: string | null;
  dayNotes: string | null;
  exercises: UpcomingSessionExercise[];
}

export interface UpcomingExercise extends Pick<
  Exercise,
  'id' | 'name' | 'primaryMuscle' | 'equipment' | 'movementPattern' | 'isBodyweight' | 'cues'
> {
  defaultIncrementKg: number | null;
  demoAssetId: string | null;
  demoVideoUrl: string | null;
}

export interface UpcomingWorkouts {
  sessions: UpcomingSession[];
  exercises: UpcomingExercise[];
}

export interface UpcomingWorkoutsRange {
  from: CalendarDate;
  to: CalendarDate;
}

export interface ListUpcomingWorkoutsDeps {
  resolveDemoUrl?: DemoUrlResolver;
}

// Lazy and dynamic, like `apps/mobile/src/lib/outbox/flush.ts`'s tRPC
// client: `../../lib/storage/r2-client.ts` reads `env.R2_*` at module
// scope, so a static import would make merely importing this module throw
// wherever R2 is unconfigured — including every test with no reason to
// care about media.
const signDemoUrl: DemoUrlResolver = async (storageKey) => {
  try {
    const { getSignedDownloadUrl } = await import('../../lib/storage/r2-client.ts');
    return await getSignedDownloadUrl(storageKey, DEMO_URL_TTL_SECONDS);
  } catch {
    return null;
  }
};

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

export async function listUpcomingWorkouts(
  db: DbClient,
  clientProfileId: string,
  range: UpcomingWorkoutsRange,
  deps: ListUpcomingWorkoutsDeps = {},
): Promise<UpcomingWorkouts> {
  const sessionRows = await db
    .select({
      id: schema.workoutSessions.id,
      clientLocalId: schema.workoutSessions.clientLocalId,
      assignmentId: schema.workoutSessions.assignmentId,
      programDayId: schema.workoutSessions.programDayId,
      name: schema.workoutSessions.name,
      scheduledDate: schema.workoutSessions.scheduledDate,
      status: schema.workoutSessions.status,
      startedAt: schema.workoutSessions.startedAt,
      completedAt: schema.workoutSessions.completedAt,
      updatedAt: schema.workoutSessions.updatedAt,
      dayName: schema.programDays.name,
      dayNotes: schema.programDays.notes,
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

  if (sessionRows.length === 0) return { sessions: [], exercises: [] };

  const programDayIds = unique(sessionRows.map((row) => row.programDayId));
  const blockRows =
    programDayIds.length === 0
      ? []
      : await db
          .select({
            id: schema.programExercises.id,
            programDayId: schema.programExercises.programDayId,
            exerciseId: schema.programExercises.exerciseId,
            orderIndex: schema.programExercises.orderIndex,
            targetSets: schema.programExercises.targetSets,
            targetRepsMin: schema.programExercises.targetRepsMin,
            targetRepsMax: schema.programExercises.targetRepsMax,
            targetRpe: schema.programExercises.targetRpe,
            targetRir: schema.programExercises.targetRir,
            targetWeightKg: schema.programExercises.targetWeightKg,
            targetPercent1rm: schema.programExercises.targetPercent1rm,
            targetRestSeconds: schema.programExercises.targetRestSeconds,
            tempo: schema.programExercises.tempo,
            supersetGroup: schema.programExercises.supersetGroup,
            alternatives: schema.programExercises.alternatives,
            coachNotes: schema.programExercises.coachNotes,
          })
          .from(schema.programExercises)
          .where(inArray(schema.programExercises.programDayId, programDayIds))
          .orderBy(
            asc(schema.programExercises.programDayId),
            asc(schema.programExercises.orderIndex),
          );

  const blocksByDay = new Map<string, UpcomingSessionExercise[]>();
  for (const row of blockRows) {
    const blocks = blocksByDay.get(row.programDayId) ?? [];
    blocks.push({
      programExerciseId: row.id,
      exerciseId: row.exerciseId,
      orderIndex: row.orderIndex,
      targetSets: row.targetSets,
      targetRepsMin: row.targetRepsMin,
      targetRepsMax: row.targetRepsMax,
      targetRpe: row.targetRpe === null ? null : parseNumeric(row.targetRpe, 1),
      targetRir: row.targetRir,
      targetWeightKg: row.targetWeightKg === null ? null : parseNumeric(row.targetWeightKg, 2),
      targetPercent1rm:
        row.targetPercent1rm === null ? null : parseNumeric(row.targetPercent1rm, 1),
      targetRestSeconds: row.targetRestSeconds,
      tempo: row.tempo,
      supersetGroup: row.supersetGroup,
      alternatives: row.alternatives,
      coachNotes: row.coachNotes,
    });
    blocksByDay.set(row.programDayId, blocks);
  }

  const sessions: UpcomingSession[] = sessionRows.map((row) => ({
    id: row.id,
    clientLocalId: row.clientLocalId,
    assignmentId: row.assignmentId,
    programDayId: row.programDayId,
    name: row.name,
    scheduledDate: row.scheduledDate,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
    dayName: row.dayName,
    dayNotes: row.dayNotes,
    exercises: row.programDayId ? (blocksByDay.get(row.programDayId) ?? []) : [],
  }));

  // Decision (c): the prescribed exercise AND every coach-approved swap it
  // offers, deduplicated across every session in the range.
  const exerciseIds = unique(
    sessions.flatMap((session) =>
      session.exercises.flatMap((block) => [block.exerciseId, ...block.alternatives]),
    ),
  );
  if (exerciseIds.length === 0) return { sessions, exercises: [] };

  const exerciseRows = await db
    .select({
      id: schema.exercises.id,
      name: schema.exercises.name,
      primaryMuscle: schema.exercises.primaryMuscle,
      equipment: schema.exercises.equipment,
      movementPattern: schema.exercises.movementPattern,
      isBodyweight: schema.exercises.isBodyweight,
      defaultIncrementKg: schema.exercises.defaultIncrementKg,
      cues: schema.exercises.cues,
      demoAssetId: schema.exercises.demoAssetId,
    })
    .from(schema.exercises)
    .where(inArray(schema.exercises.id, exerciseIds))
    .orderBy(asc(schema.exercises.id));

  const demoAssetIds = unique(exerciseRows.map((row) => row.demoAssetId));
  const storageKeyByAssetId = new Map<string, string>();
  if (demoAssetIds.length > 0) {
    const assetRows = await db
      .select({ id: schema.mediaAssets.id, storageKey: schema.mediaAssets.storageKey })
      .from(schema.mediaAssets)
      .where(
        and(
          inArray(schema.mediaAssets.id, demoAssetIds),
          eq(schema.mediaAssets.processingStatus, 'ready'),
          isNull(schema.mediaAssets.deletedAt),
        ),
      );
    for (const asset of assetRows) storageKeyByAssetId.set(asset.id, asset.storageKey);
  }

  const resolveDemoUrl = deps.resolveDemoUrl ?? signDemoUrl;
  const exercises: UpcomingExercise[] = await Promise.all(
    exerciseRows.map(async (row) => {
      const storageKey = row.demoAssetId ? storageKeyByAssetId.get(row.demoAssetId) : undefined;
      return {
        id: row.id,
        name: row.name,
        primaryMuscle: row.primaryMuscle,
        equipment: row.equipment,
        movementPattern: row.movementPattern,
        isBodyweight: row.isBodyweight,
        defaultIncrementKg:
          row.defaultIncrementKg === null ? null : parseNumeric(row.defaultIncrementKg, 2),
        cues: row.cues,
        demoAssetId: row.demoAssetId,
        demoVideoUrl: storageKey ? await resolveDemoUrl(storageKey) : null,
      };
    }),
  );

  return { sessions, exercises };
}
