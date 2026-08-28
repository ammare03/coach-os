// The transactional write path for `invites.accept` — user row, client
// profile row, audit row, in that order, one transaction. Mirrors
// `../auth/create-coach-account.ts`'s shape exactly (that file's own doc
// comment names this task as the reason it doesn't reuse it: "a client
// account needs different rows, but follows the same shape").
import { schema, type ClientProfile, type Transaction, type User } from '@coachos/db';

import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

export interface CreateClientAccountInput {
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
  dateOfBirth: string;
  /**
   * Non-null only when the caller is 13-17 (`invites/04`'s guardian-consent
   * branch, computed by the caller from `dateOfBirth` before this function
   * ever runs — same "age-checked by the caller" split
   * `create-coach-account.ts` already uses). Determines both `isMinor` and
   * whether the created `client_profiles` row activates immediately.
   */
  guardianEmail: string | null;
  coachId: string;
}

export interface CreateClientAccountResult {
  user: User;
  clientProfile: ClientProfile;
  isMinor: boolean;
}

/**
 * A minor's account is created but **not activated** — `status: 'invited'`,
 * `activatedAt: null` — until a guardian confirms (`CLAUDE.md` §21.5's
 * "block until consent, never partially enable it"). An 18+ client
 * activates immediately, satisfying `client_status_timestamps`'s `CHECK`
 * (`activated_at IS NOT NULL` whenever `status = 'active'`) either way.
 *
 * `tx` has no default, same convention as `create-coach-account.ts` and
 * `writeAuditLog` — a caller that forgets `db.transaction(...)` fails to
 * compile. Insertion order (user, then profile) matches
 * `client_profiles.user_id`'s FK; if the second insert throws — including
 * `client_profiles_one_active_coach`'s unique-index violation, the one
 * `invites/04` must specifically catch and translate — the first insert's
 * effects roll back with it. No error handling of its own; that's the
 * caller's job, same split as `create-coach-account.ts`.
 */
export async function createClientAccount(
  tx: Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  input: CreateClientAccountInput,
): Promise<CreateClientAccountResult> {
  const isMinor = input.guardianEmail !== null;
  const activatesImmediately = !isMinor;
  const now = new Date();

  const [user] = await tx
    .insert(schema.users)
    .values({
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: 'client',
      timezone: input.timezone,
      dateOfBirth: input.dateOfBirth,
      isMinor,
      guardianEmail: input.guardianEmail,
    })
    .returning();
  if (!user) throw new Error('insert into identity.users did not return a row');

  const [clientProfile] = await tx
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: input.coachId,
      status: activatesImmediately ? 'active' : 'invited',
      activatedAt: activatesImmediately ? now : null,
    })
    .returning();
  if (!clientProfile) throw new Error('insert into identity.client_profiles did not return a row');

  await writeAuditLog(tx, ctx, {
    action: 'auth.signup',
    targetType: 'user',
    targetId: user.id,
    actorUserId: user.id, // the row this same transaction just inserted — not in ctx
  });

  return { user, clientProfile, isMinor };
}
