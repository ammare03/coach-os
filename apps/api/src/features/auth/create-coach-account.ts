// The transactional write path for `auth.signUp` — user row, coach profile
// row, audit row, in that order, one transaction (`02`'s Approach step 5).
// `../../invites/04-invite-acceptance.md` deliberately does not reuse this:
// a client account needs different rows, but follows the same shape.
import { schema, type CoachProfile, type Transaction, type User } from '@coachos/db';

import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

export interface CreateCoachAccountInput {
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
}

export interface CreateCoachAccountResult {
  user: User;
  coachProfile: CoachProfile;
}

/**
 * Inserts `identity.users` (role fixed to `'coach'` — never a parameter;
 * `../../routers/auth.ts`'s `signUp` is the only caller and `signUpInput`
 * has no `role` field for a caller to send one) and `identity.coach_profiles`
 * in one transaction, then writes the `auth.signup` audit row with the new
 * user as actor.
 *
 * `tx` has no default — same convention as `writeAuditLog` — so a caller
 * that forgets to wrap this in `db.transaction(...)` fails to compile
 * rather than silently running two separate commits. If the second insert
 * throws, the first insert's effects roll back with it; this function does
 * no error handling of its own, since a duplicate-email unique violation is
 * `../../routers/auth.ts`'s to catch and translate, not this file's.
 */
export async function createCoachAccount(
  tx: Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  input: CreateCoachAccountInput,
): Promise<CreateCoachAccountResult> {
  const [user] = await tx
    .insert(schema.users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: 'coach',
      timezone: input.timezone,
    })
    .returning();
  if (!user) throw new Error('insert into identity.users did not return a row');

  const [coachProfile] = await tx
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning();
  if (!coachProfile) throw new Error('insert into identity.coach_profiles did not return a row');

  await writeAuditLog(tx, ctx, {
    action: 'auth.signup',
    targetType: 'user',
    targetId: user.id,
    actorUserId: user.id, // the row this same transaction just inserted — not in ctx
  });

  return { user, coachProfile };
}
