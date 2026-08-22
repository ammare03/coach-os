// DB§21: ~120 exercises, global library (coachId null), spanning every
// `movement_pattern` value meaningfully (seed-and-fixtures/01's own
// Approach §2) — not hand-typed one by one, but generated from a compact
// table of base movements × equipment variants, which is what makes ~120
// realistic entries maintainable and, by construction (no faker call
// participates in *which* exercises exist or how many — only in each row's
// `cues`), trivially deterministic.
import type { Transaction } from '../aggregates/types.ts';
import type { movementPattern } from '../schema/enums.ts';
import { exercises } from '../schema/training.ts';

import { timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

// `pgEnum` exports no TS union type of its own — derive one from the same
// `.enumValues` tuple Drizzle uses internally (clients.ts does the same).
type MovementPattern = (typeof movementPattern.enumValues)[number];

// The whole global library is seeded as one event, well before any client
// starts — coach.ts's comment explains why this must be explicit rather
// than left to `.defaultNow()`.
const LIBRARY_CREATED_AT = timestampFromAnchor(-400, 8);

type MovementDef = {
  base: string;
  pattern: MovementPattern;
  muscle: string;
  secondary: string[];
  equipment: string[];
  bodyweightVariant?: string; // matches one entry in `equipment` exactly when present
  unilateral?: boolean;
};

// 33 base movements × their equipment variants ≈ 121 exercises — DB§21's
// "approximately 120," spanning every `movement_pattern` enum value.
const MOVEMENTS: MovementDef[] = [
  {
    base: 'Back Squat',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes', 'hamstrings'],
    equipment: [
      'Barbell',
      'Front Rack Barbell',
      'Safety Bar',
      'Smith Machine',
      'Goblet Dumbbell',
      'Bodyweight',
    ],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Bulgarian Split Squat',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Dumbbell', 'Barbell', 'Bodyweight'],
    bodyweightVariant: 'Bodyweight',
    unilateral: true,
  },
  {
    base: 'Leg Press',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Machine'],
  },
  {
    base: 'Walking Lunge',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Dumbbell', 'Barbell', 'Bodyweight'],
    bodyweightVariant: 'Bodyweight',
    unilateral: true,
  },
  {
    base: 'Deadlift',
    pattern: 'hinge',
    muscle: 'hamstrings',
    secondary: ['glutes', 'back'],
    equipment: ['Barbell', 'Trap Bar', 'Sumo Barbell', 'Deficit Barbell'],
  },
  {
    base: 'Romanian Deadlift',
    pattern: 'hinge',
    muscle: 'hamstrings',
    secondary: ['glutes'],
    equipment: ['Barbell', 'Dumbbell', 'Single-Leg Dumbbell'],
  },
  {
    base: 'Hip Thrust',
    pattern: 'hinge',
    muscle: 'glutes',
    secondary: ['hamstrings'],
    equipment: ['Barbell', 'Dumbbell', 'Bodyweight'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Swing',
    pattern: 'hinge',
    muscle: 'glutes',
    secondary: ['hamstrings'],
    equipment: ['Kettlebell'],
  },
  {
    base: 'Good Morning',
    pattern: 'hinge',
    muscle: 'hamstrings',
    secondary: ['back'],
    equipment: ['Barbell'],
  },
  {
    base: 'Bench Press',
    pattern: 'push',
    muscle: 'chest',
    secondary: ['triceps', 'shoulders'],
    equipment: [
      'Barbell',
      'Dumbbell',
      'Incline Barbell',
      'Incline Dumbbell',
      'Decline Barbell',
      'Close-Grip Barbell',
    ],
  },
  {
    base: 'Overhead Press',
    pattern: 'push',
    muscle: 'shoulders',
    secondary: ['triceps'],
    equipment: ['Barbell', 'Dumbbell', 'Seated Dumbbell', 'Machine'],
  },
  {
    base: 'Push-up',
    pattern: 'push',
    muscle: 'chest',
    secondary: ['triceps', 'shoulders'],
    equipment: ['Bodyweight', 'Weighted', 'Incline'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Dip',
    pattern: 'push',
    muscle: 'triceps',
    secondary: ['chest', 'shoulders'],
    equipment: ['Bodyweight', 'Weighted', 'Machine-Assisted'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Chest Fly',
    pattern: 'push',
    muscle: 'chest',
    secondary: ['shoulders'],
    equipment: ['Cable', 'Dumbbell', 'Machine'],
  },
  {
    base: 'Pull-up',
    pattern: 'pull',
    muscle: 'back',
    secondary: ['biceps'],
    equipment: ['Bodyweight', 'Weighted', 'Assisted', 'Chin-Up'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Lat Pulldown',
    pattern: 'pull',
    muscle: 'back',
    secondary: ['biceps'],
    equipment: ['Wide-Grip Cable', 'Close-Grip Cable', 'Machine'],
  },
  {
    base: 'Row',
    pattern: 'pull',
    muscle: 'back',
    secondary: ['biceps'],
    equipment: ['Barbell', 'Dumbbell', 'Cable Seated', 'T-Bar', 'Chest-Supported'],
  },
  {
    base: 'Face Pull',
    pattern: 'pull',
    muscle: 'shoulders',
    secondary: ['back'],
    equipment: ['Cable'],
  },
  {
    base: 'Bicep Curl',
    pattern: 'isolation',
    muscle: 'biceps',
    secondary: [],
    equipment: ['Barbell', 'Dumbbell', 'Hammer Dumbbell', 'Cable', 'EZ-Bar', 'Preacher'],
  },
  {
    base: 'Tricep Extension',
    pattern: 'isolation',
    muscle: 'triceps',
    secondary: [],
    equipment: ['Cable', 'Dumbbell Overhead', 'Skull Crusher Barbell', 'Rope Pushdown Cable'],
  },
  {
    base: 'Lateral Raise',
    pattern: 'isolation',
    muscle: 'shoulders',
    secondary: [],
    equipment: ['Dumbbell', 'Cable', 'Machine'],
  },
  {
    base: 'Rear Delt Fly',
    pattern: 'isolation',
    muscle: 'shoulders',
    secondary: [],
    equipment: ['Dumbbell', 'Cable', 'Machine'],
  },
  {
    base: 'Leg Extension',
    pattern: 'isolation',
    muscle: 'quadriceps',
    secondary: [],
    equipment: ['Machine'],
  },
  {
    base: 'Leg Curl',
    pattern: 'isolation',
    muscle: 'hamstrings',
    secondary: [],
    equipment: ['Lying Machine', 'Seated Machine'],
  },
  {
    base: 'Calf Raise',
    pattern: 'isolation',
    muscle: 'calves',
    secondary: [],
    equipment: ['Standing Machine', 'Seated Machine', 'Bodyweight', 'Barbell'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Plank',
    pattern: 'core',
    muscle: 'core',
    secondary: [],
    equipment: ['Bodyweight', 'Weighted'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Hanging Leg Raise',
    pattern: 'core',
    muscle: 'core',
    secondary: [],
    equipment: ['Bodyweight'],
    bodyweightVariant: 'Bodyweight',
  },
  { base: 'Woodchop', pattern: 'core', muscle: 'obliques', secondary: [], equipment: ['Cable'] },
  {
    base: 'Farmer Carry',
    pattern: 'carry',
    muscle: 'core',
    secondary: ['forearms'],
    equipment: ['Dumbbell', 'Kettlebell', 'Trap Bar'],
  },
  {
    base: 'Suitcase Carry',
    pattern: 'carry',
    muscle: 'core',
    secondary: ['obliques'],
    equipment: ['Dumbbell', 'Kettlebell'],
    unilateral: true,
  },
  {
    base: 'Push',
    pattern: 'other',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Sled'],
  },
  {
    base: 'Ropes',
    pattern: 'other',
    muscle: 'shoulders',
    secondary: ['core'],
    equipment: ['Battle'],
  },
  {
    base: 'Box Jump',
    pattern: 'other',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Bodyweight'],
    bodyweightVariant: 'Bodyweight',
  },
  { base: 'Crunch', pattern: 'core', muscle: 'core', secondary: [], equipment: ['Cable'] },
  {
    base: 'Russian Twist',
    pattern: 'core',
    muscle: 'obliques',
    secondary: [],
    equipment: ['Bodyweight', 'Weighted'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Ab Wheel Rollout',
    pattern: 'core',
    muscle: 'core',
    secondary: [],
    equipment: ['Bodyweight'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Step-Up',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Dumbbell', 'Barbell', 'Bodyweight'],
    bodyweightVariant: 'Bodyweight',
    unilateral: true,
  },
  {
    base: 'Glute Bridge',
    pattern: 'hinge',
    muscle: 'glutes',
    secondary: [],
    equipment: ['Bodyweight', 'Barbell'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Nordic Curl',
    pattern: 'hinge',
    muscle: 'hamstrings',
    secondary: [],
    equipment: ['Bodyweight'],
    bodyweightVariant: 'Bodyweight',
  },
  {
    base: 'Shrug',
    pattern: 'isolation',
    muscle: 'traps',
    secondary: [],
    equipment: ['Barbell', 'Dumbbell', 'Trap Bar'],
  },
  {
    base: 'Upright Row',
    pattern: 'pull',
    muscle: 'shoulders',
    secondary: ['traps'],
    equipment: ['Barbell', 'Cable'],
  },
  {
    base: 'Landmine Press',
    pattern: 'push',
    muscle: 'shoulders',
    secondary: ['chest'],
    equipment: ['Barbell'],
  },
  {
    base: 'Arnold Press',
    pattern: 'push',
    muscle: 'shoulders',
    secondary: ['triceps'],
    equipment: ['Dumbbell'],
  },
  {
    base: 'Zercher Squat',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes', 'back'],
    equipment: ['Barbell'],
  },
  {
    base: 'Hack Squat',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Machine', 'Barbell'],
  },
  {
    base: 'Reverse Lunge',
    pattern: 'squat',
    muscle: 'quadriceps',
    secondary: ['glutes'],
    equipment: ['Dumbbell', 'Barbell', 'Bodyweight'],
    bodyweightVariant: 'Bodyweight',
    unilateral: true,
  },
  {
    base: 'Pull-Through',
    pattern: 'hinge',
    muscle: 'glutes',
    secondary: ['hamstrings'],
    equipment: ['Cable'],
  },
  {
    base: 'Bent-Over Reverse Fly',
    pattern: 'isolation',
    muscle: 'shoulders',
    secondary: ['back'],
    equipment: ['Dumbbell', 'Cable'],
  },
  {
    base: 'Renegade Row',
    pattern: 'pull',
    muscle: 'back',
    secondary: ['core'],
    equipment: ['Dumbbell'],
  },
  {
    base: 'Waiter Carry',
    pattern: 'carry',
    muscle: 'shoulders',
    secondary: ['core'],
    equipment: ['Kettlebell', 'Dumbbell'],
    unilateral: true,
  },
];

const CUE_POOL = [
  'Brace your core before you move.',
  'Control the eccentric — don’t let it drop.',
  'Full range of motion, every rep.',
  'Drive through the whole foot.',
  'Keep the target joint stacked under load.',
  'Exhale on the exertion.',
  'Squeeze at the top for a full second.',
  'Neutral spine throughout.',
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function equipmentSlug(variant: string): string {
  return slugify(variant.replace(/^(Wide-Grip|Close-Grip|Single-Leg)\s/, ''));
}

// A lookup entry, not a row mirror — `programs.ts` and `form-checks.ts`
// resolve an exercise by name to its id via this, nothing reads it as a
// full `exercises` row. Field named `exerciseId` rather than `id` so it
// reads clearly wherever it's threaded through (`day.exercises[].exerciseId`
// in programs.ts), and so it isn't mistaken for a hand-rolled copy of the
// `exercises` table's own row shape (code-conventions: infer from Drizzle,
// never hand-write, an actual row type — this deliberately isn't one).
export type SeededExercise = {
  exerciseId: string;
  name: string;
  pattern: MovementPattern;
};

/** Global exercise library — no `coachId`. Must run before `programs.ts`. */
export async function seedExercises(tx: Transaction): Promise<SeededExercise[]> {
  const rows: (typeof exercises.$inferInsert)[] = [];
  const seeded: SeededExercise[] = [];

  for (const movement of MOVEMENTS) {
    for (const variant of movement.equipment) {
      const isBodyweight = variant === movement.bodyweightVariant;
      const name = isBodyweight ? movement.base : `${variant} ${movement.base}`;
      const key = `exercise:${slugify(name)}`;
      const rowId = seedId(key);

      rows.push({
        id: rowId,
        coachId: null,
        name,
        aliases: [],
        primaryMuscle: movement.muscle,
        secondaryMuscles: movement.secondary,
        equipment: equipmentSlug(variant),
        movementPattern: movement.pattern,
        cues: faker.helpers.arrayElements(CUE_POOL, 2),
        isUnilateral: movement.unilateral ?? false,
        isBodyweight,
        createdAt: LIBRARY_CREATED_AT,
        updatedAt: LIBRARY_CREATED_AT,
      });
      seeded.push({ exerciseId: rowId, name, pattern: movement.pattern });
    }
  }

  await tx.insert(exercises).values(rows);
  return seeded;
}
