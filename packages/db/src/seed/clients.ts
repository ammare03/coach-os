// DB§21: 5 clients "across statuses." Five clients against the four
// `client_status` values means one status repeats — seed-and-fixtures/01's
// own Approach §3 calls for weighting toward `active` (what most
// development exercises) while covering every status at least once: two
// active, one each invited/paused/archived.
import type { Transaction } from '../aggregates/types.ts';
import type { clientStatus, experienceLevel, trainingGoal } from '../schema/enums.ts';
import { clientProfiles, users } from '../schema/identity.ts';

import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

// `pgEnum` exports no TS union type of its own — derive one from the same
// `.enumValues` tuple Drizzle uses internally, rather than hand-typing a
// second copy that could drift from `enums.ts` (code-conventions: infer,
// never hand-write, a type that already exists elsewhere).
type ClientStatus = (typeof clientStatus.enumValues)[number];
type ExperienceLevel = (typeof experienceLevel.enumValues)[number];
type TrainingGoal = (typeof trainingGoal.enumValues)[number];

type ClientDef = {
  key: string;
  name: string;
  email: string;
  timezone: string;
  status: ClientStatus;
  goal: TrainingGoal;
  sexAtBirth: 'male' | 'female' | 'intersex' | 'prefer_not_to_say';
  experienceLevel: ExperienceLevel;
  heightCm: string;
  trainingDaysPerWeek: number;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  hasInjury: boolean;
};

const CLIENT_DEFS: ClientDef[] = [
  {
    key: 'client:1',
    name: 'Maya Chen',
    email: 'maya.chen@example.com',
    timezone: 'America/Los_Angeles',
    status: 'active',
    goal: 'fat_loss',
    sexAtBirth: 'female',
    experienceLevel: 'intermediate',
    heightCm: '165.0',
    trainingDaysPerWeek: 4,
    targetCalories: 1800,
    targetProteinG: 140,
    targetCarbsG: 150,
    targetFatG: 55,
    hasInjury: true, // phase-10-coach-review-surfaces/client-detail/03's injuries banner needs one
  },
  {
    key: 'client:2',
    name: 'Andre Silva',
    email: 'andre.silva@example.com',
    timezone: 'America/Sao_Paulo',
    status: 'active',
    goal: 'muscle_gain',
    sexAtBirth: 'male',
    experienceLevel: 'advanced',
    heightCm: '180.0',
    trainingDaysPerWeek: 5,
    targetCalories: 3100,
    targetProteinG: 190,
    targetCarbsG: 380,
    targetFatG: 90,
    hasInjury: false,
  },
  {
    key: 'client:3',
    name: 'Priya Nair',
    email: 'priya.nair@example.com',
    timezone: 'Asia/Kolkata',
    status: 'invited',
    goal: 'performance',
    sexAtBirth: 'female',
    experienceLevel: 'intermediate',
    heightCm: '160.0',
    trainingDaysPerWeek: 5,
    targetCalories: 2100,
    targetProteinG: 130,
    targetCarbsG: 230,
    targetFatG: 65,
    hasInjury: false,
  },
  {
    key: 'client:4',
    name: 'Tom Walsh',
    email: 'tom.walsh@example.com',
    timezone: 'Europe/London',
    status: 'paused',
    goal: 'health',
    sexAtBirth: 'male',
    experienceLevel: 'beginner',
    heightCm: '178.0',
    trainingDaysPerWeek: 3,
    targetCalories: 2400,
    targetProteinG: 150,
    targetCarbsG: 240,
    targetFatG: 75,
    hasInjury: false,
  },
  {
    key: 'client:5',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.com',
    timezone: 'America/Chicago',
    status: 'archived',
    goal: 'other',
    sexAtBirth: 'prefer_not_to_say',
    experienceLevel: 'intermediate',
    heightCm: '172.0',
    trainingDaysPerWeek: 4,
    targetCalories: 2200,
    targetProteinG: 140,
    targetCarbsG: 220,
    targetFatG: 65,
    hasInjury: false,
  },
];

export type SeededClient = {
  key: string;
  userId: string;
  clientProfileId: string;
  status: ClientStatus;
  goal: TrainingGoal;
  name: string;
};

/** Must run after `coach.ts` — every client belongs to the seeded coach. */
export async function seedClients(
  tx: Transaction,
  coachProfileId: string,
): Promise<SeededClient[]> {
  const seeded: SeededClient[] = [];

  for (const def of CLIENT_DEFS) {
    const userId = seedId(`user:${def.key}`);
    const clientProfileId = seedId(`client_profile:${def.key}`);
    const dob = dateStringFromAnchor(-365 * faker.number.int({ min: 22, max: 42 }));

    const invitedAt = timestampFromAnchor(-90, 9);
    const activatedAt = def.status === 'invited' ? null : timestampFromAnchor(-88, 10);
    const pausedAt = def.status === 'paused' ? timestampFromAnchor(-14, 8) : null;
    const archivedAt = def.status === 'archived' ? timestampFromAnchor(-7, 8) : null;

    await tx.insert(users).values({
      id: userId,
      email: def.email,
      passwordHash: null,
      name: def.name,
      role: 'client',
      timezone: def.timezone,
      locale: 'en',
      emailVerifiedAt: def.status === 'invited' ? null : timestampFromAnchor(-89, 9),
      onboardingCompletedAt: def.status === 'invited' ? null : timestampFromAnchor(-88, 11),
      lastActiveAt:
        def.status === 'archived' ? timestampFromAnchor(-8, 19) : timestampFromAnchor(-1, 20),
      weightUnit: def.timezone === 'Asia/Kolkata' ? 'kg' : 'lb',
      dateOfBirth: dob,
      // An invited user has no verified email yet, so the users_email_or_social
      // CHECK needs a password hash instead — a fixed inert placeholder, never
      // a real credential.
      ...(def.status === 'invited' ? { passwordHash: 'seed-placeholder-unusable' } : {}),
      // Explicit — see coach.ts's comment on the same pair for why this
      // can never be left to the column's `.defaultNow()`.
      createdAt: invitedAt,
      updatedAt: archivedAt ?? pausedAt ?? activatedAt ?? invitedAt,
    });

    await tx.insert(clientProfiles).values({
      id: clientProfileId,
      userId,
      coachId: coachProfileId,
      status: def.status,
      invitedAt,
      activatedAt,
      pausedAt,
      archivedAt,
      dateOfBirth: dob,
      sexAtBirth: def.sexAtBirth,
      heightCm: def.heightCm,
      goal: def.goal,
      goalNotes: faker.lorem.sentence(),
      experienceLevel: def.experienceLevel,
      trainingDaysPerWeek: def.trainingDaysPerWeek,
      equipmentAccess: ['barbell', 'dumbbell', 'machine', 'cable'],
      dietaryRestrictions: def.key === 'client:3' ? ['vegetarian'] : [],
      injuries: def.hasInjury
        ? [
            {
              area: 'left knee',
              notes: 'Mild ACL strain from 2025 — avoid deep unracked squats, prefer box squats.',
              since: '2025-11',
              severity: 'moderate',
            },
          ]
        : [],
      targetCalories: def.targetCalories,
      targetProteinG: def.targetProteinG,
      targetCarbsG: def.targetCarbsG,
      targetFatG: def.targetFatG,
      createdAt: invitedAt,
      updatedAt: archivedAt ?? pausedAt ?? activatedAt ?? invitedAt,
    });

    seeded.push({
      key: def.key,
      userId,
      clientProfileId,
      status: def.status,
      goal: def.goal,
      name: def.name,
    });
  }

  return seeded;
}
