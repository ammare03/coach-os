// `account-lifecycle/06` — the one shared implementation `client.leaveCoach`,
// `coach.clients.release`, and coach deletion (`account-lifecycle/05`) all
// call. CLAUDE.md §21.3, verbatim: "If a client leaves a coach, the coach
// loses access to new data; the client keeps their history." Three
// half-consistent detachment paths is how a client ends up visible to a
// coach they left (this task's own Risks section) — there is exactly one
// `detachClient`.
//
// `account-lifecycle/07` adds `attachClient`, the other half: a returning
// client (one with `former_coach_id` set) joining a new coach on their
// existing account, never a new one — there is no coach-to-coach transfer
// path anywhere, deliberately (that task's own Risks section).
import { schema, type DbClient, type Transaction } from '@coachos/db';
import { and, eq, sql } from 'drizzle-orm';

import { appError } from '../lib/app-error.ts';
import { writeAuditLog } from '../lib/audit-log.ts';
import { sendEmail } from '../lib/email/client.ts';
import { RelationshipEndedEmail } from '../lib/email/templates/relationship-ended.ts';
import type { Context } from '../trpc/context.ts';

export type DetachInitiator = 'client' | 'coach';

export interface DetachClientResult {
  clientUserId: string;
  clientName: string;
  clientEmail: string;
  coachUserId: string;
  coachName: string;
  coachEmail: string;
}

/**
 * Nulls `client_profiles.coach_id`, records `former_coach_id`/`detached_at`
 * (the read-time grant `ownsResource`'s former-coach clause checks — never
 * a data copy), nulls the DB§6 denormalised `coach_id` on
 * `workout_sessions`/`meals`/`checkins`/`media_assets` for this client's
 * rows so that fast path stops matching the departed coach (leaving it
 * stale would grant *permanent*, not 30-day, access — `DATABASE.md` DB§6's
 * own note), ends the active assignment, and audits the change — all in
 * one transaction. **Never deletes a row.** `comments` and `set_logs` need
 * no such treatment: they already resolve coach ownership by joining live
 * to `client_profiles.coach_id` rather than carrying their own copy, so
 * they lose access the instant that column is nulled.
 *
 * Returns both parties' identity so the caller can notify them — this
 * function does the write, never the send, so a slow email provider can
 * never hold the transaction open (same split `invites/create-invite.ts`
 * draws between itself and `send-invite-email.ts`).
 */
