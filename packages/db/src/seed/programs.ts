// DB§21: 2 programs (12-week, 8-week) with real week/day/exercise
// structure — supersets on at least one day, coach-approved `alternatives`
// on at least one exercise, varied rep ranges and RPE targets
// (seed-and-fixtures/01's own Approach §4). No separate `assignments.ts`
// file is named in this task's own file list — "programs → assignments" is
// one orchestration stage, so `seedAssignments` lives here too, right next
// to the program structure it assigns.
import type { Transaction } from '../aggregates/types.ts';
import {
  assignments,
  programDays,
  programExercises,
  programs,
  programWeeks,
} from '../schema/training.ts';

import type { SeededExercise } from './exercises.ts';
import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

// Both programs are authored once, before any client's history begins —
// coach.ts's comment explains why this must be explicit rather than left
// to `.defaultNow()`.
const PROGRAM_AUTHORED_AT = timestampFromAnchor(-395, 9);

type ExerciseTemplate = {
  exerciseName: string;
  orderIndex: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  baseWeightKg: number;
  weeklyIncrementKg: number;
  baseRpe: number;
  rpeIncrementPerWeek: number;
  tempo?: string;
  supersetGroup?: string;
  alternativeNames?: string[];
  restSeconds: number;
};

type DayTemplate = {
  dayNumber: number;
  name: string;
  exercises: ExerciseTemplate[];
};

type ProgramDef = {
  key: string;
  name: string;
  description: string;
  durationWeeks: number;
  days: DayTemplate[];
};

