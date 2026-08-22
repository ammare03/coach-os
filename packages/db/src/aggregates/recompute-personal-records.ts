// PLACEHOLDER — DB§8.2. Real PR-detection logic (per record_type: 1RM
// estimated via Epley, max weight, max reps, max volume) belongs to
// phase-09-workout-logger/personal-records/01, not here. See README.md.
//
// Deliberately empty, unlike the other three stubs: there is no safe
// "zero" placeholder for a personal record — inserting a fabricated
// (record_type, value) row would look like real athlete data rather than
// obviously-inert scaffolding, exactly the "stub that looks too complete"
// risk this task's own doc warns against. This still reads the existing
// record inside the caller's transaction, proving `tx` participates
// correctly; it writes nothing.
import { and, eq } from 'drizzle-orm';

import { personalRecords } from '../schema/training.ts';

import type { Transaction } from './types.ts';

/**
 * MUST be called inside the same transaction as any `training.set_logs`
 * insert for this client/exercise.
 */
export async function recomputePersonalRecords(
  tx: Transaction,
  clientId: string,
  exerciseId: string,
): Promise<void> {
  await tx
    .select({ id: personalRecords.id })
    .from(personalRecords)
    .where(and(eq(personalRecords.clientId, clientId), eq(personalRecords.exerciseId, exerciseId)));
  // No write — see the module comment above.
}