export async function detachClient(
  db: DbClient | Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  params: { clientProfileId: string; initiatedBy: DetachInitiator },
): Promise<DetachClientResult> {
  const { clientProfileId, initiatedBy } = params;

  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ coachId: schema.clientProfiles.coachId, userId: schema.clientProfiles.userId })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, clientProfileId));

    if (!client || client.coachId === null) {
      // The router checks this first (`coach_id IS NOT NULL`) — reaching
      // here means it didn't, or two calls raced. Refuse loudly rather
      // than silently re-detach an already-coachless client.
      throw appError('CLIENT_HAS_NO_COACH', "You're not currently working with a coach.", {});
    }
    const formerCoachId = client.coachId;
    const now = new Date();

    // The transition, precisely (task 06's own table). Status is left
    // exactly as it was — a detached client is a real, valid, coachless
    // state, not a soft-deleted or re-archived one. `client_profiles` itself
    // carries no guard trigger (only the leaf tables below do), so this
    // update needs no bypass.
    await tx
      .update(schema.clientProfiles)
      .set({ coachId: null, formerCoachId, detachedAt: now })
      .where(eq(schema.clientProfiles.id, clientProfileId));

    // The documented, sanctioned exception `derived-data/02`'s guard
    // triggers exist for (`migrations/0022_guard_triggers.sql`) —
    // transaction-scoped (`SET LOCAL`), so it cannot leak past this commit.
    // Required for every write below that touches a guarded `coach_id`.
    await tx.execute(sql`SET LOCAL app.allow_owner_change = true`);

    // Stop the DB§6 fast path from matching the departed coach forever.
    // `comments`/`set_logs` carry no such column (see this function's own
    // doc comment) and need no equivalent statement.
    await tx
      .update(schema.workoutSessions)
      .set({ coachId: null })
      .where(eq(schema.workoutSessions.clientId, clientProfileId));
    await tx
      .update(schema.meals)
      .set({ coachId: null })
      .where(eq(schema.meals.clientId, clientProfileId));
    await tx
      .update(schema.checkins)
      .set({ coachId: null })
      .where(eq(schema.checkins.clientId, clientProfileId));
    await tx
      .update(schema.mediaAssets)
      .set({ coachId: null })
      .where(eq(schema.mediaAssets.clientId, clientProfileId));

    // Active assignments end with the relationship; the row is kept
    // (never deleted), so the client can still see it read-only.
    await tx
      .update(schema.assignments)
      .set({ status: 'completed', completedAt: now })
      .where(
        and(
          eq(schema.assignments.clientId, clientProfileId),
          eq(schema.assignments.status, 'active'),
        ),
      );

    await writeAuditLog(tx, ctx, {
      action: initiatedBy === 'client' ? 'coaching.client_left' : 'coaching.client_released',
      targetType: 'client_profile',
      targetId: clientProfileId,
    });

    const [clientUser] = await tx
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, client.userId));
    const [coachProfile] = await tx
      .select({ userId: schema.coachProfiles.userId })
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.id, formerCoachId));
    if (!clientUser || !coachProfile) {
      // `clientProfileId`/`formerCoachId` were both just read from live
      // rows inside this same transaction — not reachable in practice.
      throw new Error('detachClient: client or coach profile vanished within the same transaction');
    }
    const [coachUser] = await tx
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, coachProfile.userId));
    if (!coachUser) {
      throw new Error('detachClient: coach user vanished within the same transaction');
    }

    return {
      clientUserId: clientUser.id,
      clientName: clientUser.name,
      clientEmail: clientUser.email,
      coachUserId: coachUser.id,
      coachName: coachUser.name,
      coachEmail: coachUser.email,
    };
  });
}

/**
 * Sent to both parties, each their own copy, plainly and without blame —
 * `product-copy` skill §5: no reason forwarded either direction. Fire-and-
 * forget off the response path, same shape as `me/request-deletion.ts`'s
 * recovery email.
 */
export async function notifyRelationshipEnded(result: DetachClientResult): Promise<void> {
  await Promise.all([
    sendEmail({
      to: result.coachEmail,
      subject: `${result.clientName} is no longer working with you`,
      react: RelationshipEndedEmail({ recipientRole: 'coach', otherPartyName: result.clientName }),
    }),
    sendEmail({
      to: result.clientEmail,
      subject: `You're no longer working with ${result.coachName}`,
      react: RelationshipEndedEmail({ recipientRole: 'client', otherPartyName: result.coachName }),
    }),
  ]);
}

// `account-lifecycle/07` — the three options the acceptance step and the
// settings screen both offer (that task's own Approach step 2). A union,
// never a boolean or a stored duration — see `computeHistorySharedFrom`'s
// own comment for why a duration is the one shortcut this task's Risks
// section calls out by name.
export type HistorySharing = 'twelve_weeks' | 'everything' | 'nothing';

const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

/**
 * A timestamp, computed once at the moment of the decision — never stored
 * as a duration, which would silently widen the shared window every day
 * that passes (`account-lifecycle/07`'s Risks section, verbatim). "Everything"
 * resolves to the client's own account creation date, not `epoch` or
 * `-Infinity`, so it remains a real, comparable timestamp `gte()` can use.
 */
function computeHistorySharedFrom(
  sharing: HistorySharing,
  accountCreatedAt: Date,
  now: Date,
): Date {
  switch (sharing) {
    case 'everything':
      return accountCreatedAt;
    case 'nothing':
      return now;
    case 'twelve_weeks':
      return new Date(now.getTime() - TWELVE_WEEKS_MS);
  }
}

