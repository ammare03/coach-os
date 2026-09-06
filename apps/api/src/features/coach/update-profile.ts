import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `coach.updateProfile` (`phase-06-onboarding/coach-onboarding/02`) — the
// first write in the coach onboarding flow.
//
// Addressed by `ctx.user.coachProfileId`, never by an id from `input`, so
// there is no `ownsResource` to reach for: a coach always owns their own
// profile row, the same reasoning `me.get` and `me.update` state.

/**
 * Mirrors `packages/schemas`' `updateProfileInput` exactly. Both fields
 * required — the step always sends both, and "no specialties" is an empty
 * array rather than an absent key, so `.set()` below can never partially
 * apply and leave the row in a state neither the caller nor the screen
 * expected.
 */
export interface UpdateCoachProfileInput {
  businessName: string;
  specialties: readonly string[];
}

export interface CoachProfileSummary {
  businessName: string | null;
  specialties: string[];
}

export async function updateCoachProfile(
  db: DbClient,
  coachProfileId: string,
  input: UpdateCoachProfileInput,
): Promise<CoachProfileSummary> {
  const [row] = await db
    .update(schema.coachProfiles)
    .set({ businessName: input.businessName, specialties: [...input.specialties] })
    .where(eq(schema.coachProfiles.id, coachProfileId))
    .returning({
      businessName: schema.coachProfiles.businessName,
      specialties: schema.coachProfiles.specialties,
    });

  // Same unreachable-in-practice race `update-me.ts` documents: the row
  // existed when `hasRole('coach')` resolved `coachProfileId` for this
  // same request.
  if (!row) {
    throw new Error(`coach.updateProfile: coach profile ${coachProfileId} not found`);
  }
  return row;
}
