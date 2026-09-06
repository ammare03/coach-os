// DB§21: exactly 1 coach, Pro tier — exercising the higher tier's feature
// set (AI generation caps, higher storage) in later phases' manual testing
// (seed-and-fixtures/01's own Approach §2).
import type { Transaction } from '../aggregates/types.ts';
import { coachProfiles, medicalDisclaimerAcknowledgements, users } from '../schema/identity.ts';

import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

export type SeededCoach = {
  userId: string;
  coachProfileId: string;
};

/** Must run before every other seed module — everything else references this coach. */
export async function seedCoach(tx: Transaction): Promise<SeededCoach> {
  const userId = seedId('user:coach:main');
  const coachProfileId = seedId('coach_profile:main');

  await tx.insert(users).values({
    id: userId,
    email: 'coach@coachos.dev',
    passwordHash: null,
    name: faker.person.fullName(),
    role: 'coach',
    timezone: 'America/New_York',
    locale: 'en',
    emailVerifiedAt: timestampFromAnchor(-400, 9),
    onboardingCompletedAt: timestampFromAnchor(-399, 10),
    lastActiveAt: timestampFromAnchor(-1, 18, 30),
    weightUnit: 'lb',
    dateOfBirth: dateStringFromAnchor(-365 * 34),
    // Explicit, not left to the column's `.defaultNow()` — that default is
    // real wall-clock time, which would make two `pnpm db:seed` runs a few
    // seconds apart produce different `created_at`/`updated_at` values and
    // break DB§21's byte-identical requirement (found live: this was the
    // actual, only, source of non-determinism in this seed — every id and
    // every date-typed column was already anchored, but this administrative
    // pair was not). Every insert in every seed module sets both explicitly
    // for the same reason; see this comment as the canonical explanation,
    // referenced rather than repeated at each site.
    createdAt: timestampFromAnchor(-400, 9),
    updatedAt: timestampFromAnchor(-1, 18, 30),
  });

  // §21.3's disclaimer is acknowledged during onboarding, so a seeded user
  // with `onboarding_completed_at` set must have a row here too — otherwise
  // the seed describes a state the app cannot produce
  // (`phase-06-onboarding/onboarding-infrastructure/03`).
  await tx.insert(medicalDisclaimerAcknowledgements).values({
    userId,
    version: '2026-09-placeholder',
    acknowledgedAt: timestampFromAnchor(-399, 10),
  });

  await tx.insert(coachProfiles).values({
    id: coachProfileId,
    userId,
    businessName: 'Summit Strength Coaching',
    bio: faker.lorem.paragraph(),
    // The slugs `packages/schemas`' `COACH_SPECIALTIES` closes the set to
    // (`coach-onboarding/02`) — seeded data has to be data the product
    // could actually have written.
    specialties: ['powerlifting', 'hypertrophy', 'fat-loss'],
    certifications: ['NASM-CPT', 'Precision Nutrition L1'],
    instagramHandle: '@summitstrengthcoaching',
    website: 'https://summitstrength.example.com',
    brandPrimaryColor: '#2E6F40',
    subscriptionTier: 'pro',
    subscriptionStatus: 'active',
    billingPlatform: 'app_store',
    revenuecatAppUserId: 'seed-coach-main',
    storeTransactionId: 'seed-txn-coach-main',
    billingCountry: 'US',
    billingCurrency: 'USD',
    seatPacks: 0,
    trialUsedAt: timestampFromAnchor(-400, 9),
    billingSyncedAt: timestampFromAnchor(-1, 3),
    createdAt: timestampFromAnchor(-400, 9),
    updatedAt: timestampFromAnchor(-1, 3),
  });

  return { userId, coachProfileId };
}
