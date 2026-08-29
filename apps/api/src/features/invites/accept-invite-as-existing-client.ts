// `account-lifecycle/07` — the returning-client half of invite acceptance.
// Deliberately a PROTECTED procedure, unlike `invites.accept`: a returning
// client already has a password-protected account, so proving who they are
// by presenting an invite code plus a fresh password (the first-time
// shape) would let anyone who merely knows a former client's email take
// over that account. Requiring an existing session instead means there is
// no new identity-proof surface at all — the caller is already
// authenticated as themselves before a code is ever looked at.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import {
  attachClient,
  type HistorySharingDecision,
} from '../../services/coach-client-transition.ts';
import type { Context } from '../../trpc/context.ts';

import { inviteNotFound, loadAndValidateInvite } from './accept-invite.ts';
import { assertSeatAvailable } from './seat-check.ts';

export type AcceptInviteAsExistingClientInput = { code: string } & HistorySharingDecision;

export async function acceptInviteAsExistingClient(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'> & {
    user: { id: string; email: string; clientProfileId: string | null };
  },
  input: AcceptInviteAsExistingClientInput,
): Promise<{ success: true }> {
  if (ctx.user.clientProfileId === null) {
    // `hasRole('client')` already guarantees this in practice — guarded
    // anyway rather than risking a crash on a stale cached role.
    throw appError('ROLE_REQUIRED', "You don't have access to that.", { requiredRole: 'client' });
  }
  const clientProfileId = ctx.user.clientProfileId;

  const invite = await loadAndValidateInvite(db, input.code);

  // The code's own state (expired/accepted/revoked) is already ruled out
  // above. This is the identity check `05-invite-acceptance`'s public path
  // gets for free from "the account doesn't exist yet, so the password
  // sets it" — here it doesn't exist yet in that sense, so email match
  // against the *authenticated* caller is what proves this invite was
  // meant for them. `INVITE_NOT_FOUND`, not a distinguishing error: a
  // caller probing whether some invite code belongs to their own email is
  // exactly the enumeration `security-and-privacy`'s NOT_FOUND-vs-FORBIDDEN
  // rule exists to close off.
  if (invite.email !== ctx.user.email) {
    throw inviteNotFound();
  }

  await assertSeatAvailable(db, invite.coachId);

  await db.transaction(async (tx) => {
    // `attachClient` itself throws `CLIENT_ALREADY_HAS_COACH` if this
    // client isn't actually coachless — the one case `05`'s own AC names
    // explicitly ("a client with a current coach is rejected").
    await attachClient(tx, ctx, {
      clientProfileId,
      newCoachId: invite.coachId,
      historySharing: input.historySharing,
      shareMetrics: input.shareMetrics,
      shareNutrition: input.shareNutrition,
    });

    await tx
      .update(schema.invites)
      .set({ acceptedAt: new Date(), acceptedByUserId: ctx.user.id })
      .where(eq(schema.invites.id, invite.id));

    await writeAuditLog(tx, ctx, {
      action: 'invite.accepted',
      targetType: 'invite',
      targetId: invite.id,
    });
  });

  return { success: true } as const;
}
