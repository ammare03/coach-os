// DB§21: "4 weeks of history per client: 3-5 sessions/week with realistic
// progression and occasional missed days." Built from each client's
// `SeededAssignment` (programs.ts) — the last four (or fewer, for a client
// who started more recently) program weeks map onto the four most recent
// real calendar weeks ending just before `SEED_ANCHOR_DATE`, so every
// session lands in the past, never the future.
//
// Follows the pairing discipline `src/aggregates/README.md` documents:
// `recomputeSessionVolume` runs for every session this module marks
// completed, and `recomputePersonalRecords` runs once per (client,
// exercise) after its set_logs are inserted — the same call sites
// production code will use, so this seed doubles as a smoke test of the
// pattern under realistic volume.
import { recomputePersonalRecords } from '../aggregates/recompute-personal-records.ts';
import { recomputeSessionVolume } from '../aggregates/recompute-session-volume.ts';
import type { Transaction } from '../aggregates/types.ts';
import { setLogs, workoutSessions } from '../schema/training.ts';

import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';
import type { SeededAssignment, SeededProgramDay } from './programs.ts';

// Four real calendar weeks ending the day before the anchor — every
// scheduled_date this module writes falls in [-28, -1] days from anchor,
// strictly in the past.
const WEEK_START_OFFSETS = [-28, -21, -14, -7];
const DAY_OFFSETS_BY_COUNT: Record<number, number[]> = {
  3: [0, 2, 4],
  4: [0, 2, 4, 5],
  5: [0, 1, 3, 4, 5],
};

/** One assignment gets a skipped session, so DB§21's "occasional missed days" is provable. */
const SKIPPED_SESSION_CLIENT_KEY = 'client:2';

export type TrainingHistoryResult = {
  sessionsCreated: number;
  setLogsCreated: number;
  skippedSessionId: string;
};

