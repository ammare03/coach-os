// PLACEHOLDER — DB§8.2. Real volume logic (sum of weight_kg * reps across
// non-warmup, non-deleted sets) belongs to phase-09-workout-logger/
// personal-records/01, not here. See README.md.
import { eq } from 'drizzle-orm';

import { workoutSessions } from '../schema/training.ts';

import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction that marks a
 * `training.workout_sessions` row completed.
 */
export async function recomputeSessionVolume(
  tx: Transaction,
  workoutSessionId: string,
): Promise<void> {
  await tx
    .update(workoutSessions)
    .set({ totalVolumeKg: '0' }) // PLACEHOLDER — real sum arrives with the volume formula
    .where(eq(workoutSessions.id, workoutSessionId));
}
