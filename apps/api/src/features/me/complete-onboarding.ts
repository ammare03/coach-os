// `phase-06-onboarding/onboarding-infrastructure/02` — the moment
// `identity.users.onboarding_completed_at` stops being a column nothing
// writes and becomes the flag the app's route gate reads.
//
// Lives here rather than in `../../routers/me.ts` for the reason
// `medical-disclaimer.ts` states: `me.ts` is a busy file several phases
// edit at once, and the registration there is one import and one key.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

export interface OnboardingCompletion {
  onboardingCompletedAt: Date;
}

/**
 * Marks the caller onboarded. Called once, by each flow's final step, only
 * after that step's own write has succeeded — never inferred from "every
 * field has a value" (this task's Approach step 2). An explicit flag set at
 * exactly one moment is what makes the gate's third dimension answerable;
 * inferring it from scattered data makes "is this person onboarded" a
 * different question on every screen that asks.
 *
 * Idempotent, and deliberately so on the *first* write: `WHERE
 * onboarding_completed_at IS NULL` means a retry, a double-tap, or a
 * replayed request cannot move the recorded moment forward — the same rule
 * `acknowledgeMedicalDisclaimer` applies to its own timestamp.
 */
export async function completeOnboarding(
  db: DbClient,
  userId: string,
): Promise<OnboardingCompletion> {
  const [updated] = await db
    .update(schema.users)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.onboardingCompletedAt)))
    .returning({ onboardingCompletedAt: schema.users.onboardingCompletedAt });

  if (updated?.onboardingCompletedAt) {
    return { onboardingCompletedAt: updated.onboardingCompletedAt };
  }

  // Zero rows: either already onboarded (the repeat path) or the row is
  // gone. Read back to tell those apart rather than assuming the first.
  const [existing] = await db
    .select({ onboardingCompletedAt: schema.users.onboardingCompletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (existing?.onboardingCompletedAt) {
    return { onboardingCompletedAt: existing.onboardingCompletedAt };
  }

  // Same unreachable-in-practice race `get-me.ts` describes — the row
  // existed when `isAuthed` resolved `ctx.user` for this same request.
  throw new Error(`me.completeOnboarding: authenticated user ${userId} row not found`);
}
