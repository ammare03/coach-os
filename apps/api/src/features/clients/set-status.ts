// `phase-10-coach-review-surfaces/relationship-controls/01` — the one
// transition function for `client_profiles.status`, and every rule about
// that column in one place.
//
// It is one function on purpose. P20 `seat-management/03` extends "the
// archive action, already built … wherever a coach archives a client" with
// `seat_hold_until = archived_at + 30 days` (CLAUDE.md §15.5's anti-gaming
// hold); if the archive branch lived partly in a router and partly here,
// that would be two edits and one of them would be missed. The hook is
// marked below — it is a one-line change inside `patchFor`.
import { schema, type DbClient, type Transaction } from '@coachos/db';
import type { coach as coachSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

/** The full `client_status` enum (DB§5.1) — what a row can currently be. */
type ClientStatus = (typeof schema.clientProfiles.status.enumValues)[number];

/** The subset `coach.clients.setStatus` can move a client to. */
type ClientStatusTarget = coachSchemas.ClientStatusTarget;

/**
 * What the caller gets back, and what the coach app renders the chip from.
 * All three timestamps, not just the one that moved: the optimistic hook
 * (`useClientStatus`) rolls back to a snapshot, and a response carrying only
 * the changed field would leave it guessing about the other two.
 */
export interface SetClientStatusResult {
  clientId: string;
  status: ClientStatus;
  activatedAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
}

/**
 * Which moves are allowed, from each current status. The table is the whole
 * product rule, stated once:
 *
 * - `active -> paused` and `paused -> active` are the holiday round trip —
 *   cheap, reversible, and the frequent one (hence undo rather than a
 *   confirmation, on the client side).
 * - Everything that is not archived can be archived. Archiving is the
 *   coach's bookkeeping: the relationship stays on record, the client keeps
 *   everything (CLAUDE.md §21.3) and is told nothing, and the seat is
 *   released (§15.5).
 * - `archived` reaches nothing. Working with that person again is a new
 *   invite, not a status flip — an archived client may have left.
 * - `invited -> paused` is absent deliberately: a pending invite is
 *   cancelled (`invites/`), not paused. So is `invited -> active`, which is
 *   invite acceptance's job and would additionally write an `active` row
 *   with a null `activated_at`, tripping `client_status_timestamps`.
 */
const LEGAL_TRANSITIONS: Record<ClientStatus, readonly ClientStatusTarget[]> = {
  invited: ['archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
};

/** One audit action per transition, in `coach-client-transition.ts`'s `coaching.*` namespace. */
const AUDIT_ACTION: Record<ClientStatusTarget, string> = {
  active: 'coaching.client_resumed',
  paused: 'coaching.client_paused',
  archived: 'coaching.client_archived',
};

/**
 * Every illegal move `LEGAL_TRANSITIONS` refuses starts from `invited` —
 * `archived` is handled a step earlier with its own code, and `active` and
 * `paused` can reach everything. So the message only has to explain a
 * pending invite, and it says what to do instead (`product-copy` §5:
 * errors say what happened, then what to do).
 *
 * The coach app renders Pause only for an active client and Resume only for
 * a paused one, so this is the floor under a stale client, never the normal
 * path.
 */
function illegalTransitionMessage(target: ClientStatusTarget): string {
  switch (target) {
    case 'paused':
      return "That invite hasn't been accepted yet, so there's nothing to pause. Cancel the invite instead.";
    case 'active':
      return "That invite hasn't been accepted yet. Your client becomes active when they accept it.";
    case 'archived':
      // Unreachable — every status can be archived. Kept so the switch stays
      // exhaustive and a future narrowing of `LEGAL_TRANSITIONS` gets a real
      // sentence rather than a crash.
      return "That client can't be archived right now.";
  }
}

type StatusPatch = Pick<
  typeof schema.clientProfiles.$inferInsert,
  'status' | 'activatedAt' | 'pausedAt' | 'archivedAt'
>;

/**
 * The column writes for one transition — the only place any of the three
 * timestamps is set or cleared.
 *
 * `client_status_timestamps` (DB§5.1) is honoured here rather than hoped
 * for: `active` always carries a non-null `activated_at` and `archived`
 * always carries a non-null `archived_at`, on every branch, so no caller can
 * assemble a row the check would refuse.
 */
function patchFor(
  target: ClientStatusTarget,
  current: { activatedAt: Date | null },
  now: Date,
): StatusPatch {
  switch (target) {
    case 'paused':
      return {
        status: 'paused',
        activatedAt: current.activatedAt,
        pausedAt: now,
        archivedAt: null,
      };
    case 'active':
      // Resuming clears the pause. `activatedAt` is re-used when it exists —
      // "when this client became active" is a fact about the relationship,
      // not about the most recent resume — and filled when it does not,
      // which is what keeps `client_status_timestamps` true for a row
      // paused before it was ever activated.
      return {
        status: 'active',
        activatedAt: current.activatedAt ?? now,
        pausedAt: null,
        archivedAt: null,
      };
    case 'archived':
      // `paused_at` is left alone: it is a true record of when the client
      // was paused, and archiving does not un-pause them.
      //
      // ⚠️ P20 `seat-management/03` adds `seatHoldUntil: addDays(now, 30)`
      // to THIS object, and nowhere else. §15.5: a client archived and
      // reactivated within 30 days does not release their seat during that
      // window.
      return { status: 'archived', activatedAt: current.activatedAt, archivedAt: now };
  }
}

/**
 * Moves one client between `active`, `paused`, and `archived`, writing the
 * timestamp columns that go with the move and an `audit_log` row, in one
 * transaction.
 *
 * **Checks no ownership of its own.** `coach.clients.setStatus` attaches
 * `ownsResource('client', …)`, which is the whole security story
 * (`api-conventions` §3); re-checking here would be a second, divergeable
 * opinion about who owns a client. The `NOT_YOUR_CLIENT` thrown below is
 * for a row that has vanished between the guard and this call, and carries
 * the guard's own indistinguishable copy so the two cannot be told apart.
 *
 * **Idempotent.** Asking for the status a row already has is a no-op that
 * returns the row — never a refusal — so a retried request, a double tap,
 * or an undo racing its own original call all settle instead of erroring.
 * The one exception is `archived`, which refuses every target including
 * itself: there is exactly one sentence to say about an archived client.
 */
export async function setClientStatus(
  db: DbClient | Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  params: { clientProfileId: string; status: ClientStatusTarget },
): Promise<SetClientStatusResult> {
  const { clientProfileId, status: target } = params;

  return db.transaction(async (tx) => {
    // `FOR UPDATE`: two taps arriving together must serialise, or the
    // second reads the status the first is about to replace and decides
    // legality against a row that no longer exists.
    const [current] = await tx
      .select({
        id: schema.clientProfiles.id,
        status: schema.clientProfiles.status,
        activatedAt: schema.clientProfiles.activatedAt,
        pausedAt: schema.clientProfiles.pausedAt,
        archivedAt: schema.clientProfiles.archivedAt,
      })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.id, clientProfileId))
      .for('update');

    if (!current) {
      // `ownsResource` already proved this row exists and belongs to the
      // caller, so reaching here means it was deleted in between. Same
      // code and same copy the guard uses — an attacker must not be able
      // to tell a race from a foreign id (ERRORS.md ER§2.1).
      throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
    }

    if (current.status === 'archived') {
      throw appError(
        'CLIENT_ARCHIVED',
        'This client was archived. Send a new invite to work together again.',
        {},
      );
    }

    if (current.status === target) {
      return {
        clientId: current.id,
        status: current.status,
        activatedAt: current.activatedAt,
        pausedAt: current.pausedAt,
        archivedAt: current.archivedAt,
      };
    }

    if (!LEGAL_TRANSITIONS[current.status].includes(target)) {
      throw appError('CLIENT_STATUS_TRANSITION_INVALID', illegalTransitionMessage(target), {
        from: current.status,
        to: target,
      });
    }

    const now = new Date();
    const [updated] = await tx
      .update(schema.clientProfiles)
      .set(patchFor(target, current, now))
      .where(eq(schema.clientProfiles.id, clientProfileId))
      .returning({
        id: schema.clientProfiles.id,
        status: schema.clientProfiles.status,
        activatedAt: schema.clientProfiles.activatedAt,
        pausedAt: schema.clientProfiles.pausedAt,
        archivedAt: schema.clientProfiles.archivedAt,
      });
    if (!updated) {
      throw new Error('setClientStatus: client_profiles row vanished within the same transaction');
    }

    await writeAuditLog(tx, ctx, {
      action: AUDIT_ACTION[target],
      targetType: 'client_profile',
      targetId: clientProfileId,
      // Statuses only — DB§18 operational data. Never a name, never an
      // email, never the coach's reason.
      metadata: { from: current.status, to: target },
    });

    return {
      clientId: updated.id,
      status: updated.status,
      activatedAt: updated.activatedAt,
      pausedAt: updated.pausedAt,
      archivedAt: updated.archivedAt,
    };
  });
}