/** Must run after `seedAssignments` (programs.ts). */
export async function seedTrainingHistory(
  tx: Transaction,
  coachProfileId: string,
  clientIdByKey: Map<string, string>,
  assignmentsByClientKey: Map<string, SeededAssignment>,
): Promise<TrainingHistoryResult> {
  let sessionsCreated = 0;
  let setLogsCreated = 0;
  let skippedSessionId = '';

  for (const [clientKey, assignment] of assignmentsByClientKey) {
    const clientId = clientIdByKey.get(clientKey);
    if (!clientId) throw new Error(`seedTrainingHistory: no client id for ${clientKey}`);

    const daysByWeek = new Map<number, SeededProgramDay[]>();
    for (const day of assignment.program.days) {
      const list = daysByWeek.get(day.weekNumber) ?? [];
      list.push(day);
      daysByWeek.set(day.weekNumber, list);
    }

    // The 4 most recent real weeks map onto the 4 most recent program
    // weeks up to `currentWeek` — clamped to 1 when the client started
    // fewer than 4 program-weeks ago (client:4, paused after 3 weeks).
    const realWeekCount = Math.min(4, assignment.currentWeek);
    const firstRealWeekIndex = 4 - realWeekCount; // e.g. 1 => weeks start at index 1, not 0

    for (let realWeekIndex = firstRealWeekIndex; realWeekIndex < 4; realWeekIndex += 1) {
      const programWeekNumber = assignment.currentWeek - (3 - realWeekIndex);
      const daysThisWeek = daysByWeek.get(Math.max(1, programWeekNumber)) ?? [];
      const dayOffsets =
        DAY_OFFSETS_BY_COUNT[daysThisWeek.length] ?? daysThisWeek.map((_, i) => i * 2);
      const weekStart = WEEK_START_OFFSETS[realWeekIndex];
      // `realWeekIndex` only ever ranges over [firstRealWeekIndex, 3], and
      // that range is always within [0,3] — WEEK_START_OFFSETS's own
      // length — so this can't actually be undefined. Guarded explicitly
      // rather than a `!`, per code-conventions.
      if (weekStart === undefined) {
        throw new Error(`training-history: realWeekIndex ${realWeekIndex} out of range`);
      }

      for (const [dayIndex, day] of daysThisWeek.entries()) {
        const dayOffset = dayOffsets[dayIndex] ?? dayIndex * 2;
        const scheduledDateOffset = weekStart + dayOffset;
        const scheduledDate = dateStringFromAnchor(scheduledDateOffset);
        const sessionKey = `session:${clientKey}:${assignment.program.key}:w${day.weekNumber}:d${day.dayNumber}`;
        const sessionId = seedId(sessionKey);

        const isSkipped =
          clientKey === SKIPPED_SESSION_CLIENT_KEY &&
          realWeekIndex === firstRealWeekIndex &&
          dayIndex === 0;

        const startHour = 7 + (dayIndex % 3) * 3; // spreads sessions across morning/midday/evening
        const startedAt = isSkipped ? null : timestampFromAnchor(scheduledDateOffset, startHour);
        const durationSeconds = isSkipped ? null : faker.number.int({ min: 2400, max: 4200 });
        const completedAt =
          !isSkipped && startedAt
            ? new Date(startedAt.getTime() + (durationSeconds ?? 3000) * 1000)
            : null;

        await tx.insert(workoutSessions).values({
          id: sessionId,
          clientId,
          coachId: coachProfileId,
          assignmentId: assignment.assignmentId,
          programDayId: day.dayId,
          name: day.name,
          scheduledDate,
          startedAt,
          completedAt,
          durationSeconds,
          perceivedExertion: isSkipped ? null : faker.number.int({ min: 6, max: 9 }),
          clientNotes: !isSkipped && dayIndex === 0 ? faker.lorem.sentence() : null,
          status: isSkipped ? 'skipped' : 'completed',
          skipReason: isSkipped ? 'Family emergency, rescheduled the following day.' : null,
          // Placeholder zero until phase-09-workout-logger/personal-records/01
          // replaces the recompute stub — set here (rather than left to the
          // insert default) so it's visibly paired with the
          // recomputeSessionVolume call below, matching the production
          // "mark completed -> recompute in the same transaction" shape.
          totalVolumeKg: isSkipped ? null : '0',
          clientLocalId: sessionKey,
          programSnapshot: {
            dayName: day.name,
            exercises: day.exercises.map((e) => ({
              exerciseId: e.exerciseId,
              targetSets: e.targetSets,
              targetRepsMin: e.targetRepsMin,
              targetRepsMax: e.targetRepsMax,
            })),
          },
          // Explicit — see coach.ts's comment on the same pair for why this
          // can never be left to the column's `.defaultNow()`. A skipped
          // session has no `startedAt`, so it falls back to the same
          // anchor-based scheduling instant a completed one would have used.
          createdAt: startedAt ?? timestampFromAnchor(scheduledDateOffset, startHour),
          updatedAt:
            completedAt ?? startedAt ?? timestampFromAnchor(scheduledDateOffset, startHour),
        });
        sessionsCreated += 1;
        if (isSkipped) skippedSessionId = sessionId;

        if (isSkipped) continue;

        // This UPDATE is the one documented exception to seed.ts's
        // determinism contract (§4 there): `touch_updated_at()` stamps
        // real `now()` on `workout_sessions.updated_at` here, unconditionally
        // and correctly, and no seed-side value can override it.
        await recomputeSessionVolume(tx, sessionId);

        for (const exercise of day.exercises) {
          const rows: (typeof setLogs.$inferInsert)[] = [];

          for (let setNumber = 1; setNumber <= exercise.targetSets; setNumber += 1) {
            const isWarmup = exercise.targetSets >= 4 && setNumber === 1;
            const weightVariance = faker.number.float({ min: -1.5, max: 1.5, fractionDigits: 2 });
            const weightKg = isWarmup
              ? Math.max(0, exercise.targetWeightKg * 0.5)
              : Math.max(0, exercise.targetWeightKg + weightVariance);
            const reps = isWarmup
              ? exercise.targetRepsMax
              : faker.number.int({ min: exercise.targetRepsMin, max: exercise.targetRepsMax });
            const rpe = isWarmup
              ? 5
              : Math.min(
                  10,
                  exercise.targetRpe +
                    faker.number.float({ min: -0.5, max: 0.5, fractionDigits: 1 }),
                );

            rows.push({
              id: seedId(`setlog:${sessionKey}:${exercise.exerciseId}:${setNumber}`),
              workoutSessionId: sessionId,
              exerciseId: exercise.exerciseId,
              clientId,
              setNumber,
              reps,
              weightKg: weightKg > 0 ? weightKg.toFixed(2) : null,
              rpe: rpe.toFixed(1),
              rir: Math.max(0, Math.round(10 - rpe)),
              isWarmup,
              loggedAt: timestampFromAnchor(scheduledDateOffset, startHour, setNumber * 3),
              clientLocalId: `setlog:${sessionKey}:${exercise.exerciseId}:${setNumber}`,
              // Explicit — see coach.ts's comment on the same pair.
              createdAt: timestampFromAnchor(scheduledDateOffset, startHour, setNumber * 3),
              updatedAt: timestampFromAnchor(scheduledDateOffset, startHour, setNumber * 3),
            });
          }

          await tx.insert(setLogs).values(rows);
          setLogsCreated += rows.length;
          await recomputePersonalRecords(tx, clientId, exercise.exerciseId);
        }
      }
    }
  }

  return { sessionsCreated, setLogsCreated, skippedSessionId };
}
