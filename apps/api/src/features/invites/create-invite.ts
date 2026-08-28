// `invites.create` (`01`) — the seat check, the collision-retried code
// generation (`03`), and the row insert, plus (`02`) triggering the email
// after the row commits.
import { schema, type DbClient, type Invite, type Transaction } from '@coachos/db';
import { generateInviteCode } from '@coachos/utils';
import { eq } from 'drizzle-orm';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

import { assertSeatAvailable } from './seat-check.ts';
import { sendInviteEmail } from './send-invite-email.ts';

const INVITE_CODE_UNIQUE_CONSTRAINT = 'invites_code_unique';
const MAX_CODE_ATTEMPTS = 5;

export interface CreateInviteInput {
  email: string;
}

/**
 * Inserts one `identity.invites` row, retrying `generateInviteCode()` on a
 * (astronomically unlikely, but not impossible — `03`'s Approach step 3)
 * `invites_code_unique` collision rather than trusting generation alone.
 * Any other error — including a different unique violation — is rethrown
 * untouched for the request-wide `databaseErrorBoundary` to translate.
 */
// `generateCode` is injectable — defaulted to the real generator, never
// called with anything else outside a test — purely so
// `create-invite.test.ts` can force a collision on the first attempt
// deterministically. ESM's read-only named exports make `jest.spyOn` on
// `@coachos/utils` itself fail ("Cannot redefine property"); this seam is
// the standard alternative, not a change in real behaviour.
export async function insertInviteWithUniqueCode(
  tx: Transaction,
  coachId: string,
  email: string,
  generateCode: () => string = generateInviteCode,
): Promise<Invite> {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    try {
      // A nested `.transaction()` — Drizzle issues a SAVEPOINT for one
      // already inside a transaction, rather than a second real
      // transaction. This matters: Postgres aborts an entire transaction
      // on any error inside it ("current transaction is aborted, commands
      // ignored until end of transaction block"), so retrying the insert
      // on `tx` directly after a caught collision would fail every time,
      // not actually retry. The savepoint scopes that abort to just this
      // one attempt — `createInvite`'s outer transaction (which still has
      // an audit-log write to make) survives a collision here untouched.
      return await tx.transaction(async (savepoint) => {
        const [invite] = await savepoint
          .insert(schema.invites)
          .values({
            coachId,
            email,
            code: generateCode(),
            // `expires_at` is never set here — `identity-schema/04`'s
            // database default (`now() + interval '14 days'`) is the
            // single source of truth (`invites/03`'s Approach step 4).
          })
          .returning();
        if (!invite) throw new Error('insert into identity.invites did not return a row');
        return invite;
      });
    } catch (error) {
      const dbError = unwrapDatabaseError(error);
      const isCodeCollision =
        dbError?.code === '23505' && dbError.constraint_name === INVITE_CODE_UNIQUE_CONSTRAINT;
      if (!isCodeCollision || attempt === MAX_CODE_ATTEMPTS) {
        throw error;
      }
    }
  }
  // Unreachable — the loop always either returns or rethrows — but keeps
  // this function's return type `Promise<Invite>` rather than
  // `Promise<Invite | undefined>`.
  throw new Error('unreachable: insertInviteWithUniqueCode exhausted its own loop bound');
}

export async function createInvite(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  coachProfileId: string,
  input: CreateInviteInput,
): Promise<Invite> {
  await assertSeatAvailable(db, coachProfileId);

  const invite = await db.transaction(async (tx) => {
    const created = await insertInviteWithUniqueCode(tx, coachProfileId, input.email);
    await writeAuditLog(tx, ctx, {
      action: 'invite.created',
      targetType: 'invite',
      targetId: created.id,
    });
    return created;
  });

  const [coach] = await db
    .select({
      businessName: schema.coachProfiles.businessName,
      userId: schema.coachProfiles.userId,
    })
    .from(schema.coachProfiles)
    .where(eq(schema.coachProfiles.id, coachProfileId))
    .limit(1);
  const [coachUser] = coach
    ? await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, coach.userId))
        .limit(1)
    : [];

  // Fired after the transaction commits, never inside it, and never
  // awaited on the response path (`invites/02`'s Approach step 2 and
  // Acceptance criteria: a Resend failure must not fail or roll back
  // invite creation). `sendEmail` itself never throws
  // (`../../lib/email/client.ts`'s own doc comment), so this `.catch()`
  // exists only to silence an unhandled-rejection warning for work the
  // caller was never going to await, same pattern as
  // `../auth/password-reset.ts`'s `sendResetEmail`.
  void sendInviteEmail(invite, coachUser?.name ?? 'Your coach').catch(() => {});

  return invite;
}
