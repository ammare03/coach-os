import { schema, type DbClient, type ProgramExercise } from '@coachos/db';
import { parseNumeric } from '@coachos/utils';
import { asc, inArray } from 'drizzle-orm';

// One definition of "a day's prescription, as the device receives it",
// shared by the two readers that must agree on it byte for byte:
// `./upcoming.ts`, which serves the LIVE version, and
// `./program-snapshot.ts`, which freezes a copy at `started_at`
// (`session-runtime/09`, DB§14.6).
//
// They have to be the same shape and the same parse, because the logger
// switches between them on one field (`workout_sessions.status`) and never
// re-maps either. Two copies of the column list would drift on the first
// target a coach gains, and the drift would show up as a client's target
// line silently changing the moment they pressed Start.
//
// `numeric` is parsed here and nowhere downstream (`code-conventions` §3's
// numeric trap) — which is also what makes the snapshot safe to store as
// JSONB: it goes into the column as numbers and comes back as numbers,
// with no second parse to forget.

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
  /** `numeric` columns parsed once, here, and never re-parsed downstream. */
  targetRpe: number | null;
  targetWeightKg: number | null;
  targetPercent1rm: number | null;
}

/**
 * Every block of the given days, keyed by `program_day_id` and ordered by
 * `order_index` within each.
 *
 * Empty input returns an empty map without a query — a day the coach has
 * not filled in, and an ad-hoc session with no `program_day_id` at all,
 * both land here.
 */
export async function listProgramBlocks(
  db: DbClient,
  programDayIds: string[],
): Promise<Map<string, UpcomingSessionExercise[]>> {
  const byDay = new Map<string, UpcomingSessionExercise[]>();
  if (programDayIds.length === 0) return byDay;

  const rows = await db
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
    .orderBy(asc(schema.programExercises.programDayId), asc(schema.programExercises.orderIndex));

  for (const row of rows) {
    const blocks = byDay.get(row.programDayId) ?? [];
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
    byDay.set(row.programDayId, blocks);
  }

  return byDay;
}