const PROGRAM_DEFS: ProgramDef[] = [
  {
    key: 'program:hypertrophy-12',
    name: '12-Week Hypertrophy Block',
    description:
      'A four-day upper/lower split built around progressive overload on the big compound lifts.',
    durationWeeks: 12,
    days: [
      {
        dayNumber: 1,
        name: 'Push A',
        exercises: [
          {
            exerciseName: 'Barbell Bench Press',
            orderIndex: 1,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 60,
            weeklyIncrementKg: 1.25,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            tempo: '3010',
            restSeconds: 150,
            alternativeNames: ['Dumbbell Bench Press', 'Incline Barbell Bench Press'],
          },
          {
            exerciseName: 'Barbell Overhead Press',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 32,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            tempo: '2010',
            restSeconds: 120,
          },
          {
            exerciseName: 'Dip',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 0,
            weeklyIncrementKg: 0,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 90,
          },
          {
            exerciseName: 'Dumbbell Lateral Raise',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            baseWeightKg: 8,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            supersetGroup: 'A',
            restSeconds: 45,
          },
          {
            exerciseName: 'Cable Tricep Extension',
            orderIndex: 5,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 15,
            weeklyIncrementKg: 0.5,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            supersetGroup: 'A',
            restSeconds: 45,
          },
        ],
      },
      {
        dayNumber: 2,
        name: 'Pull A',
        exercises: [
          {
            exerciseName: 'Barbell Row',
            orderIndex: 1,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 55,
            weeklyIncrementKg: 1.25,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            tempo: '3011',
            restSeconds: 150,
          },
          {
            exerciseName: 'Weighted Pull-up',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 5,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 120,
          },
          {
            exerciseName: 'Wide-Grip Cable Lat Pulldown',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 45,
            weeklyIncrementKg: 1,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 90,
          },
          {
            exerciseName: 'Cable Face Pull',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 20,
            baseWeightKg: 18,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 45,
          },
          {
            exerciseName: 'Dumbbell Bicep Curl',
            orderIndex: 5,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 12,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
        ],
      },
      {
        dayNumber: 3,
        name: 'Legs A',
        exercises: [
          {
            exerciseName: 'Barbell Back Squat',
            orderIndex: 1,
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 70,
            weeklyIncrementKg: 1.25,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            tempo: '3010',
            restSeconds: 180,
          },
          {
            exerciseName: 'Barbell Romanian Deadlift',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 55,
            weeklyIncrementKg: 1,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 120,
          },
          {
            exerciseName: 'Machine Leg Press',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 100,
            weeklyIncrementKg: 2.5,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 90,
          },
          {
            exerciseName: 'Lying Machine Leg Curl',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 30,
            weeklyIncrementKg: 0.5,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
          {
            exerciseName: 'Standing Machine Calf Raise',
            orderIndex: 5,
            targetSets: 4,
            targetRepsMin: 12,
            targetRepsMax: 20,
            baseWeightKg: 40,
            weeklyIncrementKg: 1,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 45,
          },
        ],
      },
      {
        dayNumber: 4,
        name: 'Upper A',
        exercises: [
          {
            exerciseName: 'Incline Dumbbell Bench Press',
            orderIndex: 1,
            targetSets: 4,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 24,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            tempo: '3010',
            restSeconds: 120,
            alternativeNames: ['Barbell Bench Press', 'Dumbbell Bench Press'],
          },
          {
            exerciseName: 'Cable Seated Row',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 50,
            weeklyIncrementKg: 1,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 90,
          },
          {
            exerciseName: 'Dumbbell Lateral Raise',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            baseWeightKg: 8,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 45,
          },
          {
            exerciseName: 'Cable Bicep Curl',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 14,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
          {
            exerciseName: 'Cable Tricep Extension',
            orderIndex: 5,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 15,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
        ],
      },
    ],
  },
  {
    key: 'program:strength-8',
    name: '8-Week Strength Cycle',
    description:
      'A three-day-per-week linear strength cycle centred on the squat, bench, and deadlift.',
    durationWeeks: 8,
    days: [
      {
        dayNumber: 1,
        name: 'Squat Day',
        exercises: [
          {
            exerciseName: 'Barbell Back Squat',
            orderIndex: 1,
            targetSets: 5,
            targetRepsMin: 3,
            targetRepsMax: 5,
            baseWeightKg: 80,
            weeklyIncrementKg: 2.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.2,
            tempo: '3010',
            restSeconds: 180,
          },
          {
            exerciseName: 'Dumbbell Bulgarian Split Squat',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            baseWeightKg: 16,
            weeklyIncrementKg: 0.5,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 90,
          },
          {
            exerciseName: 'Machine Leg Extension',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 10,
            targetRepsMax: 15,
            baseWeightKg: 35,
            weeklyIncrementKg: 1,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
          {
            exerciseName: 'Plank',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 30,
            targetRepsMax: 60,
            baseWeightKg: 0,
            weeklyIncrementKg: 0,
            baseRpe: 6,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 45,
          },
        ],
      },
      {
        dayNumber: 2,
        name: 'Bench Day',
        exercises: [
          {
            exerciseName: 'Barbell Bench Press',
            orderIndex: 1,
            targetSets: 5,
            targetRepsMin: 3,
            targetRepsMax: 5,
            baseWeightKg: 65,
            weeklyIncrementKg: 1.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.2,
            tempo: '3010',
            restSeconds: 180,
          },
          {
            exerciseName: 'Barbell Overhead Press',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 8,
            baseWeightKg: 34,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 120,
          },
          {
            exerciseName: 'Dip',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 12,
            baseWeightKg: 0,
            weeklyIncrementKg: 0,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 90,
          },
          {
            exerciseName: 'Dumbbell Lateral Raise',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 12,
            targetRepsMax: 15,
            baseWeightKg: 8,
            weeklyIncrementKg: 0.25,
            baseRpe: 8,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 45,
          },
        ],
      },
      {
        dayNumber: 3,
        name: 'Deadlift Day',
        exercises: [
          {
            exerciseName: 'Barbell Deadlift',
            orderIndex: 1,
            targetSets: 4,
            targetRepsMin: 3,
            targetRepsMax: 5,
            baseWeightKg: 90,
            weeklyIncrementKg: 2.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.2,
            tempo: '2010',
            restSeconds: 180,
          },
          {
            exerciseName: 'Barbell Row',
            orderIndex: 2,
            targetSets: 3,
            targetRepsMin: 6,
            targetRepsMax: 10,
            baseWeightKg: 55,
            weeklyIncrementKg: 1,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 120,
          },
          {
            exerciseName: 'Weighted Pull-up',
            orderIndex: 3,
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 8,
            baseWeightKg: 5,
            weeklyIncrementKg: 0.5,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.15,
            restSeconds: 120,
          },
          {
            exerciseName: 'Hanging Leg Raise',
            orderIndex: 4,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 15,
            baseWeightKg: 0,
            weeklyIncrementKg: 0,
            baseRpe: 7,
            rpeIncrementPerWeek: 0.1,
            restSeconds: 60,
          },
        ],
      },
    ],
  },
];

function clampRpe(value: number): string {
  return Math.min(10, Math.round(value * 10) / 10).toFixed(1);
}

// Lookup/orchestration structures, not row mirrors — `training-history.ts`
// walks `SeededProgram.days` to find the right week's prescription, and
// needs the actual FK ids alongside fields no single table row carries
// (`exerciseName` next to `targetWeightKg` at that specific week). Fields
// named `dayId`/`programId` rather than bare `id` for the same reason
// `SeededExercise.exerciseId` is (exercises.ts's own comment).
export type SeededProgramDay = {
  dayId: string;
  programId: string;
  weekNumber: number;
  dayNumber: number;
  name: string;
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    targetSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetWeightKg: number;
    targetRpe: number;
  }>;
};

export type SeededProgram = {
  programId: string;
  key: string;
  name: string;
  durationWeeks: number;
  days: SeededProgramDay[]; // every (week, day) row, flattened, in week/day order
};

/** Must run after `exercises.ts` and `coach.ts`. */
export async function seedPrograms(
  tx: Transaction,
  coachProfileId: string,
  exercisesByName: Map<string, SeededExercise>,
): Promise<SeededProgram[]> {
  const seededPrograms: SeededProgram[] = [];

  function resolveExerciseId(name: string): string {
    const found = exercisesByName.get(name);
    if (!found) {
      throw new Error(
        `seedPrograms: no seeded exercise named "${name}" — check exercises.ts's MOVEMENTS table.`,
      );
    }
    return found.exerciseId;
  }

  for (const def of PROGRAM_DEFS) {
    const programId = seedId(`program:${def.key}`);

    await tx.insert(programs).values({
      id: programId,
      coachId: coachProfileId,
      name: def.name,
      description: def.description,
      durationWeeks: def.durationWeeks,
      isTemplate: true,
      version: 1,
      createdAt: PROGRAM_AUTHORED_AT,
      updatedAt: PROGRAM_AUTHORED_AT,
    });

    const seededDays: SeededProgramDay[] = [];
    const weekRows: (typeof programWeeks.$inferInsert)[] = [];
    const dayRows: (typeof programDays.$inferInsert)[] = [];
    const exerciseRows: (typeof programExercises.$inferInsert)[] = [];

    for (let week = 1; week <= def.durationWeeks; week += 1) {
      const weekId = seedId(`program_week:${def.key}:w${week}`);
      weekRows.push({
        id: weekId,
        programId,
        weekNumber: week,
        createdAt: PROGRAM_AUTHORED_AT,
        updatedAt: PROGRAM_AUTHORED_AT,
      });

      for (const dayTemplate of def.days) {
        const dayId = seedId(`program_day:${def.key}:w${week}:d${dayTemplate.dayNumber}`);
        dayRows.push({
          id: dayId,
          programWeekId: weekId,
          dayNumber: dayTemplate.dayNumber,
          name: dayTemplate.name,
          isRestDay: false,
          createdAt: PROGRAM_AUTHORED_AT,
          updatedAt: PROGRAM_AUTHORED_AT,
        });

        const seededExercisesForDay: SeededProgramDay['exercises'] = [];

        for (const exTemplate of dayTemplate.exercises) {
          const exerciseId = resolveExerciseId(exTemplate.exerciseName);
          const weekIndex = week - 1;
          const targetWeightKg = exTemplate.baseWeightKg + weekIndex * exTemplate.weeklyIncrementKg;
          const targetRpe = exTemplate.baseRpe + weekIndex * exTemplate.rpeIncrementPerWeek;

          exerciseRows.push({
            id: seedId(
              `program_exercise:${def.key}:w${week}:d${dayTemplate.dayNumber}:${exTemplate.orderIndex}`,
            ),
            programDayId: dayId,
            exerciseId,
            orderIndex: exTemplate.orderIndex,
            targetSets: exTemplate.targetSets,
            targetRepsMin: exTemplate.targetRepsMin,
            targetRepsMax: exTemplate.targetRepsMax,
            targetRpe: clampRpe(targetRpe),
            targetWeightKg: targetWeightKg > 0 ? targetWeightKg.toFixed(2) : null,
            targetRestSeconds: exTemplate.restSeconds,
            tempo: exTemplate.tempo ?? null,
            supersetGroup: exTemplate.supersetGroup ?? null,
            alternatives: exTemplate.alternativeNames?.map(resolveExerciseId) ?? [],
            coachNotes: exTemplate.orderIndex === 1 ? faker.lorem.sentence() : null,
            createdAt: PROGRAM_AUTHORED_AT,
            updatedAt: PROGRAM_AUTHORED_AT,
          });

          seededExercisesForDay.push({
            exerciseId,
            exerciseName: exTemplate.exerciseName,
            targetSets: exTemplate.targetSets,
            targetRepsMin: exTemplate.targetRepsMin,
            targetRepsMax: exTemplate.targetRepsMax,
            targetWeightKg,
            targetRpe,
          });
        }

        seededDays.push({
          dayId,
          programId,
          weekNumber: week,
          dayNumber: dayTemplate.dayNumber,
          name: dayTemplate.name,
          exercises: seededExercisesForDay,
        });
      }
    }

    await tx.insert(programWeeks).values(weekRows);
    await tx.insert(programDays).values(dayRows);
    await tx.insert(programExercises).values(exerciseRows);

    seededPrograms.push({
      programId,
      key: def.key,
      name: def.name,
      durationWeeks: def.durationWeeks,
      days: seededDays,
    });
  }

  return seededPrograms;
}

// Lookup structure, not a row mirror — see SeededProgramDay's comment above.
export type SeededAssignment = {
  assignmentId: string;
  clientKey: string;
  programId: string;
  program: SeededProgram;
  currentWeek: number;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  startDate: string;
};

export type AssignmentDef = {
  clientKey: string;
  programKey: string;
  currentWeek: number;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  startDaysAgo: number;
};

/** Must run after `seedPrograms` and `clients.ts`. */
export async function seedAssignments(
  tx: Transaction,
  coachProfileId: string,
  clientProfileIdByKey: Map<string, string>,
  seededPrograms: SeededProgram[],
  defs: AssignmentDef[],
): Promise<SeededAssignment[]> {
  const programByKey = new Map(seededPrograms.map((p) => [p.key, p]));
  const rows: (typeof assignments.$inferInsert)[] = [];
  const seeded: SeededAssignment[] = [];

  for (const def of defs) {
    const program = programByKey.get(def.programKey);
    const clientProfileId = clientProfileIdByKey.get(def.clientKey);
    if (!program || !clientProfileId) {
      throw new Error(
        `seedAssignments: unresolved program/client for ${def.clientKey}/${def.programKey}`,
      );
    }

    const assignmentId = seedId(`assignment:${def.clientKey}:${def.programKey}`);
    const startDate = dateStringFromAnchor(-def.startDaysAgo);

    rows.push({
      id: assignmentId,
      programId: program.programId,
      clientId: clientProfileId,
      coachId: coachProfileId,
      startDate,
      currentWeek: def.currentWeek,
      status: def.status,
      // Anchor-based, not `new Date()` — same reason as every other
      // timestamp this seed writes (coach.ts's comment). Currently
      // unreachable (no AssignmentDef in seed.ts uses 'completed' today),
      // but a latent real-clock call here would still break determinism
      // the moment one does.
      completedAt:
        def.status === 'completed'
          ? timestampFromAnchor(-def.startDaysAgo + 7 * def.currentWeek, 18)
          : null,
      createdAt: timestampFromAnchor(-def.startDaysAgo, 9),
      updatedAt: timestampFromAnchor(-def.startDaysAgo, 9),
    });

    seeded.push({
      assignmentId,
      clientKey: def.clientKey,
      programId: program.programId,
      program,
      currentWeek: def.currentWeek,
      status: def.status,
      startDate,
    });
  }

  await tx.insert(assignments).values(rows);
  return seeded;
}
