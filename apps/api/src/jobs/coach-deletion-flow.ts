// `account-lifecycle/05` — DB§19.2: "Coach deletion is different and must
// not silently orphan clients." `client_profiles.coach_id`'s `ON DELETE
// RESTRICT` (`identity-schema/03`) makes `purge-account.ts`'s generic
// `DELETE FROM users` fail outright while any client still references the
// coach — this is the flow that clears every such reference first, calling
// `account-lifecycle/06`'s `detachClient` (never a second implementation —
// that task's own Risks section) so the coach can then be purged by the
// unmodified, generic flow.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { enqueuePurgeAccount } from '../queues/enqueue.ts';
import { detachClient } from '../services/coach-client-transition.ts';
import type { Context } from '../trpc/context.ts';

import { sendCoachDeletionNoticeEmail } from './send-coach-deletion-notice-email.ts';

const CLIENT_EXPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// This step runs with no live request — there is no session to attribute
// it to. `writeAuditLog` (called inside `detachClient`) accepts a `null`
// `ctx.user` and records a `null` actor, same as any other system-initiated
// write; a fresh timestamp per call keeps `receivedAt` honest rather than
// frozen at module load.
function systemCtx(): Pick<Context, 'user' | 'request'> {
  return {
    user: null,
    request: { ip: null, trustedIp: null, userAgent: null, receivedAt: new Date() },
  };
}

export type CoachDeletionStepOutcome =
  // Not a coach row at all (a client, or already gone) — the sweep's
  // ordinary immediate-enqueue path applies; this function is a no-op for it.
  | 'not_a_coach'
  // A coach with no client still referencing them — nothing to detach,
  // purge enqueued immediately, same as any other account.
  | 'purged'
  // First time this coach's 7-day grace has elapsed with clients still
  // attached — notices sent, 30-day window started, purge NOT enqueued yet.
  | 'notified'
  // Notices already sent; the 30-day window hasn't elapsed yet.
  | 'waiting'
  // Window elapsed — every referencing client detached, purge enqueued.
  | 'detached_and_purged';

/**
 * Called by `sweep-deletion-requests.ts` for every due row, in place of an
 * unconditional `enqueuePurgeAccount`. Idempotent and safe to re-run on
 * every sweep interval, same discipline as the sweep itself: re-running
 * against a coach already fully detached just re-enqueues the (idempotent,
 * `jobId`-deduped) purge job; re-running before the window elapses is a
 * no-op read.
 */
export async function processCoachDeletionStep(
  db: DbClient,
  userId: string,
): Promise<CoachDeletionStepOutcome> {
  const [coach] = await db
    .select({
      coachProfileId: schema.coachProfiles.id,
      businessName: schema.coachProfiles.businessName,
    })
    .from(schema.coachProfiles)
    .where(eq(schema.coachProfiles.userId, userId));

  if (!coach) {
    await enqueuePurgeAccount({ userId });
    return 'not_a_coach';
  }

  // The literal RESTRICT gate (`identity-schema/03`) — ANY client still
  // pointing at this coach blocks the purge, regardless of status. Status
  // only decides who gets *notified* below, never who must be detached.
  const referencingClients = await db
    .select({ id: schema.clientProfiles.id, status: schema.clientProfiles.status })
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.coachId, coach.coachProfileId));

  if (referencingClients.length === 0) {
    await enqueuePurgeAccount({ userId });
    return 'purged';
  }

  const [request] = await db
    .select({ coachClientsNotifiedAt: schema.deletionRequests.coachClientsNotifiedAt })
    .from(schema.deletionRequests)
    .where(eq(schema.deletionRequests.userId, userId));

  if (!request?.coachClientsNotifiedAt) {
    const [coachUser] = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    const coachName = coach.businessName ?? coachUser?.name ?? 'Your coach';

    // Archived clients are exempt from notice (DB§19.2's own wording) —
    // they already left the coach's active roster and are not the
    // audience this notice is for — but still get detached below once the
    // window elapses, since RESTRICT does not care about status.
    const toNotify = referencingClients.filter((c) => c.status !== 'archived');
    for (const client of toNotify) {
      await sendCoachDeletionNoticeEmail(db, client.id, coachName);
    }

    await db
      .update(schema.deletionRequests)
      .set({ coachClientsNotifiedAt: new Date() })
      .where(eq(schema.deletionRequests.userId, userId));
    return 'notified';
  }

  const elapsedMs = Date.now() - request.coachClientsNotifiedAt.getTime();
  if (elapsedMs < CLIENT_EXPORT_WINDOW_MS) {
    return 'waiting';
  }

  for (const client of referencingClients) {
    await detachClient(db, systemCtx(), { clientProfileId: client.id, initiatedBy: 'coach' });
  }
  await enqueuePurgeAccount({ userId });
  return 'detached_and_purged';
}
