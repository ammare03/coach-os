// The seat check `invites/01` and `invites/04` both need — creation-time and
// acceptance-time, independently (`CLAUDE.md` §15.5: a coach's tier could
// change, or another invite could be accepted, between the two moments, so
// neither call site may skip its own check on the assumption the other
// already ran it).
import { schema, type DbClient } from '@coachos/db';
import { deriveClientSeatLimit } from '@coachos/utils';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

const SEAT_LIMIT_MESSAGE =
  'You have reached your client limit for this plan. Upgrade or add a seat pack to invite more clients.';

/**
 * Active clients (`client_profiles.status IN ('active', 'invited')`, the
 * `client_profiles_active_seats` index) plus pending invites
 * (`accepted_at IS NULL AND revoked_at IS NULL`, the `invites_pending`
 * index) — the two counts are disjoint by construction (`invites/01`'s own
 * Approach step 2): an accepted invite becomes a `client_profiles` row and
 * drops out of `invites_pending` in the same transaction, so nothing is
 * ever counted twice.
 *
 * Throws `SEAT_LIMIT_REACHED` if the coach is already at or past their
 * derived limit — the caller is about to add one more (an invite, or an
 * acceptance), so "at the limit" already means "no room for this one".
 * Agency's `Infinity` limit short-circuits before either count query runs.
 */
export async function assertSeatAvailable(db: DbClient, coachProfileId: string): Promise<void> {
  const [coach] = await db
    .select({
      tier: schema.coachProfiles.subscriptionTier,
      seatPacks: schema.coachProfiles.seatPacks,
    })
    .from(schema.coachProfiles)
    .where(eq(schema.coachProfiles.id, coachProfileId))
    .limit(1);
  if (!coach) {
    // `coachProfileId` came from `hasRole('coach')`, which already
    // confirmed the row exists (`../../trpc/middleware/has-role.ts`) — not
    // reachable in practice, guarded anyway rather than risking a crash on
    // a stale cached id.
    throw appError(
      'INTERNAL_ERROR',
      'Something went wrong. Contact support with this reference.',
      {},
    );
  }

  const seatLimit = deriveClientSeatLimit(coach.tier, coach.seatPacks);
  if (seatLimit === Infinity) {
    return;
  }

  const [activeRow] = await db
    .select({ value: count() })
    .from(schema.clientProfiles)
    .where(
      and(
        eq(schema.clientProfiles.coachId, coachProfileId),
        inArray(schema.clientProfiles.status, ['active', 'invited']),
        isNull(schema.clientProfiles.deletedAt),
      ),
    );
  const [pendingRow] = await db
    .select({ value: count() })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.coachId, coachProfileId),
        isNull(schema.invites.acceptedAt),
        isNull(schema.invites.revokedAt),
      ),
    );

  const seatsUsed = (activeRow?.value ?? 0) + (pendingRow?.value ?? 0);
  if (seatsUsed >= seatLimit) {
    throw appError('SEAT_LIMIT_REACHED', SEAT_LIMIT_MESSAGE, { seatsUsed, seatLimit });
  }
}
