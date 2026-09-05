// `phase-06-onboarding/onboarding-infrastructure/03` — recording, and
// reading back, that a person acknowledged the §21.3 medical disclaimer.
//
// The nested router lives here rather than in `../../routers/me.ts` on
// purpose: `me.ts` is a busy file that several phases edit at once, and a
// two-procedure feature has no reason to add eight more lines to it. The
// registration there is one import and one key (`coach.clients` is the
// existing precedent for a nested router under a top-level one).
import { schema, type DbClient } from '@coachos/db';
import { me as meSchemas } from '@coachos/schemas';
import { and, eq } from 'drizzle-orm';

import { router } from '../../trpc/init.ts';
import { protectedProcedure } from '../../trpc/procedures.ts';

export interface MedicalDisclaimerStatus {
  /** The wording the app should be showing (`packages/schemas`). */
  currentVersion: string;
  /** When this user acknowledged THAT wording, or null if they have not. */
  acknowledgedAt: Date | null;
}

async function readAcknowledgedAt(
  db: DbClient,
  userId: string,
  version: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ acknowledgedAt: schema.medicalDisclaimerAcknowledgements.acknowledgedAt })
    .from(schema.medicalDisclaimerAcknowledgements)
    .where(
      and(
        eq(schema.medicalDisclaimerAcknowledgements.userId, userId),
        eq(schema.medicalDisclaimerAcknowledgements.version, version),
      ),
    )
    .limit(1);
  return row?.acknowledgedAt ?? null;
}

/**
 * Idempotent: a second tap (a retry, a double-press, a replayed request)
 * must not move the recorded moment. `ON CONFLICT DO NOTHING` returns no
 * row on the repeat path, which is exactly when the existing timestamp is
 * read back instead — the first acknowledgment is the one that stands.
 */
export async function acknowledgeMedicalDisclaimer(
  db: DbClient,
  userId: string,
  version: string,
): Promise<Date> {
  const [inserted] = await db
    .insert(schema.medicalDisclaimerAcknowledgements)
    .values({ userId, version })
    .onConflictDoNothing()
    .returning({ acknowledgedAt: schema.medicalDisclaimerAcknowledgements.acknowledgedAt });

  if (inserted) return inserted.acknowledgedAt;

  const existing = await readAcknowledgedAt(db, userId, version);
  if (existing) return existing;

  // The row was inserted by a concurrent request and then removed before
  // this read — only reachable if the account is being purged mid-request.
  throw new Error(`medicalDisclaimer.acknowledge: no row for user ${userId} after upsert`);
}

export const medicalDisclaimerRouter = router({
  // No `ownsResource`: a user always owns their own acknowledgment, and no
  // id crosses the wire — the row is addressed by `ctx.user.id` alone
  // (`api-conventions` §3, the same reasoning `me.get` states).
  status: protectedProcedure.query(async ({ ctx }): Promise<MedicalDisclaimerStatus> => {
    const currentVersion = meSchemas.CURRENT_MEDICAL_DISCLAIMER_VERSION;
    return {
      currentVersion,
      acknowledgedAt: await readAcknowledgedAt(ctx.db, ctx.user.id, currentVersion),
    };
  }),

  acknowledge: protectedProcedure
    .input(meSchemas.acknowledgeMedicalDisclaimerInput)
    .mutation(async ({ ctx, input }) => ({
      acknowledgedAt: await acknowledgeMedicalDisclaimer(ctx.db, ctx.user.id, input.version),
    })),
});
