// `invites.listPending` (`05`) — a straightforward query against the
// `invites_pending` index (`identity-schema/04`), the same predicate
// `seat-check.ts`'s `assertSeatAvailable` counts against, reused here for
// display: `accepted_at IS NULL AND revoked_at IS NULL`, scoped to the
// calling coach.
import { schema, type DbClient, type Invite } from '@coachos/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

export type PendingInvite = Pick<Invite, 'id' | 'email' | 'createdAt' | 'expiresAt'>;

export async function listPendingInvites(
  db: DbClient,
  coachProfileId: string,
): Promise<PendingInvite[]> {
  return db
    .select({
      id: schema.invites.id,
      email: schema.invites.email,
      createdAt: schema.invites.createdAt,
      expiresAt: schema.invites.expiresAt,
    })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.coachId, coachProfileId),
        isNull(schema.invites.acceptedAt),
        isNull(schema.invites.revokedAt),
      ),
    )
    .orderBy(desc(schema.invites.createdAt));
}
