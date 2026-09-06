// `client-onboarding/01` — the read behind the returning-client acceptance
// screen. That screen asks a client to decide what a new coach may see of
// their previous life on the platform, and asking that without naming the
// coach is not a decision anyone can make.
//
// Deliberately the same two guards as `accept-invite-as-existing-client.ts`,
// in the same order: the code's terminal states first
// (`loadAndValidateInvite`), then the email match against the AUTHENTICATED
// caller. `INVITE_NOT_FOUND` for a mismatch, never a distinguishing error —
// a preview that answered for a code addressed to someone else would be an
// enumeration oracle for whose invite a code is (`security-and-privacy` §1).
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { inviteNotFound, loadAndValidateInvite } from './accept-invite.ts';

export interface InvitePreview {
  /** The coach's own name, not their business name — the person is who a client is joining. */
  coachName: string;
}

export async function previewInvite(
  db: DbClient,
  // Only the caller's own email, because that is all this read is allowed
  // to turn on. A wider `Context` here would let a later edit reach for
  // something else without the signature changing.
  ctx: { user: { email: string } },
  code: string,
): Promise<InvitePreview> {
  const invite = await loadAndValidateInvite(db, code);

  if (invite.email !== ctx.user.email) {
    throw inviteNotFound();
  }

  const [row] = await db
    .select({ coachName: schema.users.name })
    .from(schema.coachProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.coachProfiles.userId))
    .where(eq(schema.coachProfiles.id, invite.coachId))
    .limit(1);

  // A valid invite whose coach row has vanished is unreachable — `invites`
  // cascades on coach deletion. Answering with the same `INVITE_NOT_FOUND`
  // rather than throwing keeps that impossible case indistinguishable too.
  if (!row) {
    throw inviteNotFound();
  }
  return { coachName: row.coachName };
}