export interface HistorySharingDecision {
  historySharing: HistorySharing;
  shareMetrics: boolean;
  shareNutrition: boolean;
}

async function applySharingDecision(
  tx: Transaction,
  clientProfileId: string,
  clientUserId: string,
  decision: HistorySharingDecision,
): Promise<void> {
  const [userRow] = await tx
    .select({ createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.id, clientUserId));
  if (!userRow) {
    throw new Error('applySharingDecision: users row vanished within the same transaction');
  }

  const now = new Date();
  const historySharedFrom = computeHistorySharedFrom(
    decision.historySharing,
    userRow.createdAt,
    now,
  );

  await tx
    .update(schema.clientProfiles)
    .set({
      historySharedFrom,
      // Off-by-default polarity (`resource-registry.ts`'s own note): a
      // toggle turned off stores `null`, not a stale timestamp a future
      // re-enable would otherwise resurrect unexpectedly.
      metricsSharedFrom: decision.shareMetrics ? historySharedFrom : null,
      nutritionSharedFrom: decision.shareNutrition ? historySharedFrom : null,
    })
    .where(eq(schema.clientProfiles.id, clientProfileId));
}

/**
 * `invites.acceptAsExistingClient` calls this for a returning client — the
 * one place a `client_profiles` row's `coach_id` is set to a value that
 * isn't null, other than the original (out-of-scope-here) first-time
 * acceptance path. Deliberately never touches `former_coach_id` /
 * `detached_at`: that coach's 30-day grace window runs entirely
 * independently of whoever the client joins next (`account-lifecycle/07`'s
 * own Verification: "the two windows do not interact").
 */
export async function attachClient(
  db: DbClient | Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  params: { clientProfileId: string; newCoachId: string } & HistorySharingDecision,
): Promise<void> {
  const { clientProfileId, newCoachId, ...decision } = params;

  await db.transaction(async (tx) => {
    const [client] = await tx
      .select({ coachId: schema.clientProfiles.coachId, userId: schema.clientProfiles.userId })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, clientProfileId));
    if (!client) {
      throw new Error(`attachClient: client_profiles ${clientProfileId} not found`);
    }
    if (client.coachId !== null) {
      // The router checks this first — reaching here means it didn't, or
      // two acceptances raced. There is no coach-to-coach transfer path;
      // a client already coached stays with who they have until they
      // leave, deliberately (task's own Risks section).
      throw appError('CLIENT_ALREADY_HAS_COACH', 'This account is already bound to a coach.', {});
    }

    await applySharingDecision(tx, clientProfileId, client.userId, decision);

    await tx
      .update(schema.clientProfiles)
      .set({ coachId: newCoachId, coachSince: new Date() })
      .where(eq(schema.clientProfiles.id, clientProfileId));

    await writeAuditLog(tx, ctx, {
      action: 'coaching.client_attached',
      targetType: 'client_profile',
      targetId: clientProfileId,
    });
  });
}

/**
 * The settings-screen counterpart (`account-lifecycle/07`'s Approach step
 * 6) — widens or narrows the CURRENT relationship's sharing. Narrowing
 * takes effect for the next read, same as every other `ownsResource`
 * check here (a live comparison, never a cache); it does not and cannot
 * claw back a comment/session a coach already opened.
 */
export async function updateHistorySharing(
  db: DbClient | Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  params: { clientProfileId: string } & HistorySharingDecision,
): Promise<void> {
  const { clientProfileId, ...decision } = params;

  await db.transaction(async (tx) => {
    const [client] = await tx
      .select({ coachId: schema.clientProfiles.coachId, userId: schema.clientProfiles.userId })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, clientProfileId));
    if (!client || client.coachId === null) {
      throw appError('CLIENT_HAS_NO_COACH', "You're not currently working with a coach.", {});
    }

    await applySharingDecision(tx, clientProfileId, client.userId, decision);

    await writeAuditLog(tx, ctx, {
      action: 'coaching.history_sharing_updated',
      targetType: 'client_profile',
      targetId: clientProfileId,
    });
  });
}
