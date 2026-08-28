// The daily sweep (`07`'s Approach step 6, DB§15's `age-and-moderation-sweep`
// queue) — a 17-year-old turns 18 without ever opening the app, so
// `is_minor` has to be re-evaluated on a clock, not only at signup/consent.
// Shares one job with suspension expiry per DB§15's own line; both are
// "clear a time-bound flag once its clock runs out," the same shape of
// work.
//
// Deliberately incomplete, matching `metrics-collector.ts`'s own precedent:
// this function clears `is_minor` and notifies both parties, which is
// everything the identity layer owns. "Restores the normal feature set"
// (progress photos, analytics, AI — `CLAUDE.md` §21.5's table) is enforced
// by each of those features' own procedures checking `is_minor` live, not
// by this job — none of P07 media, P21 analytics-toggle, or P23 AI exists
// yet to restore. This job's contract to them is `is_minor` itself being
// correct on the clock; nothing else.
//
// Not yet wired to a BullMQ queue or a cron trigger — `queues/registry.ts`'s
// `age-and-moderation-sweep` entry and its schedule are `background-jobs`
// territory (Phase 2) to add when this function has a queue to run in;
// this file is the work itself, callable and tested independently of that.
import { schema, type DbClient, type User } from '@coachos/db';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { computeAgeYears, ADULT_AGE_YEARS } from '../features/auth/age.ts';
import { sendEmail } from '../lib/email/client.ts';
import { GuardianAccessEndedEmail } from '../lib/email/templates/guardian-access-ended.ts';
import { logger } from '../lib/logger.ts';

export interface AgeSweepResult {
  minorStatusCleared: number;
  suspensionsExpired: number;
}

/**
 * Re-evaluates every client currently flagged `is_minor` against their
 * `date_of_birth`; for anyone who has reached {@link ADULT_AGE_YEARS},
 * clears `is_minor` and emails the client and (if one was recorded) the
 * guardian that guardian access has ended. Also clears `suspended_until`
 * for any user whose suspension has already passed (DB§15's shared job).
 */
export async function runAgeSweep(db: DbClient, asOf: Date = new Date()): Promise<AgeSweepResult> {
  const minorClients = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.role, 'client'), eq(schema.users.isMinor, true)));

  const nowAdults = minorClients.filter(
    (user) =>
      user.dateOfBirth !== null && computeAgeYears(user.dateOfBirth, asOf) >= ADULT_AGE_YEARS,
  );

  for (const user of nowAdults) {
    await db.update(schema.users).set({ isMinor: false }).where(eq(schema.users.id, user.id));
    await notifyAdultTransition(user);
  }

  const expiredSuspensions = await db
    .update(schema.users)
    .set({ suspendedUntil: null })
    .where(and(isNotNull(schema.users.suspendedUntil), lte(schema.users.suspendedUntil, asOf)))
    .returning({ id: schema.users.id });

  logger.info('age_sweep.completed', {
    count: nowAdults.length + expiredSuspensions.length,
  });

  return { minorStatusCleared: nowAdults.length, suspensionsExpired: expiredSuspensions.length };
}

async function notifyAdultTransition(user: User): Promise<void> {
  await sendEmail({
    to: user.email,
    subject: 'Your CoachOS account has been updated',
    react: GuardianAccessEndedEmail({ recipient: 'client' }),
  });
  if (user.guardianEmail) {
    await sendEmail({
      to: user.guardianEmail,
      subject: "Your access to your child's CoachOS account has ended",
      react: GuardianAccessEndedEmail({ recipient: 'guardian' }),
    });
  }
}
